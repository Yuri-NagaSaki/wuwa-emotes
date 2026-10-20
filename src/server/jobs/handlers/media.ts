import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db/client'
import { log } from '../../log'
import { countFrames, dominantColor, oneImageAtATime, posterFrame, probe, renderA160, renderFull, renderP240 } from '../../media/derive'
import { IMMUTABLE } from '../../media/img'
import { derivedKey, reviewKey } from '../../media/keys'
import { getObjectBytes, headObject, putObject } from '../../media/s3'
import type { JobData } from '../queues'

async function loadEmoji(emojiId: string) {
  const rows = await db()
    .select({ emoji: schema.emojis, packStatus: schema.packs.status })
    .from(schema.emojis)
    .innerJoin(schema.packs, eq(schema.packs.id, schema.emojis.packId))
    .where(eq(schema.emojis.id, emojiId))
    .limit(1)
  return rows[0] ?? null
}

/**
 * p240 (+ a160 for animated) for one emoji. Pending emojis go to review/v1 (served only through the
 * authenticated preview route); published ones to derived/v1 (served through /img + CDN).
 */
export async function deriveEmoji({ emojiId, target }: JobData['media.derive']) {
  const row = await loadEmoji(emojiId)
  if (!row) return
  const e = row.emoji
  if (target === 'derived' && e.status !== 'published') {
    log().warn({ emojiId }, 'derive: refusing derived/ output for an unpublished emoji')
    return
  }
  const buf = await getObjectBytes(e.originalKey)
  const { p, poster, p240, a160, frames, color } = await oneImageAtATime(async () => {
    const p = await probe(buf)
    const poster = await posterFrame(buf, p)
    const p240 = await renderP240(buf, poster)
    let a160: Buffer | null = null
    let frames = p.frames
    if (p.animated) {
      a160 = await renderA160(buf, p)
      // The WebP encoder merges identical consecutive frames. One frame left means every frame of the
      // original is the same picture: the sticker is static as displayed, so no a160 and frames 1.
      if ((await countFrames(a160)) < 2) {
        log().info({ emojiId, frames: p.frames }, 'derive: every frame is identical; stored as static')
        a160 = null
        frames = 1
      }
    }
    return { p, poster, p240, a160, frames, color: await dominantColor(buf, poster) }
  })
  if (target === 'review') {
    await putObject(reviewKey('p240', e.storagePackKey, e.id), p240, 'image/webp', 'private, no-store')
    if (a160) await putObject(reviewKey('a160', e.storagePackKey, e.id), a160, 'image/webp', 'private, no-store')
  } else {
    await putObject(derivedKey('p240', e.storagePackKey, e.id, e.variantRev), p240, 'image/webp', IMMUTABLE)
    if (a160) await putObject(derivedKey('a160', e.storagePackKey, e.id, e.variantRev), a160, 'image/webp', IMMUTABLE)
  }
  await db()
    .update(schema.emojis)
    .set({
      width: p.width,
      height: p.height,
      frames,
      durationMs: frames > 1 ? p.durationMs : null,
      posterFrame: poster,
      dominantColor: color,
      // v1 imports have no hash yet; the original is already in memory here
      ...(e.sha256 ? {} : { sha256: createHash('sha256').update(buf).digest('hex') }),
      p240Bytes: p240.byteLength,
      a160Bytes: a160?.byteLength ?? null,
      ...(target === 'derived' ? { derivedReady: true } : {}),
    })
    .where(eq(schema.emojis.id, e.id))
}

/** Lazily generated full-size WebP for the single-emoji dialog. Published emojis only. */
export async function generateFull({ emojiId }: JobData['media.full']) {
  const row = await loadEmoji(emojiId)
  if (!row || row.emoji.status !== 'published' || row.packStatus !== 'published') {
    log().warn({ emojiId }, 'full: refusing (missing or not published)')
    return
  }
  const e = row.emoji
  const key = derivedKey('full', e.storagePackKey, e.id, e.variantRev)
  if (!(await headObject(key))) {
    const buf = await getObjectBytes(e.originalKey)
    const out = await oneImageAtATime(async () => {
      const p = await probe(buf)
      const out = await renderFull(buf, p)
      // merged identical frames are fine; only a known animation collapsing to one frame is an error
      if (p.animated && e.frames > 1 && (await countFrames(out)) < 2) throw new Error(`full for ${emojiId} lost its animation`)
      return out
    }, 'low')
    await putObject(key, out, 'image/webp', IMMUTABLE)
    await db().update(schema.emojis).set({ fullReady: true, fullBytes: out.byteLength }).where(eq(schema.emojis.id, e.id))
  } else if (!e.fullReady) {
    await db().update(schema.emojis).set({ fullReady: true }).where(eq(schema.emojis.id, e.id))
  }
}
