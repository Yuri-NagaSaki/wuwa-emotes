import { and, eq, inArray } from 'drizzle-orm'
import { audit } from '../audit'
import { db, schema } from '../db/client'
import { uploadTmpKey } from '../media/keys'
import { presignPut } from '../media/s3'
import { type Actor, badRequest, notFound, thumbUrl } from './common'
import { publishPendingEmojis } from './emojis'
import { UPLOAD_MAX_BYTES, UPLOAD_TYPES } from './inputs'
import type { MediaDeps } from './maintain'
import type { SignedUpload, UploadStage, UploadState } from './types'

// 上传中心: staff upload straight into an existing pack, through the same pipeline as submissions
// (docs/ARCHITECTURE.md §5.2): presigned PUT into uploads/tmp/ → media.ingest (validate, SHA-256 dedupe
// within the pack, copy the original, pending emoji) → media.derive 'review'. Staff uploads skip review:
// once the review previews exist, advanceUploads publishes them (review/ → derived/) right away.

const TYPES = new Set<string>(UPLOAD_TYPES)

export async function signUploads(
  actor: Actor,
  input: { packId: number; files: { name: string; size: number; type: string }[] },
): Promise<SignedUpload[]> {
  const { packs, uploadItems } = schema
  const [pack] = await db().select({ id: packs.id, title: packs.title }).from(packs).where(eq(packs.id, input.packId))
  if (!pack) throw notFound('目标表情包')
  for (const f of input.files) {
    if (!TYPES.has(f.type)) throw badRequest(`「${f.name}」不是 GIF、PNG、WebP 或 JPEG 图片`)
    if (f.size > UPLOAD_MAX_BYTES) throw badRequest(`「${f.name}」超过 ${UPLOAD_MAX_BYTES / 1024 / 1024} MB`)
  }
  const out: SignedUpload[] = []
  for (const f of input.files) {
    const id = crypto.randomUUID()
    const tmpKey = uploadTmpKey(id, f.name)
    await db().insert(uploadItems).values({ id, packId: pack.id, uploaderId: actor.id, tmpKey, filename: f.name.slice(0, 200), bytes: f.size, mime: f.type, status: 'signed' })
    out.push({ id, filename: f.name, url: await presignPut(tmpKey, f.type), contentType: f.type })
  }
  await audit(actor, 'upload.sign', { type: 'pack', id: pack.id }, { files: input.files.length, uploads: out.map((u) => u.id) })
  return out
}

/** The browser finished its PUTs: queue ingest for each (own uploads only). */
export async function completeUploads(actor: Actor, ids: string[], deps: MediaDeps) {
  const { uploadItems } = schema
  const rows = await db()
    .update(uploadItems)
    .set({ status: 'uploaded' })
    .where(and(inArray(uploadItems.id, ids), eq(uploadItems.uploaderId, actor.id), eq(uploadItems.status, 'signed')))
    .returning({ id: uploadItems.id, packId: uploadItems.packId })
  for (const r of rows) await deps.enqueueIngest(r.id)
  if (rows.length) await audit(actor, 'upload.complete', { type: 'pack', id: rows[0]!.packId }, { uploads: rows.map((r) => r.id) })
  return { queued: rows.length }
}

/**
 * Progress of a batch, publishing what is ready. Polled by the upload page; safe to call repeatedly:
 * a finished upload whose emoji is still pending is published once its review previews exist.
 */
export async function advanceUploads(actor: Actor, ids: string[], deps: MediaDeps): Promise<UploadState[]> {
  const { uploadItems, emojis } = schema
  const load = () =>
    db()
      .select({ item: uploadItems, emoji: emojis })
      .from(uploadItems)
      .leftJoin(emojis, eq(emojis.id, uploadItems.emojiId))
      .where(and(inArray(uploadItems.id, ids), eq(uploadItems.uploaderId, actor.id)))
  let rows = await load()
  const ready = rows.filter((r) => r.item.status === 'done' && r.emoji?.status === 'pending').map((r) => r.emoji!.id)
  if (ready.length) {
    await publishPendingEmojis(actor, ready, deps)
    rows = await load()
  }
  return rows.map(({ item, emoji }) => {
    let stage: UploadStage = item.status
    if (item.status === 'done' && emoji && emoji.status !== 'pending') stage = 'published'
    return {
      id: item.id,
      filename: item.filename,
      bytes: item.bytes,
      stage,
      error: item.error,
      emojiId: item.emojiId,
      thumb: emoji ? thumbUrl(emoji) : null,
    }
  })
}
