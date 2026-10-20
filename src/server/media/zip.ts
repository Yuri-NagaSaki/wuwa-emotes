import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { PassThrough, type Readable } from 'node:stream'
import { ZipArchive } from 'archiver'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db/client'
import { sendJob } from '../jobs/boss'
import { Q } from '../jobs/queues'
import { log } from '../log'
import { siteIdentity } from '../settings'
import { buildCreditsText, type CreditsInput, type CreditsPack, formatCreditsDate } from './credits'
import { zipKey } from './keys'
import { siteUrl } from './publish'
import { createUpload, deleteObjects, getObject, headObject } from './s3'

// zip.build (docs/ARCHITECTURE.md §6.1): one ZIP per published, downloadable pack, stored at
// zips/v1/packs/<packKey>/<packKey>.<hash8>.zip and recorded in zip_artifacts. Originals are streamed
// one at a time into a store-mode archive (GIF/PNG do not compress) that is uploaded in parts, so
// memory stays at a few parts however large the pack is. The content hash (packContentHash) covers
// everything that decides what the archive holds: entry names and order, each original, and the
// CREDITS.txt text minus its date. A build with an unchanged hash is skipped, and /dl/p serves the
// recorded ZIP only while its hash still matches.

export interface ZipEmoji {
  id: string
  sha256: string | null
  bytes: number
  originalKey: string
  format: string
}

/** CREDITS.txt input without the generation date: the date is the only part that may differ between builds. */
export type ZipCredits = Omit<CreditsInput, 'date'>

/** Everything packContentHash covers. `emojis` are the published emojis in pack order (sort_order, id). */
export interface PackContent {
  slug: string
  emojis: Pick<ZipEmoji, 'id' | 'sha256' | 'bytes' | 'originalKey' | 'format'>[]
  credits: ZipCredits
}

const HASH_VERSION = 'chaochi-zip-v2'

/**
 * sha256 over what the archive contains, so any change that alters the ZIP gives a new hash:
 *  - one line per entry in archive order: `<entry name>\t<emoji id>\t<sha256 | bytes:<n>>`. Entry names
 *    come from zipEntryNames, so the pack slug, the sort order and the file extensions are covered;
 *  - the CREDITS.txt body from buildCreditsText with an empty date (title, slug, license, artists,
 *    commissioner, credits text, source URL, site name and URL).
 * The generation date is left out on purpose: rebuilding the same pack on another day gives the same hash.
 */
export function packContentHash(content: PackContent): string {
  const names = zipEntryNames(content.slug, content.emojis)
  const h = createHash('sha256').update(`${HASH_VERSION}\n`)
  content.emojis.forEach((e, i) => h.update(`${names[i]}\t${e.id}\t${e.sha256 ?? `bytes:${e.bytes}`}\n`))
  h.update('\nCREDITS.txt\n')
  h.update(buildCreditsText({ ...content.credits, date: '' }))
  return h.digest('hex')
}

/** File extension of an original: from its object key, else from the format (jpeg → jpg). */
export function originalExtension(e: Pick<ZipEmoji, 'originalKey' | 'format'>): string {
  const m = /\.([a-z0-9]+)$/i.exec(e.originalKey)
  if (m) return m[1]!.toLowerCase()
  return e.format === 'jpeg' ? 'jpg' : e.format
}

/**
 * Name of the entry at `index` (0-based) in a pack of `total` published emojis: `<slug>-01.gif`, …;
 * two digits at least, more for big packs. Single downloads (/dl/e save, batch) use the same name.
 */
export function zipEntryName(slug: string, index: number, total: number, e: Pick<ZipEmoji, 'originalKey' | 'format'>): string {
  const base = slug.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'pack'
  const width = Math.max(2, String(total).length)
  return `${base}-${String(index + 1).padStart(width, '0')}.${originalExtension(e)}`
}

/** `<slug>-01.gif`, `<slug>-02.png`, … in pack order; two digits at least, more for big packs. */
export function zipEntryNames(slug: string, emojis: Pick<ZipEmoji, 'originalKey' | 'format'>[]): string[] {
  return emojis.map((e, i) => zipEntryName(slug, i, emojis.length, e))
}

export type ZipBuildResult =
  | { status: 'built'; key: string; bytes: number; hash: string }
  | { status: 'unchanged'; key: string; hash: string }
  | { status: 'skipped'; reason: string }

/** Queue a rebuild; one queued-or-active build per pack (exclusive queue, singletonKey = pack id). */
export async function enqueuePackZip(packId: number) {
  await sendJob(Q.zipBuild, { packId }, { singletonKey: String(packId) })
}

type PackRow = typeof schema.packs.$inferSelect
export type CreditsPackFields = Pick<PackRow, 'id' | 'slug' | 'title' | 'sourceUrl' | 'commissioner' | 'license' | 'creditsText'>

/**
 * The CREDITS.txt block of each pack (artists, commissioners, license, source), one query for all of
 * them. Used for pack ZIPs here and for batch ZIPs (POST /api/batch/sign hands the blocks to the browser).
 */
export async function packCreditsEntries(packs: CreditsPackFields[]): Promise<Map<number, CreditsPack>> {
  const { packArtists, artists } = schema
  const ids = [...new Set(packs.map((p) => p.id))]
  const people = ids.length
    ? await db()
        .select({ packId: packArtists.packId, name: artists.name, role: packArtists.role })
        .from(packArtists)
        .innerJoin(artists, eq(artists.id, packArtists.artistId))
        .where(inArray(packArtists.packId, ids))
        .orderBy(asc(artists.name), asc(artists.id))
    : []
  const out = new Map<number, CreditsPack>()
  for (const pack of packs) {
    const mine = people.filter((p) => p.packId === pack.id)
    const commissioners = mine.filter((p) => p.role === 'commissioner').map((p) => p.name)
    out.set(pack.id, {
      title: pack.title,
      pageUrl: siteUrl(`/packs/${encodeURIComponent(pack.slug)}`),
      sourceUrl: pack.sourceUrl,
      artists: mine.filter((p) => p.role === 'artist').map((p) => p.name),
      commissioner: [pack.commissioner, ...commissioners].filter(Boolean).join('、') || null,
      license: pack.license,
      note: pack.creditsText,
    })
  }
  return out
}

/** Site name and URL as printed in CREDITS.txt. */
export async function creditsSite(): Promise<Omit<ZipCredits, 'packs'>> {
  const site = await siteIdentity()
  return { siteName: site.name, siteUrl: siteUrl('/') }
}

async function packCredits(pack: PackRow): Promise<ZipCredits> {
  const entries = await packCreditsEntries([pack])
  return { ...(await creditsSite()), packs: [entries.get(pack.id)!] }
}

export interface PackZipSource {
  pack: PackRow
  /** published emojis in archive order */
  emojis: ZipEmoji[]
  names: string[]
  credits: ZipCredits
  hash: string
}

export type PackZipSourceResult =
  | { ok: true; source: PackZipSource }
  | { ok: false; code: 'not_found' | 'not_downloadable' | 'empty'; reason: string }

/**
 * What the pack's ZIP should contain right now, and its content hash. Shared by the builder and by
 * /dl/p, which serves the recorded ZIP only if zip_artifacts.content_hash equals this hash.
 */
export async function loadPackZipSource(packId: number): Promise<PackZipSourceResult> {
  const { packs, emojis } = schema
  const [pack] = await db().select().from(packs).where(eq(packs.id, packId))
  if (!pack) return { ok: false, code: 'not_found', reason: 'pack not found' }
  if (pack.status !== 'published' || !pack.downloadable) return { ok: false, code: 'not_downloadable', reason: 'pack is not published and downloadable' }
  const rows = await db()
    .select({ id: emojis.id, sha256: emojis.sha256, bytes: emojis.bytes, originalKey: emojis.originalKey, format: emojis.format })
    .from(emojis)
    .where(and(eq(emojis.packId, packId), eq(emojis.status, 'published')))
    .orderBy(asc(emojis.sortOrder), asc(emojis.id))
  if (!rows.length) return { ok: false, code: 'empty', reason: 'pack has no published emojis' }
  const credits = await packCredits(pack)
  const hash = packContentHash({ slug: pack.slug, emojis: rows, credits })
  return { ok: true, source: { pack, emojis: rows, names: zipEntryNames(pack.slug, rows), credits, hash } }
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
  const { zipArtifacts } = schema
  const loaded = await loadPackZipSource(packId)
  if (!loaded.ok) return { status: 'skipped', reason: loaded.reason }
  const { pack, emojis: rows, names, credits, hash } = loaded.source

  const [prev] = await db().select().from(zipArtifacts).where(eq(zipArtifacts.packId, packId))
  if (prev && prev.contentHash === hash && (await headObject(prev.objectKey))) return { status: 'unchanged', key: prev.objectKey, hash }

  const key = zipKey(pack.packKey, hash.slice(0, 8))
  const started = Date.now()
  const bytes = await writeZip(
    key,
    rows.map((r, i) => ({ key: r.originalKey, name: names[i]! })),
    buildCreditsText({ ...credits, date: formatCreditsDate(now) }),
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
