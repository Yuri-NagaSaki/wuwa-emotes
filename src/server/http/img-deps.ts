import { S3ServiceException } from '@aws-sdk/client-s3'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/client'
import { sendJob } from '../jobs/boss'
import { Q } from '../jobs/queues'
import type { EmojiForFull, ImgDeps, ImgObject } from '../media/img'
import { getObject, isNotFound } from '../media/s3'

// Real dependencies for handleImg (src/server/media/img.ts) and the /review-img route.
// Nothing here touches sessions or cookies: /img must stay cacheable by Cloudflare.

function isNotModified(err: unknown): boolean {
  return err instanceof S3ServiceException && (err.$metadata.httpStatusCode === 304 || err.name === 'NotModified')
}

/** Stream an object from the bucket. Missing → null; a matching If-None-Match → notModified. */
export async function getImgObject(key: string, ifNoneMatch?: string): Promise<ImgObject | null> {
  try {
    const res = await getObject(key, { ifNoneMatch })
    return {
      body: res.Body ? res.Body.transformToWebStream() : null,
      contentLength: res.ContentLength,
      etag: res.ETag,
    }
  } catch (err) {
    // the SDK reports 304 as an error; the stored ETag is the one the client sent
    if (isNotModified(err)) return { body: null, notModified: true, etag: ifNoneMatch }
    if (isNotFound(err)) return null
    throw err
  }
}

/** One join: is this emoji (and its pack) published, and which key/rev do its derived objects use? */
export async function lookupEmojiForFull(emojiId: string): Promise<EmojiForFull | null> {
  const rows = await db()
    .select({
      status: schema.emojis.status,
      packStatus: schema.packs.status,
      storagePackKey: schema.emojis.storagePackKey,
      variantRev: schema.emojis.variantRev,
      frames: schema.emojis.frames,
    })
    .from(schema.emojis)
    .innerJoin(schema.packs, eq(schema.packs.id, schema.emojis.packId))
    .where(eq(schema.emojis.id, emojiId))
    .limit(1)
  return rows[0] ?? null
}

/** Queue the lazy `full` render. Exclusive queue + singleton key: repeated misses queue one job. */
export async function enqueueFull(emojiId: string): Promise<void> {
  await sendJob(Q.full, { emojiId }, { singletonKey: emojiId })
}

export const imgDeps: ImgDeps = {
  getObject: getImgObject,
  lookupEmoji: lookupEmojiForFull,
  enqueueFull,
}
