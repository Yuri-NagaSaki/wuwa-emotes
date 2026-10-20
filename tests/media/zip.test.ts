import { beforeAll, describe, expect, test } from 'bun:test'
import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { unzipSync } from 'fflate'
import { db, schema } from '../../src/server/db/client'
import { formatCreditsDate } from '../../src/server/media/credits'
import { originalKey, zipKey } from '../../src/server/media/keys'
import { deleteObjects, getObjectBytes, headObject, listKeys, putObject } from '../../src/server/media/s3'
import { buildPackZip, loadPackZipSource, packContentHash, zipEntryName, zipEntryNames } from '../../src/server/media/zip'
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
    const source = await loadPackZipSource(pack.id)
    if (!source.ok) throw new Error(source.reason)
    const expectedHash = source.source.hash
    expect(source.source.emojis.map((e) => e.id)).toEqual([...published].sort((a, b) => a.sortOrder - b.sortOrder).map((e) => e.id))
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
    expect(credits).not.toContain('来源')
    expect(credits).not.toContain('wuwa.games')
    expect(credits).toContain('本站页面：http://localhost:3000/packs/zip-pack')
    expect(credits).toContain('转载请注明出处')
    expect(credits).toContain(`打包自 潮池（http://localhost:3000） · ${formatCreditsDate(NOW)}`)
  })

  test('an unchanged pack is skipped by content hash', async () => {
    expect(await buildPackZip(pack.id, { now: NOW })).toMatchObject({ status: 'unchanged', key: firstKey })
    expect(await listKeys('zips/v1/packs/zip-a/')).toEqual([firstKey])
  })

  test('the same data on another day keeps the hash (CREDITS.txt date is not part of it)', async () => {
    const nextDay = new Date(NOW.getTime() + 36 * 3600_000)
    expect(formatCreditsDate(nextDay)).not.toBe(formatCreditsDate(NOW))
    expect(await buildPackZip(pack.id, { now: nextDay })).toMatchObject({ status: 'unchanged', key: firstKey })
  })

  test('changing the pack title changes the hash and rebuilds with the new CREDITS.txt', async () => {
    const before = await loadPackZipSource(pack.id)
    await db().update(schema.packs).set({ title: '改名后的表情包' }).where(eq(schema.packs.id, pack.id))
    const after = await loadPackZipSource(pack.id)
    if (!before.ok || !after.ok) throw new Error('pack should be zippable')
    expect(after.source.hash).not.toBe(before.source.hash)

    const r = await buildPackZip(pack.id, { now: NOW })
    expect(r).toMatchObject({ status: 'built', hash: after.source.hash })
    const key = (r as { key: string }).key
    expect(key).not.toBe(firstKey)
    expect(await listKeys('zips/v1/packs/zip-a/')).toEqual([key])
    const credits = new TextDecoder().decode(unzip(await getObjectBytes(key)).files['CREDITS.txt'])
    expect(credits).toContain('表情包：改名后的表情包')
    firstKey = key
  })

  test('changing an artist credit changes the hash', async () => {
    const before = await loadPackZipSource(pack.id)
    const [a3] = await db().insert(schema.artists).values({ slug: 'xinhuashi', name: '新画师' }).returning()
    await db().insert(schema.packArtists).values({ packId: pack.id, artistId: a3!.id, role: 'artist' })
    const after = await loadPackZipSource(pack.id)
    if (!before.ok || !after.ok) throw new Error('pack should be zippable')
    expect(after.source.hash).not.toBe(before.source.hash)
    const r = await buildPackZip(pack.id, { now: NOW })
    expect(r.status).toBe('built')
    firstKey = (r as { key: string }).key
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

describe('zip.build failures', () => {
  const withTimeout = <T>(p: Promise<T>, ms: number) =>
    Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no result after ${ms} ms (hung?)`)), ms))])

  test('a missing original fails the build without leaving an object or touching the artifact', async () => {
    const p = await insertPack({ packKey: 'zip-broken', status: 'published', downloadable: true })
    for (let i = 0; i < 4; i++) await addEmoji(p.id, 'zip-broken', await makePng(10 + i, 10, 200 + i), 'png', i)
    const ok = await buildPackZip(p.id, { now: NOW })
    expect(ok.status).toBe('built')
    const [before] = await db().select().from(schema.zipArtifacts).where(eq(schema.zipArtifacts.packId, p.id))

    // a fifth emoji whose original is gone: the stream fails on that entry
    const lost = await addEmoji(p.id, 'zip-broken', await makePng(9, 9, 250), 'png', 2)
    await deleteObjects([originalKey('zip-broken', lost.id, 'png')])
    await expect(withTimeout(buildPackZip(p.id, { now: NOW }), 20_000)).rejects.toThrow()

    const [after] = await db().select().from(schema.zipArtifacts).where(eq(schema.zipArtifacts.packId, p.id))
    expect(after).toEqual(before!)
    expect(await listKeys('zips/v1/packs/zip-broken/')).toEqual([before!.objectKey])
  })

  test('a failure after the first uploaded part aborts the multipart upload', async () => {
    const p = await insertPack({ packKey: 'zip-broken-big', status: 'published', downloadable: true })
    for (let i = 0; i < 2; i++) await addEmoji(p.id, 'zip-broken-big', randomBytes(6 * 1024 * 1024), 'gif', i)
    const lost = await addEmoji(p.id, 'zip-broken-big', randomBytes(1024), 'gif', 2)
    await deleteObjects([originalKey('zip-broken-big', lost.id, 'gif')])
    await expect(withTimeout(buildPackZip(p.id, { now: NOW }), 30_000)).rejects.toThrow()
    expect(await db().$count(schema.zipArtifacts, eq(schema.zipArtifacts.packId, p.id))).toBe(0)
    expect(await listKeys('zips/v1/packs/zip-broken-big/')).toEqual([])
  })
})

describe('zip helpers', () => {
  test('entry names: pack order, at least two digits, more for big packs', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ originalKey: `assets/v1/packs/p/emojis/r-x.${i % 2 ? 'gif' : 'png'}`, format: 'gif' }))
    const names = zipEntryNames('big-pack', many)
    expect(names[0]).toBe('big-pack-001.png')
    expect(names[119]).toBe('big-pack-120.gif')
    expect(zipEntryNames('a/b', [{ originalKey: 'k', format: 'jpeg' }])).toEqual(['a-b-01.jpg'])
    // the single-entry form (used for /dl/e save and batch filenames) agrees with the list form
    expect(zipEntryName('big-pack', 119, 120, many[119]!)).toBe(names[119]!)
    expect(zipEntryName('big-pack', 4, 9, many[4]!)).toBe('big-pack-05.png')
  })

  describe('content hash', () => {
    const a = { id: 'r-00000000000000000001', sha256: 'aa', bytes: 1, originalKey: 'assets/v1/packs/p/emojis/r-00000000000000000001.gif', format: 'gif' }
    const b = { id: 'r-00000000000000000002', sha256: null, bytes: 7, originalKey: 'assets/v1/packs/p/emojis/r-00000000000000000002.png', format: 'png' }
    const credits = {
      siteName: '潮池',
      siteUrl: 'http://localhost:3000/',
      packs: [{ title: '包', pageUrl: 'http://localhost:3000/packs/p', artists: ['甲'], commissioner: null, license: 'cc-by-4.0', note: null }],
    }
    const base = { slug: 'p', emojis: [a, b], credits }
    const hash = packContentHash(base)

    test('is deterministic', () => {
      expect(packContentHash({ ...base, emojis: [{ ...a }, { ...b }] })).toBe(hash)
    })

    test('the order of the entries (sort order) is part of it', () => {
      expect(packContentHash({ ...base, emojis: [b, a] })).not.toBe(hash)
    })

    test('byte size stands in for a missing sha256; a changed sha256 changes it', () => {
      expect(packContentHash({ ...base, emojis: [a, { ...b, bytes: 8 }] })).not.toBe(hash)
      expect(packContentHash({ ...base, emojis: [{ ...a, sha256: 'ab' }, b] })).not.toBe(hash)
    })

    test('entry names: the slug and the file extension are part of it', () => {
      expect(packContentHash({ ...base, slug: 'q' })).not.toBe(hash)
      expect(packContentHash({ ...base, emojis: [a, { ...b, originalKey: b.originalKey.replace('.png', '.gif') }] })).not.toBe(hash)
    })

    test('every CREDITS.txt field is part of it', () => {
      const p = credits.packs[0]!
      const variants = [
        { ...credits, siteName: '别的站' },
        { ...credits, siteUrl: 'https://example.test/' },
        { ...credits, packs: [{ ...p, title: '新标题' }] },
        { ...credits, packs: [{ ...p, artists: ['乙'] }] },
        { ...credits, packs: [{ ...p, commissioner: '约稿人' }] },
        { ...credits, packs: [{ ...p, license: 'cc-by-nc-sa-4.0' }] },
        { ...credits, packs: [{ ...p, note: '转载请注明' }] },
      ]
      const hashes = new Set(variants.map((c) => packContentHash({ ...base, credits: c })))
      expect(hashes.size).toBe(variants.length)
      expect(hashes.has(hash)).toBe(false)
    })
  })
})
