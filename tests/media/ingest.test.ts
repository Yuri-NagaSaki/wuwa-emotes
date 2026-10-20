import { beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { db, schema } from '../../src/server/db/client'
import { LIMITS } from '../../src/server/media/derive'
import { DUPLICATE_MESSAGE, findCrossPackDuplicates, type IngestDeps, ingestUpload } from '../../src/server/media/ingest'
import { originalKey, uploadTmpKey } from '../../src/server/media/keys'
import { copyObject, getObjectBytes, headObject, listKeys, putObject } from '../../src/server/media/s3'
import { newEmojiId } from '../../src/shared/ids'
import { emptyBucket, insertPack, insertUser, makeGif, makePng, resetDb, setupTestEnv } from './helpers'

const enqueued: string[] = []
const deps: IngestDeps = {
  async enqueueReview(id) {
    enqueued.push(id)
  },
}

let userId = ''
let packA = { id: 0, packKey: '' }
let packB = { id: 0, packKey: '' }
let gif: Buffer
let png: Buffer

async function stageUpload(packId: number, body: Uint8Array, filename: string, declaredMime: string, status: 'uploaded' | 'signed' = 'uploaded') {
  const uploadId = crypto.randomUUID()
  const tmpKey = uploadTmpKey(uploadId, filename)
  if (body.byteLength) await putObject(tmpKey, body, declaredMime)
  const [row] = await db()
    .insert(schema.uploadItems)
    .values({ id: uploadId, packId, uploaderId: userId, tmpKey, filename, bytes: body.byteLength, mime: declaredMime, status })
    .returning()
  return row!
}

async function uploadRow(id: string) {
  return (await db().select().from(schema.uploadItems).where(eq(schema.uploadItems.id, id)))[0]!
}

async function emojiRow(id: string) {
  return (await db().select().from(schema.emojis).where(eq(schema.emojis.id, id)))[0]
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

beforeAll(async () => {
  await setupTestEnv()
  await resetDb()
  await emptyBucket()
  userId = (await insertUser()).id
  packA = await insertPack({ packKey: 'ingest-a', ownerId: userId })
  packB = await insertPack({ packKey: 'ingest-b', ownerId: userId })
  gif = await makeGif(120, 90, 3, 11)
  png = await makePng(64, 48, 12)
})

describe('media.ingest', () => {
  let gifEmoji = ''

  test('GIF becomes a pending emoji with its own original and review previews queued', async () => {
    const u = await stageUpload(packA.id, gif, 'cat dance.gif', 'image/gif')
    const r = await ingestUpload(u.id, deps)
    expect(r.status).toBe('done')
    gifEmoji = (r as { emojiId: string }).emojiId
    const e = (await emojiRow(gifEmoji))!
    expect(e).toMatchObject({
      packId: packA.id,
      storagePackKey: 'ingest-a',
      status: 'pending',
      originalKey: originalKey('ingest-a', gifEmoji, 'gif'),
      format: 'gif',
      mime: 'image/gif',
      bytes: gif.byteLength,
      width: 120,
      height: 90,
      frames: 3,
      durationMs: 300,
      sha256: sha(gif),
      sortOrder: 0,
    })
    expect(await uploadRow(u.id)).toMatchObject({ status: 'done', emojiId: gifEmoji, error: null })
    expect(await headObject(u.tmpKey)).toBeNull()
    const orig = await headObject(e.originalKey)
    expect(orig?.ContentType).toBe('image/gif')
    expect(sha(await getObjectBytes(e.originalKey))).toBe(sha(gif))
    expect(enqueued).toContain(gifEmoji)
  })

  test('PNG: the detected format wins over the declared MIME type', async () => {
    const u = await stageUpload(packA.id, png, 'sticker.gif', 'image/gif')
    const r = await ingestUpload(u.id, deps)
    expect(r.status).toBe('done')
    const id = (r as { emojiId: string }).emojiId
    const e = (await emojiRow(id))!
    expect(e).toMatchObject({ format: 'png', mime: 'image/png', width: 64, height: 48, frames: 1, durationMs: null, sortOrder: 1 })
    expect(e.originalKey).toBe(originalKey('ingest-a', id, 'png'))
    expect((await headObject(e.originalKey))?.ContentType).toBe('image/png')
  })

  test('the same file again in the same pack is a duplicate and stores nothing', async () => {
    const before = await listKeys('assets/v1/packs/ingest-a/')
    const u = await stageUpload(packA.id, gif, 'again.gif', 'image/gif')
    const r = await ingestUpload(u.id, deps)
    expect(r).toEqual({ status: 'duplicate', emojiId: gifEmoji })
    expect(await uploadRow(u.id)).toMatchObject({ status: 'duplicate', emojiId: gifEmoji, error: DUPLICATE_MESSAGE })
    expect(await db().$count(schema.emojis, eq(schema.emojis.packId, packA.id))).toBe(2)
    expect(await listKeys('assets/v1/packs/ingest-a/')).toEqual(before)
    expect(await headObject(u.tmpKey)).toBeNull()
  })

  test('the same file in another pack is allowed, gets its own object, and is flagged', async () => {
    const u = await stageUpload(packB.id, gif, 'cat.gif', 'image/gif')
    const r = await ingestUpload(u.id, deps)
    expect(r.status).toBe('done')
    const id = (r as { emojiId: string }).emojiId
    expect(id).not.toBe(gifEmoji)
    const e = (await emojiRow(id))!
    expect(e.originalKey).toBe(originalKey('ingest-b', id, 'gif'))
    expect(await headObject(e.originalKey)).not.toBeNull()
    const dups = await findCrossPackDuplicates(id)
    expect(dups).toEqual([
      { emojiId: gifEmoji, status: 'pending', packId: packA.id, packKey: 'ingest-a', slug: 'ingest-a', title: 'ingest-a', packStatus: 'draft' },
    ])
    expect((await findCrossPackDuplicates(gifEmoji)).map((d) => d.emojiId)).toEqual([id])
  })

  test('oversize files are rejected from the HEAD alone', async () => {
    const big = new Uint8Array(LIMITS.maxBytes + 1)
    big.set(gif.subarray(0, 64))
    const u = await stageUpload(packA.id, big, 'huge.gif', 'image/gif')
    const r = await ingestUpload(u.id, deps)
    expect(r).toEqual({ status: 'failed', error: '文件超过 20 MB' })
    expect(await uploadRow(u.id)).toMatchObject({ status: 'failed', error: '文件超过 20 MB', emojiId: null })
    expect(await headObject(u.tmpKey)).toBeNull()
  })

  test('files that are not GIF/PNG/WebP/JPEG are rejected', async () => {
    const text = await stageUpload(packA.id, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.gif', 'image/gif')
    const r1 = await ingestUpload(text.id, deps)
    expect(r1.status).toBe('failed')
    expect((await uploadRow(text.id)).status).toBe('failed')

    const tiff = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#f00' } }).tiff().toBuffer()
    const t = await stageUpload(packA.id, tiff, 'x.tif', 'image/png')
    expect(await ingestUpload(t.id, deps)).toEqual({ status: 'failed', error: '只支持 GIF、PNG、WebP、JPEG' })

    const wide = await makePng(LIMITS.maxSide + 1, 4, 3)
    const w = await stageUpload(packA.id, wide, 'wide.png', 'image/png')
    expect(await ingestUpload(w.id, deps)).toEqual({ status: 'failed', error: `图片边长不能超过 ${LIMITS.maxSide}px` })
    expect(await db().$count(schema.emojis, eq(schema.emojis.packId, packA.id))).toBe(2)
  })

  test('a missing tmp object fails the upload', async () => {
    const u = await stageUpload(packA.id, new Uint8Array(0), 'gone.png', 'image/png', 'signed')
    const r = await ingestUpload(u.id, deps)
    expect(r.status).toBe('failed')
    expect((await uploadRow(u.id)).error).toContain('不存在')
  })

  test('a retry after a crash reuses the reserved id and object key', async () => {
    const png2 = await makePng(30, 30, 99)
    const u = await stageUpload(packA.id, png2, 'retry.png', 'image/png')
    // first attempt reserved an id and copied the original, then died before the insert
    const reserved = newEmojiId()
    await db().update(schema.uploadItems).set({ status: 'processing', emojiId: reserved }).where(eq(schema.uploadItems.id, u.id))
    await copyObject(u.tmpKey, originalKey('ingest-a', reserved, 'png'), 'image/png')
    const r = await ingestUpload(u.id, deps)
    expect(r).toEqual({ status: 'done', emojiId: reserved })
    expect(await listKeys(`assets/v1/packs/ingest-a/emojis/${reserved}`)).toEqual([originalKey('ingest-a', reserved, 'png')])

    // the job ran again after finishing (e.g. the enqueue failed): previews are queued again, nothing else
    enqueued.length = 0
    expect(await ingestUpload(u.id, deps)).toEqual({ status: 'skipped', reason: 'already done' })
    expect(enqueued).toEqual([reserved])
  })

  test('a retry that turns out to be a duplicate removes the copy its first attempt made', async () => {
    const u = await stageUpload(packA.id, gif, 'late-dup.gif', 'image/gif')
    const reserved = newEmojiId()
    await db().update(schema.uploadItems).set({ status: 'processing', emojiId: reserved }).where(eq(schema.uploadItems.id, u.id))
    await copyObject(u.tmpKey, originalKey('ingest-a', reserved, 'gif'), 'image/gif')
    expect(await ingestUpload(u.id, deps)).toEqual({ status: 'duplicate', emojiId: gifEmoji })
    expect(await headObject(originalKey('ingest-a', reserved, 'gif'))).toBeNull()
    expect(await headObject(u.tmpKey)).toBeNull()
    expect(await emojiRow(reserved)).toBeUndefined()
  })

  test('unknown upload ids are skipped', async () => {
    expect((await ingestUpload(crypto.randomUUID(), deps)).status).toBe('skipped')
  })
})
