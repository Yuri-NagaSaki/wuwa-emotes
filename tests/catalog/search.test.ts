import { DATABASE_URL, withClient } from '../integration/setup'
import { beforeAll, describe, expect, test } from 'bun:test'
import { parseQuery, searchCatalog, suggestCatalog } from '#/server/catalog/search'
import { seedCatalog } from './seed'

beforeAll(async () => {
  await seedCatalog()
}, 120_000)

const search = (q: string, limit = 8) => searchCatalog({ q, limit })

describe('query parsing', () => {
  test('normalizes whitespace and width, caps length, splits words', () => {
    expect(parseQuery('   ')).toBeNull()
    expect(parseQuery('  爱弥斯　　捏捏 ')!.q).toBe('爱弥斯 捏捏')
    expect(parseQuery('爱弥斯 捏捏')!.terms.map((t) => t.text)).toEqual(['爱弥斯', '捏捏'])
    expect(parseQuery('ＰＨＯＥＢＥ')!.q).toBe('PHOEBE')
    expect(Array.from(parseQuery('心'.repeat(500))!.q).length).toBe(64)
    expect(parseQuery('100%_\\')!.needles[0]!.sub).toBe('%100\\%\\_\\\\%')
  })
})

describe('search', () => {
  test('character name: best match, its packs, title matches above link-only matches', async () => {
    const r = await search('爱弥斯')
    expect(r.best).toMatchObject({ type: 'character', character: { slug: 'aimisi' } })
    expect(r.characters[0]!.slug).toBe('aimisi')
    // both titles start with the name; 「爱弥斯 捏捏 静态」 has it as a whole word (word_similarity 1 vs
    // 0.75), so it wins over the more downloaded pack; multi-01 matches only through its characters
    expect(r.packs.map((p) => p.slug)).toEqual(['aimisi-02', 'aimisi-01', 'multi-01'])
    expect(r.counts.packs).toBe(3)
  })

  test('Chinese substring of 3+ characters hits titles through pg_trgm', async () => {
    const r = await search('动态表情')
    expect(r.packs.map((p) => p.slug)).toEqual(['aimisi-01'])
    expect(r.best).toBeNull()
    const r2 = await search('琵琶曲')
    expect(r2.packs.map((p) => p.slug)).toEqual(['multi-01'])
  })

  test('the predicates can use the trigram GIN indexes', async () => {
    await withClient(DATABASE_URL, async (c) => {
      await c.query('set enable_seqscan = off')
      const plan = async (q: string) => (await c.query(q)).rows.map((r) => r['QUERY PLAN']).join('\n')
      expect(await plan(`explain select id from packs where title ilike '%动态表情%'`)).toContain('packs_title_trgm_idx')
      expect(await plan(`explain select id from characters where name ilike '%爱弥斯%' or name % '爱弥斯'`)).toContain('characters_name_trgm_idx')
      expect(await plan(`explain select character_id from character_aliases where alias ilike '%Phoebe%'`)).toContain('character_aliases_trgm_idx')
      expect(await plan(`explain select id from artists where name ilike '%猫屋敷%'`)).toContain('artists_name_trgm_idx')
      expect(await plan(`explain select id from tags where name ilike '%Solar5%'`)).toContain('tags_name_trgm_idx')
    })
  })

  test('single character: exact name or alias first, then containing names', async () => {
    const xin = await search('心')
    expect(xin.characters.map((c) => c.slug)).toEqual(['xin', 'xinyuehu'])
    expect(xin.best).toMatchObject({ type: 'character', character: { slug: 'xin' } })
    // the packs of 心 rank first; 心月狐's pack only matches by title, below
    expect(xin.packs.map((p) => p.slug)).toEqual(['xin-01', 'xinyuehu-01'])

    const chun = await search('椿')
    expect(chun.characters.map((c) => c.slug)).toEqual(['chun'])
    expect(chun.packs[0]!.slug).toBe('chun-01')

    // 离 is an alias of 长离
    const li = await search('离')
    expect(li.characters[0]!.slug).toBe('changli')
    expect(li.best).toMatchObject({ type: 'character', character: { slug: 'changli' } })
    expect(li.packs[0]!.slug).toBe('changli-01')
  })

  test('Latin aliases match case-insensitively; artists and tags', async () => {
    const phoebe = await search('phoebe')
    expect(phoebe.characters[0]!.slug).toBe('feibi')
    expect(phoebe.packs.map((p) => p.slug).sort()).toEqual(['feibi-01', 'multi-01'])

    const haruya = await search('Haruya')
    expect(haruya.best).toMatchObject({ type: 'artist', artist: { slug: 'maowushi' } })
    expect(haruya.artists.map((a) => a.slug)).toEqual(['maowushi'])
    expect(haruya.packs.map((p) => p.slug).sort()).toEqual(['aimisi-01', 'aimisi-02'])

    const solar = await search('solar5')
    expect(solar.tags).toEqual([{ dimension: 'project', slug: 'solar5', name: '企划/Solar5', packCount: 1 }])
    expect(solar.packs.map((p) => p.slug)).toEqual(['yangyang-01'])
  })

  test('typos within trigram similarity still find the character', async () => {
    const r = await search('爱弥丝')
    expect(r.characters.map((c) => c.slug)).toContain('aimisi')
    expect(r.best).toBeNull()
  })

  test('multi-word queries must match every word (title or linked names)', async () => {
    expect((await search('爱弥斯 捏捏')).packs.map((p) => p.slug)).toEqual(['aimisi-02'])
    expect((await search('菲比 今汐')).packs.map((p) => p.slug)).toEqual(['multi-01'])
    expect((await search('爱弥斯 菲比')).characters.map((c) => c.slug).sort()).toEqual(['aimisi', 'feibi'])
  })

  test('limits per group, counts of all matches', async () => {
    // titles with 表情: aimisi-01, official-01, changli-01 (the draft has none)
    const r = await search('表情', 1)
    expect(r.packs.length).toBe(1)
    expect(r.counts.packs).toBe(3)
  })

  test('wildcards are literal; empty queries are empty', async () => {
    for (const q of ['%', '_', '\\', '%%', "'"]) {
      const r = await search(q)
      expect(r.packs).toEqual([])
      expect(r.characters).toEqual([])
    }
    expect(await search('   ')).toMatchObject({ q: '', packs: [], characters: [], best: null })
  })
})

describe('suggest (command palette)', () => {
  test('exact character first, then related packs', async () => {
    const s = await suggestCatalog({ q: '心' })
    expect(s[0]).toMatchObject({ type: 'character', slug: 'xin', label: '心', href: '/characters/xin' })
    expect(s[0]!.image).toMatch(/^\/img\/v1\/p240\//)
    expect(s.map((x) => `${x.type}:${x.slug}`)).toContain('pack:xin-01')
    expect(s.map((x) => `${x.type}:${x.slug}`)).not.toContain('pack:chun-01')
  })

  test('aliases, prefixes, tags, artists, multi-word', async () => {
    const p = await suggestCatalog({ q: 'phoe' })
    expect(p[0]).toMatchObject({ type: 'character', slug: 'feibi' })
    expect(p[0]!.sub).toContain('Phoebe')
    expect((await suggestCatalog({ q: '爱弥' }))[0]).toMatchObject({ type: 'character', slug: 'aimisi' })
    expect(await suggestCatalog({ q: '站长' })).toContainEqual(
      expect.objectContaining({ type: 'tag', slug: 'group:zhanzhang-tuijian', href: '/packs?group=zhanzhang-tuijian' }),
    )
    expect((await suggestCatalog({ q: '爱秧斯坦' })).map((x) => x.type)).toContain('artist')
    expect((await suggestCatalog({ q: '爱弥斯 捏捏' })).map((x) => x.slug)).toEqual(['aimisi-02'])
    expect(await suggestCatalog({ q: '守岸' })).toEqual([])
    expect((await suggestCatalog({ q: '表情', limit: 2 })).length).toBe(2)
  })
})
