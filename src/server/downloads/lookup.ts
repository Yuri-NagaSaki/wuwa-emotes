import { eq, inArray, sql } from 'drizzle-orm'
import { db, schema } from '../db/client'
import type { CreditsPack } from '../media/credits'
import { creditsSite, loadPackZipSource, originalExtension, packCreditsEntries, zipEntryName } from '../media/zip'

// Database reads for the download routes: the rows the policy needs, the file name a download gets,
// the state of a pack's ZIP and the CREDITS.txt blocks for batch volumes.

export interface PackInfo {
  id: number
  slug: string
  title: string
  status: string
  downloadable: boolean
  ownerId: string | null
  sourceUrl: string | null
  commissioner: string | null
  license: string
  creditsText: string | null
}

export interface EmojiInfo {
  emoji: { id: string; status: string; packId: number; originalKey: string; format: string; bytes: number }
  pack: PackInfo
  /** 0-based position among the pack's published emojis (sort_order, id), as in the pack ZIP */
  position: number
  /** published emojis in the pack */
  total: number
}

const packColumns = {
  id: schema.packs.id,
  slug: schema.packs.slug,
  title: schema.packs.title,
  status: schema.packs.status,
  downloadable: schema.packs.downloadable,
  ownerId: schema.packs.ownerId,
  sourceUrl: schema.packs.sourceUrl,
  commissioner: schema.packs.commissioner,
  license: schema.packs.license,
  creditsText: schema.packs.creditsText,
}

/** Emoji + pack rows, with the emoji's position in its pack, for up to a few dozen ids in one query. */
export async function lookupEmojis(ids: string[]): Promise<Map<string, EmojiInfo>> {
  const out = new Map<string, EmojiInfo>()
  if (!ids.length) return out
  const { emojis, packs } = schema
  const rows = await db()
    .select({
      id: emojis.id,
      status: emojis.status,
      packId: emojis.packId,
      originalKey: emojis.originalKey,
      format: emojis.format,
      bytes: emojis.bytes,
      pack: packColumns,
      total: sql<number>`(SELECT count(*)::int FROM emojis x WHERE x.pack_id = ${emojis.packId} AND x.status = 'published')`,
      before: sql<number>`(SELECT count(*)::int FROM emojis x WHERE x.pack_id = ${emojis.packId} AND x.status = 'published'
        AND (x.sort_order, x.id) < (${emojis.sortOrder}, ${emojis.id}))`,
    })
    .from(emojis)
    .innerJoin(packs, eq(packs.id, emojis.packId))
    .where(inArray(emojis.id, ids))
  for (const r of rows) {
    out.set(r.id, {
      emoji: { id: r.id, status: r.status, packId: r.packId, originalKey: r.originalKey, format: r.format, bytes: r.bytes },
      pack: r.pack,
      position: r.status === 'published' ? Number(r.before) : -1,
      total: Number(r.total),
    })
  }
  return out
}

export async function lookupPackBySlug(slug: string): Promise<PackInfo | null> {
  const [row] = await db().select(packColumns).from(schema.packs).where(eq(schema.packs.slug, slug)).limit(1)
  return row ?? null
}

/**
 * The name a downloaded original gets: the same `<slug>-<NN>.<ext>` as inside the pack ZIP
 * (zipEntryName), or `<slug>-<emojiId>.<ext>` for an original still under review (it has no position).
 */
export function downloadFilename(info: EmojiInfo): string {
  if (info.position >= 0 && info.pack.status === 'published') return zipEntryName(info.pack.slug, info.position, info.total, info.emoji)
  return `${info.pack.slug}-${info.emoji.id}.${originalExtension(info.emoji)}`
}

export type ZipState =
  | { status: 'ready'; key: string; bytes: number }
  | { status: 'stale' }
  | { status: 'unavailable'; code: 'not_found' | 'not_downloadable' | 'empty' }

/** Ready only when zip_artifacts holds a ZIP of the pack's current content hash (see packContentHash). */
export async function packZipState(packId: number): Promise<ZipState> {
  const loaded = await loadPackZipSource(packId)
  if (!loaded.ok) return { status: 'unavailable', code: loaded.code }
  const [artifact] = await db().select().from(schema.zipArtifacts).where(eq(schema.zipArtifacts.packId, packId))
  if (artifact && artifact.contentHash === loaded.source.hash) return { status: 'ready', key: artifact.objectKey, bytes: artifact.bytes }
  return { status: 'stale' }
}

/** CREDITS.txt blocks for the packs of a batch chunk, keyed by pack id. */
export async function batchCredits(packs: PackInfo[]): Promise<Map<number, CreditsPack>> {
  return packCreditsEntries(packs)
}

export { creditsSite }

/** +n on packs.download_count. Raw SQL: the Drizzle update would also move updated_at ($onUpdate),
 * which edit_pack submissions compare against (base_updated_at). */
export async function bumpPackDownloads(packId: number, n = 1): Promise<void> {
  await db().execute(sql`UPDATE packs SET download_count = download_count + ${n} WHERE id = ${packId}`)
}
