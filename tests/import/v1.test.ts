import { beforeAll, describe, expect, test } from 'bun:test'
import { asc, eq } from 'drizzle-orm'
import { db, schema } from '../../src/server/db/client'
import { importV1, isOfficialPack, loadV1Snapshot } from '../../src/server/import/v1'
import { emptyBucket, resetDb, setupTestEnv } from '../media/helpers'
import { buildV1Fixture, type FixtureEmoji, HASH, PACK, uploadV1Fixture } from './fixture'

let fixture: { emojis: FixtureEmoji[] }

async function tableCounts() {
  const d = db()
  const s = schema
  return {
    packs: await d.$count(s.packs),
    emojis: await d.$count(s.emojis),
    characters: await d.$count(s.characters),
    artists: await d.$count(s.artists),
    tags: await d.$count(s.tags),
    packCharacters: await d.$count(s.packCharacters),
    packArtists: await d.$count(s.packArtists),
    packTags: await d.$count(s.packTags),
    emojiCharacters: await d.$count(s.emojiCharacters),
    redirects: await d.$count(s.redirects),
  }
}

beforeAll(async () => {
  await setupTestEnv()
  await resetDb()
  await emptyBucket()
  fixture = await uploadV1Fixture()
})

describe('import-v1', () => {
  test('dry run reports the plan and writes nothing', async () => {
    const s = await importV1({ dryRun: true })
    expect(s.dryRun).toBe(true)
    expect(s.packs).toEqual({ total: 5, published: 4, draft: 1, official: 1, new: 5 })
    expect(s.emojis).toEqual({ total: 20, new: 20 })
    const counts = await tableCounts()
    expect(Object.values(counts).every((n) => n === 0)).toBe(true)
  })

  test('first run maps the snapshot', async () => {
    const s = await importV1()
    expect(s.packs).toEqual({ total: 5, published: 4, draft: 1, official: 1, new: 5 })
    expect(s.emojis).toEqual({ total: 20, new: 20 })
    expect(s.characters).toEqual({ total: 8, new: 8, renamed: 4 })
    expect(s.artists).toEqual({ total: 5, new: 5 })
    expect(s.tags).toEqual({ total: 5, new: 5 })
    expect(s.redirects).toBe(17)
    expect(s.warnings.some((w) => w.includes('unknown character slug "nobody"'))).toBe(true)
    expect(s.warnings.some((w) => w.includes('猫屋敷梨梨&春也Haruya') && w.includes('猫屋敷梨梨_春也Haruya'))).toBe(true)

    expect(await tableCounts()).toEqual({
      packs: 5,
      emojis: 20,
      characters: 8,
      artists: 5,
      tags: 5,
      packCharacters: 9,
      packArtists: 5,
      packTags: 6,
      emojiCharacters: 21,
      redirects: 17,
    })
  })

  test('packs: slug kept, downloadable off, official and draft detected', async () => {
    const rows = await db().select().from(schema.packs).orderBy(asc(schema.packs.packKey))
    const by = Object.fromEntries(rows.map((r) => [r.packKey, r]))
    for (const r of rows) {
      expect(r.slug).toBe(r.packKey)
      expect(r.downloadable).toBe(false)
      expect(r.license).toBe('unknown')
    }
    const a = by[PACK.aimisi]!
    expect(a).toMatchObject({
      status: 'published',
      sourceKind: 'community',
      title: '爱弥斯动态表情包（板牌）',
      legacyPostName: 'emoji-post-aimisi01',
      sourceUrl: 'https://emoji.wuwa.games/archives/aimisi-01',
      pinLevel: 1,
      kind: 'animated',
      emojiCount: 6,
      downloadCount: 2225,
      favoriteCount: 4,
    })
    expect(a.publishedAt?.toISOString()).toBe('2026-08-06T16:12:47.699Z')
    const aimisiEmojis = fixture.emojis.filter((e) => e.packKey === PACK.aimisi)
    expect(a.coverEmojiId).toBe(aimisiEmojis[1]!.id)
    expect(by[PACK.changli]).toMatchObject({ kind: 'static', excerpt: '静态表情', emojiCount: 6 })
    expect(by[PACK.changli]!.coverEmojiId).toBe(fixture.emojis.find((e) => e.packKey === PACK.changli)!.id)
    expect(by[PACK.jinhsi]).toMatchObject({ kind: 'mixed', memorial: true, excerpt: null })
    expect(by[PACK.official]).toMatchObject({ sourceKind: 'official', pinLevel: -1, status: 'published' })
    expect(by[PACK.noAssets]).toMatchObject({ status: 'draft', emojiCount: 0, coverEmojiId: null, publishedAt: null })
  })

  test('emojis: v1 ids, original keys, order; dimensions left for the backfill', async () => {
    const rows = await db().select().from(schema.emojis)
    const by = new Map(rows.map((r) => [r.id, r]))
    for (const f of fixture.emojis) {
      const r = by.get(f.id)!
      expect(r).toMatchObject({
        storagePackKey: f.packKey,
        originalKey: `assets/v1/packs/${f.packKey}/emojis/${f.id}.${f.format}`,
        format: f.format,
        mime: `image/${f.format}`,
        bytes: f.bytes,
        status: 'published',
        width: null,
        height: null,
        sha256: null,
        derivedReady: false,
      })
    }
    const changli = rows.filter((r) => r.storagePackKey === PACK.changli).sort((x, y) => x.sortOrder - y.sortOrder)
    expect(changli.map((r) => r.id)).toEqual(fixture.emojis.filter((e) => e.packKey === PACK.changli).map((e) => e.id))
  })

  test('characters: readable slugs kept, hash slugs become pinyin with a legacy slug', async () => {
    const rows = await db().select().from(schema.characters)
    const by = Object.fromEntries(rows.map((r) => [r.name, r]))
    expect(by['爱弥斯']).toMatchObject({ slug: 'aimisi', legacySlug: null, packCount: 1, emojiCount: 6 })
    expect(by['今汐']).toMatchObject({ slug: 'jinhsi', legacySlug: null })
    expect(by['椿']).toMatchObject({ slug: 'chun', legacySlug: HASH.chun, packCount: 1, emojiCount: 3 })
    expect(by['秧秧·玄翎']).toMatchObject({ slug: 'yangyang-xuanling', legacySlug: HASH.xuanling })
    expect(by['守岸人']).toMatchObject({ slug: 'shouanren', legacySlug: HASH.shouanren })
    expect(by['阿布']).toMatchObject({ slug: 'abu', legacySlug: HASH.abu, packCount: 1, emojiCount: 3 })
    // only in the 角色 facet
    expect(by['漂泊者']).toMatchObject({ slug: 'piaobozhe', legacySlug: null, packCount: 1, emojiCount: 0 })
  })

  test('artists: names trimmed, near-duplicates kept apart', async () => {
    const rows = await db().select().from(schema.artists)
    const by = Object.fromEntries(rows.map((r) => [r.name, r]))
    expect(Object.keys(by).sort()).toEqual(['0糖红茶', '爱秧斯坦', '猫屋敷梨梨&春也Haruya', '猫屋敷梨梨_春也Haruya', '雾雪'].sort())
    expect(by['雾雪']).toMatchObject({ slug: 'wuxue', legacySlug: null, packCount: 1 })
    expect(by['爱秧斯坦']).toMatchObject({ slug: 'aiyangsitan', legacySlug: '爱秧斯坦' })
    expect(by['0糖红茶']).toMatchObject({ slug: '0tanghongcha', packCount: 1 })
    expect(by['猫屋敷梨梨&春也Haruya']).toMatchObject({ slug: 'maowufulili-chunyeharuya', packCount: 1 })
    // only on the draft pack: linked but not counted
    expect(by['猫屋敷梨梨_春也Haruya']).toMatchObject({ slug: 'maowufulili-chunyeharuya-2', packCount: 0 })
  })

  test('tags by facet dimension', async () => {
    const rows = await db().select().from(schema.tags)
    expect(rows.map((r) => `${r.dimension}:${r.name}:${r.slug}`).sort()).toEqual(
      ['group:站长推荐:zhanzhangtuijian', 'group:表情图鉴:biaoqingtujian', 'tool:EmoteLab:emotelab', 'project:Solar5:solar5', 'origin:这下晚了:zhexiawanle'].sort(),
    )
  })

  test('redirects for old pack and character URLs', async () => {
    const rows = await db().select().from(schema.redirects)
    const map = Object.fromEntries(rows.map((r) => [r.fromPath, r.toPath]))
    expect(map['/archives/aimisi-01']).toBe('/packs/aimisi-01')
    expect(map['/archives/emoji-post-aimisi01']).toBe('/packs/aimisi-01')
    expect(map['/archives/changli-cats-png']).toBe('/packs/changli-cats-png')
    expect(map['/archives/jinhsi-taoyao-zhuozhuo']).toBe('/packs/jinhsi-taoyao-zhuozhuo')
    expect(map[`/tags/character-${HASH.chun}`]).toBe('/characters/chun')
    expect(map[`/tags/character-${HASH.xuanling}`]).toBe('/characters/yangyang-xuanling')
    expect(map['/tags/character-aimisi']).toBe('/characters/aimisi')
    expect(rows.every((r) => r.code === 301)).toBe(true)
  })

  test('second run is a no-op and keeps site-owned state', async () => {
    const before = await tableCounts()
    const e = fixture.emojis[0]!
    const official = (await db().select().from(schema.packs).where(eq(schema.packs.packKey, PACK.official)))[0]!
    // state the site owns after import
    await db()
      .update(schema.emojis)
      .set({ width: 64, height: 64, sha256: 'ab'.repeat(32), derivedReady: true, variantRev: 2, posterFrame: 1, status: 'hidden' })
      .where(eq(schema.emojis.id, e.id))
    await db().update(schema.packs).set({ downloadable: true, license: 'cc-by-nc-sa-4.0', slug: 'aimisi-renamed' }).where(eq(schema.packs.packKey, PACK.aimisi))
    await db().update(schema.packs).set({ downloadable: true }).where(eq(schema.packs.id, official.id))
    const changliBefore = (await db().select().from(schema.packs).where(eq(schema.packs.packKey, PACK.changli)))[0]!

    const s = await importV1()
    expect(s.packs.new).toBe(0)
    expect(s.emojis.new).toBe(0)
    expect(s.characters.new).toBe(0)
    expect(s.artists.new).toBe(0)
    expect(s.tags.new).toBe(0)
    expect(await tableCounts()).toEqual(before)

    const row = (await db().select().from(schema.emojis).where(eq(schema.emojis.id, e.id)))[0]!
    expect(row).toMatchObject({ width: 64, height: 64, sha256: 'ab'.repeat(32), derivedReady: true, variantRev: 2, posterFrame: 1, status: 'hidden' })
    const a = (await db().select().from(schema.packs).where(eq(schema.packs.packKey, PACK.aimisi)))[0]!
    expect(a).toMatchObject({ downloadable: true, license: 'cc-by-nc-sa-4.0', slug: 'aimisi-renamed', emojiCount: 5 })
    // official packs stay non-downloadable whatever happened in between
    const o = (await db().select().from(schema.packs).where(eq(schema.packs.id, official.id)))[0]!
    expect(o.downloadable).toBe(false)
    // untouched packs are not rewritten (updated_at is the edit-submission base version)
    const changliAfter = (await db().select().from(schema.packs).where(eq(schema.packs.packKey, PACK.changli)))[0]!
    expect(changliAfter.updatedAt.getTime()).toBe(changliBefore.updatedAt.getTime())
    // redirects follow the pack's current slug
    const r = await db().select().from(schema.redirects).where(eq(schema.redirects.fromPath, '/archives/aimisi-01'))
    expect(r[0]!.toPath).toBe('/packs/aimisi-renamed')
  })
})

describe('v1 snapshot details', () => {
  test('falls back to meta/v1/index/by-pack when pack.json is missing', async () => {
    const { objects } = await buildV1Fixture()
    const store = new Map(objects.filter((o) => o.key !== `assets/v1/packs/${PACK.jinhsi}/pack.json`).map((o) => [o.key, o.body]))
    const snap = await loadV1Snapshot({ read: async (key) => (store.has(key) ? JSON.parse(new TextDecoder().decode(store.get(key)!)) : null) })
    expect(snap.manifests.get(PACK.jinhsi)?.source).toBe('by-pack')
    expect(snap.manifests.get(PACK.jinhsi)?.emojis.length).toBe(5)
    expect(snap.manifests.get(PACK.aimisi)?.source).toBe('pack.json')
    expect(snap.manifests.get(PACK.noAssets)).toBeNull()
  })

  test('official packs are recognised by 【官转】 or the official- key', () => {
    expect(isOfficialPack({ name: 'x-1', title: '【官转】共鸣者印象录·第十四章表情包' })).toBe(true)
    expect(isOfficialPack({ name: 'official-abby-friends', title: '阿布' })).toBe(true)
    expect(isOfficialPack({ name: 'aimisi-01', title: '爱弥斯动态表情包（板牌）' })).toBe(false)
  })
})
