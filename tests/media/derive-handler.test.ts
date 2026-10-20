import { beforeAll, describe, expect, test } from 'bun:test'
import sharp from 'sharp'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../src/server/db/client'
import { deriveEmoji } from '../../src/server/jobs/handlers/media'
import { derivedKey, originalKey } from '../../src/server/media/keys'
import { headObject, putObject } from '../../src/server/media/s3'
import { newEmojiId } from '../../src/shared/ids'
import { emptyBucket, insertPack, makeGif, resetDb, setupTestEnv } from './helpers'

const PK = 'derive-handler'
let packId = 0

async function addGif(gif: Buffer) {
  const id = newEmojiId()
  const key = originalKey(PK, id, 'gif')
  await putObject(key, gif, 'image/gif', 'private, no-store')
  await db()
    .insert(schema.emojis)
    .values({ id, packId, storagePackKey: PK, status: 'published', originalKey: key, format: 'gif', mime: 'image/gif', bytes: gif.byteLength, frames: 1, variantRev: 1 })
  return id
}

const row = async (id: string) => (await db().select().from(schema.emojis).where(eq(schema.emojis.id, id)))[0]!

beforeAll(async () => {
  await setupTestEnv()
  await resetDb()
  await emptyBucket()
  packId = (await insertPack({ packKey: PK, status: 'published' })).id
})

describe('deriveEmoji', () => {
  test('animated GIF: p240 and a160 in derived/, frames recorded', async () => {
    const id = await addGif(await makeGif(64, 48, 4, 3))
    await deriveEmoji({ emojiId: id, target: 'derived' })
    const e = await row(id)
    expect(e).toMatchObject({ derivedReady: true, frames: 4 })
    expect(e.a160Bytes).toBeGreaterThan(0)
    expect(await headObject(derivedKey('a160', PK, id, 1))).not.toBeNull()
  })

  test('GIF whose frames are all identical is stored as static: no a160, frames 1', async () => {
    // sharp's GIF encoder merges identical frames itself, so repeat one encoded frame block instead,
    // the way some of the v1 originals were written
    const one = await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: 200, g: 120, b: 40, alpha: 1 } } })
      .gif({ delay: [30], loop: 0 })
      .toBuffer()
    const start = one.indexOf(Buffer.from([0x21, 0xf9, 0x04]))
    expect(start).toBeGreaterThan(0)
    expect(one[one.length - 1]).toBe(0x3b)
    const frame = one.subarray(start, one.length - 1)
    const gif = Buffer.concat([one.subarray(0, start), ...Array.from({ length: 6 }, () => frame), Buffer.from([0x3b])])
    expect((await sharp(gif, { animated: true }).metadata()).pages).toBe(6)
    const id = await addGif(gif)
    await deriveEmoji({ emojiId: id, target: 'derived' })
    const e = await row(id)
    expect(e).toMatchObject({ derivedReady: true, frames: 1, durationMs: null, a160Bytes: null })
    expect(await headObject(derivedKey('p240', PK, id, 1))).not.toBeNull()
    expect(await headObject(derivedKey('a160', PK, id, 1))).toBeNull()
  })
})
