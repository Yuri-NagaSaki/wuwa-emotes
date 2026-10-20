import { beforeAll, describe, expect, test } from 'bun:test'
import { eq, isNull } from 'drizzle-orm'
import { db, schema } from '../../src/server/db/client'
import { backfillDims, parseHeaderDims } from '../../src/server/import/dims'
import { importV1 } from '../../src/server/import/v1'
import { putObject } from '../../src/server/media/s3'
import { newEmojiId } from '../../src/shared/ids'
import { emptyBucket, insertPack, makeGif, makeJpeg, makePng, makeWebp, resetDb, setupTestEnv } from '../media/helpers'
import { type FixtureEmoji, uploadV1Fixture } from './fixture'

let fixture: { emojis: FixtureEmoji[] }
const extra: { id: string; width: number; height: number }[] = []
let brokenId = ''

beforeAll(async () => {
  await setupTestEnv()
  await resetDb()
  await emptyBucket()
  fixture = await uploadV1Fixture()
  await importV1()

  // originals that need the sharp fallback, and one that cannot be read
  const pack = await insertPack({ packKey: 'dims-extra', status: 'published' })
  const add = async (format: string, body: Uint8Array) => {
    const id = newEmojiId()
    const key = `assets/v1/packs/dims-extra/emojis/${id}.${format === 'jpeg' ? 'jpg' : format}`
    await putObject(key, body, `image/${format}`)
    await db()
      .insert(schema.emojis)
      .values({ id, packId: pack.id, storagePackKey: 'dims-extra', status: 'published', originalKey: key, format, mime: `image/${format}`, bytes: body.byteLength })
    return id
  }
  extra.push({ id: await add('webp', await makeWebp(90, 30, 7)), width: 90, height: 30 })
  extra.push({ id: await add('jpeg', await makeJpeg(33, 44, 8)), width: 33, height: 44 })
  brokenId = await add('gif', new TextEncoder().encode('definitely not an image'))
})

describe('parseHeaderDims', () => {
  test('GIF logical screen size and PNG IHDR', async () => {
    expect(parseHeaderDims((await makeGif(300, 200, 2, 1)).subarray(0, 32))).toEqual({ format: 'gif', width: 300, height: 200 })
    expect(parseHeaderDims((await makePng(500, 1, 2)).subarray(0, 32))).toEqual({ format: 'png', width: 500, height: 1 })
  })

  test('anything else, or a truncated header, is not parsed', async () => {
    expect(parseHeaderDims((await makeWebp(10, 10, 1)).subarray(0, 32))).toBeNull()
    expect(parseHeaderDims((await makePng(10, 10, 1)).subarray(0, 20))).toBeNull()
    expect(parseHeaderDims(new Uint8Array(0))).toBeNull()
  })
})

describe('backfill-dims', () => {
  test('fills width and height from 32-byte ranged reads, with sharp for WebP/JPEG', async () => {
    const r = await backfillDims({ concurrency: 4, batchSize: 7 })
    expect(r.scanned).toBe(23)
    expect(r.updated).toBe(22)
    expect(r.viaSharp).toBe(2)
    expect(r.failed.map((f) => f.id)).toEqual([brokenId])

    const rows = await db().select({ id: schema.emojis.id, width: schema.emojis.width, height: schema.emojis.height }).from(schema.emojis)
    const by = new Map(rows.map((x) => [x.id, x]))
    for (const f of [...fixture.emojis, ...extra]) expect(by.get(f.id)).toMatchObject({ width: f.width, height: f.height })
  })

  test('resumable: only rows without a width are read again', async () => {
    const again = await backfillDims({ concurrency: 4 })
    expect(again).toMatchObject({ scanned: 1, updated: 0 })

    const target = fixture.emojis.slice(0, 3).map((e) => e.id)
    for (const id of target) await db().update(schema.emojis).set({ width: null, height: null }).where(eq(schema.emojis.id, id))
    const limited = await backfillDims({ limit: 2 })
    expect(limited.scanned).toBe(2)
    const rest = await backfillDims({})
    expect(limited.updated + rest.updated).toBe(3)
    const missing = await db().select({ id: schema.emojis.id }).from(schema.emojis).where(isNull(schema.emojis.width))
    expect(missing.map((m) => m.id)).toEqual([brokenId])
  })
})
