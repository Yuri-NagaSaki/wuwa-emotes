import { beforeAll, describe, expect, test } from 'bun:test'
import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { unzipSync } from 'fflate'
import { db, schema } from '../../src/server/db/client'
import { formatCreditsDate } from '../../src/server/media/credits'
import { originalKey, zipKey } from '../../src/server/media/keys'
import { deleteObjects, getObjectBytes, headObject, listKeys, putObject } from '../../src/server/media/s3'
import { buildPackZip, packContentHash, zipEntryNames } from '../../src/server/media/zip'
import { newEmojiId } from '../../src/shared/ids'
import { emptyBucket, insertPack, makeGif, makePng, resetDb, setupTestEnv } from './helpers'

const NOW = new Date('2026-10-20T02:00:00Z')
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

interface Made {
  id: string
  body: Uint8Array
  ext: string
  sortOrder: number
}

async function addEmoji(packId: number, packKey: string, body: Uint8Array, ext: string, sortOrder: number, opts: { status?: 'published' | 'pending' | 'hidden'; withHash?: boolean } = {}) {
  const id = newEmojiId()
  const key = originalKey(packKey, id, ext)
  await putObject(key, body, ext === 'gif' ? 'image/gif' : 'image/png')
  await db()
    .insert(schema.emojis)
    .values({
      id,
      packId,
      storagePackKey: packKey,
      status: opts.status ?? 'published',
      sortOrder,
      originalKey: key,
      format: ext,
      mime: `image/${ext}`,
      bytes: body.byteLength,
      sha256: opts.withHash === false ? null : sha(body),
    })
  return { id, body, ext, sortOrder }
}

function unzip(bytes: Uint8Array) {
  const methods: Record<string, number> = {}
  const files = unzipSync(bytes, {
    filter: (f) => {
      methods[f.name] = f.compression
      return true
    },
  })
  return { files, methods }
}

let pack: typeof schema.packs.$inferSelect
let published: Made[] = []
let pending: Made

beforeAll(async () => {
  await setupTestEnv()
  await resetDb()
  await emptyBucket()
  pack = await insertPack({
    packKey: 'zip-a',
    slug: 'zip-pack',
    title: '测试打包表情',
    status: 'published',
    downloadable: true,
    license: 'cc-by-nc-sa-4.0',
    sourceUrl: 'https://emoji.wuwa.games/archives/zip-a',
    commissioner: '某群友',
    creditsText: '转载请注明出处',
  })
  const [a1] = await db().insert(schema.artists).values({ slug: 'wuxue', name: '雾雪' }).returning()
  const [a2] = await db().insert(schema.artists).values({ slug: 'yuegao', name: '约稿甲' }).returning()
  await db()
    .insert(schema.packArtists)
    .values([
      { packId: pack.id, artistId: a1!.id, role: 'artist' },
      { packId: pack.id, artistId: a2!.id, role: 'commissioner' },
    ])
  // sort order is deliberately not insertion order
  const order = [5, 0, 9, 2, 7, 1, 10, 3, 8, 4, 6]
  published = []
  for (const [i, sortOrder] of order.entries()) {
    const body = i % 3 === 0 ? await makePng(20 + i, 20, 100 + i) : await makeGif(24, 24, 2, 100 + i)
    published.push(await addEmoji(pack.id, 'zip-a', body, i % 3 === 0 ? 'png' : 'gif', sortOrder, { withHash: i % 2 === 0 }))
  }
  pending = await addEmoji(pack.id, 'zip-a', await makePng(9, 9, 1), 'png', 11, { status: 'pending' })
  await addEmoji(pack.id, 'zip-a', await makePng(9, 9, 2), 'png', 12, { status: 'hidden' })
})

describe('zip.build', () => {
  let firstKey = ''

  test('streams published originals into a store-mode ZIP with CREDITS.txt', async () => {
    const r = await buildPackZip(pack.id, { now: NOW })
    expect(r.status).toBe('built')
    const built = r as { key: string; bytes: number; hash: string }
    const rows = await db().select().from(schema.emojis).where(eq(schema.emojis.packId, pack.id))
    const expectedHash = packContentHash(rows.filter((x) => x.status === 'published'))
    expect(built.hash).toBe(expectedHash)
    expect(built.key).toBe(zipKey('zip-a', expectedHash.slice(0, 8)))
    firstKey = built.key

    const head = await headObject(built.key)
    expect(head?.ContentType).toBe('application/zip')
    expect(head?.ContentLength).toBe(built.bytes)
    const [artifact] = await db().select().from(schema.zipArtifacts).where(eq(schema.zipArtifacts.packId, pack.id))
    expect(artifact).toMatchObject({ contentHash: expectedHash, objectKey: built.key, bytes: built.bytes })

    const { files, methods } = unzip(await getObjectBytes(built.key))
    const sorted = [...published].sort((a, b) => a.sortOrder - b.sortOrder)
    const names = sorted.map((e, i) => `zip-pack-${String(i + 1).padStart(2, '0')}.${e.ext}`)
    expect(Object.keys(files)).toEqual([...names, 'CREDITS.txt'])
    sorted.forEach((e, i) => expect(sha(files[names[i]!]!)).toBe(sha(e.body)))
    expect(Object.values(methods).every((m) => m === 0)).toBe(true)

    const credits = new TextDecoder().decode(files['CREDITS.txt'])
    expect(credits).toContain('表情包：测试打包表情')
    expect(credits).toContain('画师：雾雪')
    expect(credits).toContain('约稿：某群友、约稿甲')
    expect(credits).toContain('许可：CC BY-NC-SA 4.0')
    expect(credits).toContain('来源：https://emoji.wuwa.games/archives/zip-a')
    expect(credits).toContain('本站页面：http://localhost:3000/packs/zip-pack')
    expect(credits).toContain('转载请注明出处')
    expect(credits).toContain(`打包自 潮池（http://localhost:3000） · ${formatCreditsDate(NOW)}`)
  })

  test('an unchanged pack is skipped by content hash', async () => {
    expect(await buildPackZip(pack.id, { now: NOW })).toMatchObject({ status: 'unchanged', key: firstKey })
    expect(await listKeys('zips/v1/packs/zip-a/')).toEqual([firstKey])
  })

  test('new content gets a new object and the old ZIP is deleted', async () => {
    await db().update(schema.emojis).set({ status: 'published' }).where(eq(schema.emojis.id, pending.id))
    const r = await buildPackZip(pack.id, { now: NOW })
    expect(r.status).toBe('built')
    const key = (r as { key: string }).key
    expect(key).not.toBe(firstKey)
    expect(await listKeys('zips/v1/packs/zip-a/')).toEqual([key])
    const { files } = unzip(await getObjectBytes(key))
    expect(Object.keys(files).length).toBe(published.length + 2)
    expect(files['zip-pack-12.png']).toBeDefined()
  })

  test('a recorded ZIP whose object vanished is rebuilt', async () => {
    const [artifact] = await db().select().from(schema.zipArtifacts).where(eq(schema.zipArtifacts.packId, pack.id))
    await deleteObjects([artifact!.objectKey])
    const r = await buildPackZip(pack.id, { now: NOW })
    expect(r).toMatchObject({ status: 'built', key: artifact!.objectKey })
    expect(await headObject(artifact!.objectKey)).not.toBeNull()
  })

  test('only published, downloadable packs are built', async () => {
    const off = await insertPack({ packKey: 'zip-off', status: 'published', downloadable: false })
    await addEmoji(off.id, 'zip-off', await makePng(8, 8, 3), 'png', 0)
    const draft = await insertPack({ packKey: 'zip-draft', status: 'draft', downloadable: true })
    await addEmoji(draft.id, 'zip-draft', await makePng(8, 8, 4), 'png', 0)
    const empty = await insertPack({ packKey: 'zip-empty', status: 'published', downloadable: true })
    expect((await buildPackZip(off.id)).status).toBe('skipped')
    expect((await buildPackZip(draft.id)).status).toBe('skipped')
    expect(await buildPackZip(empty.id)).toEqual({ status: 'skipped', reason: 'pack has no published emojis' })
    expect((await buildPackZip(999_999)).status).toBe('skipped')
    expect(await listKeys('zips/v1/packs/zip-off/')).toEqual([])
    expect(await listKeys('zips/v1/packs/zip-draft/')).toEqual([])
  })

  test('archives larger than one upload part go up as multipart', async () => {
    const big = await insertPack({ packKey: 'zip-big', status: 'published', downloadable: true })
    const blobs: Made[] = []
    for (let i = 0; i < 3; i++) blobs.push(await addEmoji(big.id, 'zip-big', randomBytes(4 * 1024 * 1024), 'gif', i))
    const r = await buildPackZip(big.id, { now: NOW })
    expect(r.status).toBe('built')
    const built = r as { key: string; bytes: number }
    expect(built.bytes).toBeGreaterThan(12 * 1024 * 1024)
    const { files } = unzip(await getObjectBytes(built.key))
    blobs.forEach((b, i) => expect(sha(files[`zip-big-0${i + 1}.gif`]!)).toBe(sha(b.body)))
  })
})

describe('zip helpers', () => {
  test('entry names: pack order, at least two digits, more for big packs', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ originalKey: `assets/v1/packs/p/emojis/r-x.${i % 2 ? 'gif' : 'png'}`, format: 'gif' }))
    const names = zipEntryNames('big-pack', many)
    expect(names[0]).toBe('big-pack-001.png')
    expect(names[119]).toBe('big-pack-120.gif')
    expect(zipEntryNames('a/b', [{ originalKey: 'k', format: 'jpeg' }])).toEqual(['a-b-01.jpg'])
  })

  test('content hash: independent of order; byte size stands in for a missing sha256', () => {
    const a = { id: 'r-00000000000000000001', sha256: 'aa', bytes: 1 }
    const b = { id: 'r-00000000000000000002', sha256: null, bytes: 7 }
    expect(packContentHash([a, b])).toBe(packContentHash([b, a]))
    expect(packContentHash([a, b])).not.toBe(packContentHash([a, { ...b, bytes: 8 }]))
  })
})
