import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { PassThrough, type Readable } from 'node:stream'
import { ZipArchive } from 'archiver'
import { and, asc, eq } from 'drizzle-orm'
import { db, schema } from '../db/client'
import { sendJob } from '../jobs/boss'
import { Q } from '../jobs/queues'
import { log } from '../log'
import { siteIdentity } from '../settings'
import { buildCreditsText, formatCreditsDate } from './credits'
import { zipKey } from './keys'
import { siteUrl } from './publish'
import { createUpload, deleteObjects, getObject, headObject } from './s3'

// zip.build (docs/ARCHITECTURE.md §6.1): one ZIP per published, downloadable pack, stored at
// zips/v1/packs/<packKey>/<packKey>.<hash8>.zip and recorded in zip_artifacts. Originals are streamed
// one at a time into a store-mode archive (GIF/PNG do not compress) that is uploaded in parts, so
// memory stays at a few parts however large the pack is. The content hash covers only the published
// emojis (id + sha256, or byte size when there is no hash); a build with an unchanged hash is skipped.

export interface ZipEmoji {
  id: string
  sha256: string | null
  bytes: number
  originalKey: string
  format: string
}

/** sha256 over the published emojis sorted by id: `<id>\t<sha256 | bytes:<n>>` per line. */
export function packContentHash(emojis: Pick<ZipEmoji, 'id' | 'sha256' | 'bytes'>[]): string {
  const lines = emojis.map((e) => `${e.id}\t${e.sha256 ?? `bytes:${e.bytes}`}`).sort()
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

function extension(e: Pick<ZipEmoji, 'originalKey' | 'format'>): string {
  const m = /\.([a-z0-9]+)$/i.exec(e.originalKey)
  if (m) return m[1]!.toLowerCase()
  return e.format === 'jpeg' ? 'jpg' : e.format
}

/** `<slug>-01.gif`, `<slug>-02.png`, … in pack order; two digits at least, more for big packs. */
export function zipEntryNames(slug: string, emojis: Pick<ZipEmoji, 'originalKey' | 'format'>[]): string[] {
  const base = slug.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'pack'
  const width = Math.max(2, String(emojis.length).length)
  return emojis.map((e, i) => `${base}-${String(i + 1).padStart(width, '0')}.${extension(e)}`)
}

export type ZipBuildResult =
  | { status: 'built'; key: string; bytes: number; hash: string }
  | { status: 'unchanged'; key: string; hash: string }
  | { status: 'skipped'; reason: string }

/** Queue a rebuild; one queued-or-active build per pack (exclusive queue, singletonKey = pack id). */
export async function enqueuePackZip(packId: number) {
  await sendJob(Q.zipBuild, { packId }, { singletonKey: String(packId) })
}

async function packCredits(pack: typeof schema.packs.$inferSelect, now: Date): Promise<string> {
  const { packArtists, artists } = schema
  const people = await db()
    .select({ name: artists.name, role: packArtists.role })
    .from(packArtists)
    .innerJoin(artists, eq(artists.id, packArtists.artistId))
    .where(eq(packArtists.packId, pack.id))
    .orderBy(asc(artists.name))
  const commissioners = people.filter((p) => p.role === 'commissioner').map((p) => p.name)
  const site = await siteIdentity()
  return buildCreditsText({
    siteName: site.name,
    siteUrl: siteUrl('/'),
    date: formatCreditsDate(now),
    packs: [
      {
        title: pack.title,
        pageUrl: siteUrl(`/packs/${encodeURIComponent(pack.slug)}`),
        sourceUrl: pack.sourceUrl,
        artists: people.filter((p) => p.role === 'artist').map((p) => p.name),
        commissioner: [pack.commissioner, ...commissioners].filter(Boolean).join('、') || null,
        license: pack.license,
        note: pack.creditsText,
      },
    ],
  })
}

/** Stream the entries into a store-mode ZIP uploaded to `key`; returns the archive size in bytes. */
async function writeZip(key: string, entries: { key: string; name: string }[], credits: string, date: Date): Promise<number> {
  const archive = new ZipArchive({ store: true })
  // archiver streams come from the readable-stream package, which lib-storage does not accept as a
  // Body; pipe through a native stream (pipe keeps backpressure)
  const body = new PassThrough()
  archive.pipe(body)
  const upload = createUpload(key, body, { contentType: 'application/zip' })
  // the upload must be consuming before anything is appended, or backpressure stalls the archive
  const uploading = upload.done()
  const uploadFailed = uploading.then(
    () => new Promise<never>(() => {}),
    (err) => Promise.reject(err),
  )
  const archiveFailed = new Promise<never>((_, reject) => archive.once('error', reject))
  uploadFailed.catch(() => {})
  archiveFailed.catch(() => {})
  try {
    for (const e of entries) {
      // one original open at a time: fetch the next only after archiver has consumed this one
      const res = await getObject(e.key)
      const consumed = once(archive, 'entry')
      archive.append(res.Body as Readable, { name: e.name, date, store: true })
      await Promise.race([consumed, archiveFailed, uploadFailed])
    }
    archive.append(Buffer.from(credits, 'utf8'), { name: 'CREDITS.txt', date })
    await Promise.race([Promise.all([archive.finalize(), uploading]), archiveFailed])
  } catch (err) {
    await upload.abort().catch(() => {})
    // ends the stream, so the upload's read loop sees the abort instead of waiting for data
    archive.abort()
    await Promise.race([uploading.catch(() => {}), new Promise((resolve) => setTimeout(resolve, 30_000).unref())])
    // a single-part upload may have completed with a truncated archive; nothing references this key yet
    // (an unchanged hash with its object present never gets here)
    await deleteObjects([key]).catch(() => {})
    throw err
  }
  return archive.pointer()
}

export async function buildPackZip(packId: number, opts: { now?: Date } = {}): Promise<ZipBuildResult> {
  const now = opts.now ?? new Date()
  const { packs, emojis, zipArtifacts } = schema
  const [pack] = await db().select().from(packs).where(eq(packs.id, packId))
  if (!pack) return { status: 'skipped', reason: 'pack not found' }
  if (pack.status !== 'published' || !pack.downloadable) return { status: 'skipped', reason: 'pack is not published and downloadable' }
  const rows = await db()
    .select({ id: emojis.id, sha256: emojis.sha256, bytes: emojis.bytes, originalKey: emojis.originalKey, format: emojis.format })
    .from(emojis)
    .where(and(eq(emojis.packId, packId), eq(emojis.status, 'published')))
    .orderBy(asc(emojis.sortOrder), asc(emojis.id))
  if (!rows.length) return { status: 'skipped', reason: 'pack has no published emojis' }

  const hash = packContentHash(rows)
  const [prev] = await db().select().from(zipArtifacts).where(eq(zipArtifacts.packId, packId))
  if (prev && prev.contentHash === hash && (await headObject(prev.objectKey))) return { status: 'unchanged', key: prev.objectKey, hash }

  const key = zipKey(pack.packKey, hash.slice(0, 8))
  const names = zipEntryNames(pack.slug, rows)
  const started = Date.now()
  const bytes = await writeZip(
    key,
    rows.map((r, i) => ({ key: r.originalKey, name: names[i]! })),
    await packCredits(pack, now),
    now,
  )
  await db()
    .insert(zipArtifacts)
    .values({ packId, contentHash: hash, objectKey: key, bytes, builtAt: now })
    .onConflictDoUpdate({ target: zipArtifacts.packId, set: { contentHash: hash, objectKey: key, bytes, builtAt: now } })
  if (prev && prev.objectKey !== key) await deleteObjects([prev.objectKey])
  log().info({ packId, key, bytes, entries: rows.length, ms: Date.now() - started }, 'zip: built')
  return { status: 'built', key, bytes, hash }
}
