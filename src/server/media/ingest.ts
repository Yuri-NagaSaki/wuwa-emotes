import { createHash } from 'node:crypto'
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import { newEmojiId } from '../../shared/ids'
import { db, schema } from '../db/client'
import type { EmojiStatus, PackStatus, UploadStatus } from '../db/schema'
import { sendJob } from '../jobs/boss'
import { Q } from '../jobs/queues'
import { log } from '../log'
import { originalKey } from './keys'
import { copyObjectIfMatch, deleteObjects, getObjectBytesLimited, headObject } from './s3'

// media.ingest (docs/ARCHITECTURE.md §5.2): a browser upload under uploads/tmp/ becomes a pending emoji.
//   1. HEAD the tmp object; reject oversize files before reading them
//   2. read it (capped, If-Match) and probe it with sharp: format, size, frames, pixel limits
//   3. SHA-256; a file already in the same pack is a duplicate (other packs are allowed, see
//      findCrossPackDuplicates)
//   4. copy to assets/v1/packs/<packKey>/emojis/<id>.<ext> (only if the tmp object is unchanged),
//      insert the emoji (status pending), mark the upload done, delete the tmp object
//   5. queue media.derive target 'review' (p240/a160 into review/v1/)
// Every emoji owns its object; nothing is shared. Retries are safe: the emoji id is reserved on the
// upload row before the copy, so a retried job copies to the same key and inserts the same row.
// Imported v1 emojis have no sha256, so they are invisible to both duplicate checks.

const ACTIVE: UploadStatus[] = ['signed', 'uploaded', 'processing']
// pg_advisory_xact_lock(namespace, pack id): serialises the duplicate check + insert per pack
const LOCK_NAMESPACE = 0x696e6773 // 'ings'

export type IngestOutcome =
  | { status: 'done'; emojiId: string }
  | { status: 'duplicate'; emojiId: string }
  | { status: 'failed'; error: string }
  | { status: 'skipped'; reason: string }

export interface IngestDeps {
  /** queue review previews for a new pending emoji */
  enqueueReview(emojiId: string): Promise<void>
}

export const defaultIngestDeps: IngestDeps = {
  async enqueueReview(emojiId) {
    await sendJob(Q.derive, { emojiId, target: 'review' }, { singletonKey: emojiId })
  },
}

export const DUPLICATE_MESSAGE = '与本包中已有的表情重复'

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0]

async function samePackDuplicate(runner: ReturnType<typeof db> | Tx, packId: number, sha256: string, selfId: string): Promise<string | null> {
  const { emojis } = schema
  const rows = await runner
    .select({ id: emojis.id })
    .from(emojis)
    .where(and(eq(emojis.packId, packId), eq(emojis.sha256, sha256), ne(emojis.id, selfId)))
    .orderBy(asc(emojis.sortOrder), asc(emojis.id))
    .limit(1)
  return rows[0]?.id ?? null
}

async function fail(uploadId: string, tmpKey: string, error: string, removeTmp: boolean): Promise<IngestOutcome> {
  const { uploadItems } = schema
  await db()
    .update(uploadItems)
    .set({ status: 'failed', error })
    .where(and(eq(uploadItems.id, uploadId), inArray(uploadItems.status, ACTIVE)))
  // rejected input is garbage; a missing object has nothing to delete
  if (removeTmp) await deleteObjects([tmpKey])
  log().info({ uploadId, error }, 'ingest: upload rejected')
  return { status: 'failed', error }
}

/** A finished upload whose emoji never got review previews (e.g. the enqueue failed): queue again. */
async function ensureReviewQueued(emojiId: string, deps: IngestDeps) {
  const { emojis } = schema
  const [e] = await db().select({ status: emojis.status, p240Bytes: emojis.p240Bytes }).from(emojis).where(eq(emojis.id, emojiId))
  if (e && e.status === 'pending' && e.p240Bytes == null) await deps.enqueueReview(emojiId)
}

export async function ingestUpload(uploadItemId: string, deps: IngestDeps = defaultIngestDeps): Promise<IngestOutcome> {
  const d = db()
  const { uploadItems, packs, emojis } = schema
  const [row] = await d
    .select({ item: uploadItems, packKey: packs.packKey })
    .from(uploadItems)
    .innerJoin(packs, eq(packs.id, uploadItems.packId))
    .where(eq(uploadItems.id, uploadItemId))
    .limit(1)
  if (!row) {
    log().warn({ uploadItemId }, 'ingest: upload not found')
    return { status: 'skipped', reason: 'upload not found' }
  }
  const u = row.item
  if (!ACTIVE.includes(u.status)) {
    if (u.status === 'done' && u.emojiId) await ensureReviewQueued(u.emojiId, deps)
    return { status: 'skipped', reason: `already ${u.status}` }
  }

  // sharp is loaded only here, so web code can import this module for findCrossPackDuplicates
  const { LIMITS, MediaError, mimeOf, probe } = await import('./derive')

  const head = await headObject(u.tmpKey)
  if (!head) return fail(u.id, u.tmpKey, '上传的文件不存在或已过期，请重新上传', false)
  const size = head.ContentLength ?? 0
  if (size > LIMITS.maxBytes) return fail(u.id, u.tmpKey, `文件超过 ${Math.round(LIMITS.maxBytes / 1024 / 1024)} MB`, true)
  if (size <= 0) return fail(u.id, u.tmpKey, '文件是空的', true)

  // If-Match: the bytes probed here are the bytes copied below (the presigned PUT is still valid)
  const buf = await getObjectBytesLimited(u.tmpKey, LIMITS.maxBytes, head.ETag)
  let p: Awaited<ReturnType<typeof probe>>
  try {
    p = await probe(buf)
  } catch (err) {
    const message = err instanceof MediaError ? err.message : '无法识别的图片文件（只支持 GIF、PNG、WebP、JPEG）'
    return fail(u.id, u.tmpKey, message, true)
  }
  const mime = mimeOf(p.format)!
  const ext = p.format === 'jpeg' ? 'jpg' : p.format
  const sha256 = createHash('sha256').update(buf).digest('hex')

  // reserve the emoji id on the upload row; a retry reuses it, so it copies to the same key
  const [reserved] = await d
    .update(uploadItems)
    .set({ status: 'processing', emojiId: sql`COALESCE(${uploadItems.emojiId}, ${newEmojiId()})`, error: null })
    .where(and(eq(uploadItems.id, u.id), inArray(uploadItems.status, ACTIVE)))
    .returning({ emojiId: uploadItems.emojiId })
  if (!reserved?.emojiId) return { status: 'skipped', reason: 'finished concurrently' }
  const emojiId = reserved.emojiId

  const markDuplicate = async (runner: ReturnType<typeof db> | Tx, dupId: string) => {
    await runner.update(uploadItems).set({ status: 'duplicate', emojiId: dupId, error: DUPLICATE_MESSAGE }).where(eq(uploadItems.id, u.id))
  }

  const key = originalKey(row.packKey, emojiId, ext)
  const early = await samePackDuplicate(d, u.packId, sha256, emojiId)
  if (early) {
    await markDuplicate(d, early)
    // `key` exists only if an earlier attempt copied before dying; it belongs to this upload alone
    await deleteObjects([u.tmpKey, key])
    return { status: 'duplicate', emojiId: early }
  }

  await copyObjectIfMatch(u.tmpKey, key, head.ETag!, mime)

  const dup = await d.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE}::int, ${u.packId}::int)`)
    const other = await samePackDuplicate(tx, u.packId, sha256, emojiId)
    if (other) {
      await markDuplicate(tx, other)
      return other
    }
    const [next] = await tx
      .select({ n: sql<number>`COALESCE(MAX(${emojis.sortOrder}) + 1, 0)::int` })
      .from(emojis)
      .where(eq(emojis.packId, u.packId))
    await tx
      .insert(emojis)
      .values({
        id: emojiId,
        packId: u.packId,
        storagePackKey: row.packKey,
        status: 'pending',
        sortOrder: next?.n ?? 0,
        originalKey: key,
        format: p.format,
        mime,
        bytes: buf.byteLength,
        width: p.width,
        height: p.height,
        frames: p.frames,
        durationMs: p.durationMs,
        sha256,
      })
      .onConflictDoNothing({ target: emojis.id })
    await tx.update(uploadItems).set({ status: 'done', emojiId, error: null }).where(eq(uploadItems.id, u.id))
    return null
  })
  if (dup) {
    // lost a race with an identical upload to the same pack: drop our copy
    await deleteObjects([key, u.tmpKey])
    return { status: 'duplicate', emojiId: dup }
  }

  await deleteObjects([u.tmpKey])
  await deps.enqueueReview(emojiId)
  log().info({ uploadId: u.id, emojiId, format: p.format, bytes: buf.byteLength }, 'ingest: emoji created')
  return { status: 'done', emojiId }
}

export interface CrossPackDuplicate {
  emojiId: string
  status: EmojiStatus
  packId: number
  packKey: string
  slug: string
  title: string
  packStatus: PackStatus
}

/**
 * Emojis in other packs with the same SHA-256 as this one. Cross-pack duplicates are allowed; the
 * review UI shows them so the reviewer can decide. Empty when the emoji has no hash (v1 imports).
 */
export async function findCrossPackDuplicates(emojiId: string): Promise<CrossPackDuplicate[]> {
  const { emojis, packs } = schema
  const [self] = await db().select({ sha256: emojis.sha256, packId: emojis.packId }).from(emojis).where(eq(emojis.id, emojiId))
  if (!self?.sha256) return []
  return db()
    .select({
      emojiId: emojis.id,
      status: emojis.status,
      packId: packs.id,
      packKey: packs.packKey,
      slug: packs.slug,
      title: packs.title,
      packStatus: packs.status,
    })
    .from(emojis)
    .innerJoin(packs, eq(packs.id, emojis.packId))
    .where(and(eq(emojis.sha256, self.sha256), ne(emojis.packId, self.packId)))
    .orderBy(asc(packs.id), asc(emojis.id))
}
