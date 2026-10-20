import { describe, expect, test } from 'bun:test'
import { listPacksInput, SEED_RE as SERVER_SEED_RE, TAG_FILTER_RE as SERVER_TAG_RE } from '#/server/catalog/inputs'
import type { PackFacets } from '#/server/catalog/types'
import {
  activeFilters,
  clearFilters,
  DEFAULT_SORT,
  hasFilters,
  listInputFor,
  parsePackSearch,
  SEED_RE,
  setFilter,
  setSort,
  TAG_FILTER_RE,
  toPackSearch,
  validatePackSearch,
} from '#/ui/pages/filters'

const facets: PackFacets = {
  total: 3,
  characters: [{ slug: 'aimisi', name: '爱弥斯', packCount: 3, color: 'pink', avatar: null }],
  artists: [{ slug: 'wuxue', name: '雾雪', packCount: 1 }],
  tags: {
    group: [{ slug: 'zhanzhangtuijian', name: '站长推荐', packCount: 2 }],
    tool: [],
    project: [{ slug: 'solar5', name: 'Solar5', packCount: 1 }],
    origin: [],
    custom: [],
  },
  kinds: [{ kind: 'animated', packCount: 2 }],
  sources: [{ sourceKind: 'community', packCount: 3 }],
}

describe('/packs URL ↔ filter state', () => {
  test('empty URL = no filters, the page default sort (最热)', () => {
    const s = parsePackSearch({})
    expect(s).toEqual({ character: null, artist: null, kind: null, source: null, group: null, tag: null, sort: 'hot', seed: null })
    expect(DEFAULT_SORT).toBe('hot')
    expect(toPackSearch(s)).toEqual({})
    expect(hasFilters(s)).toBe(false)
  })

  test('every filter round-trips through the URL', () => {
    const url = { character: 'aimisi', artist: '爱秧斯坦', kind: 'mixed', source: 'official', group: 'zhanzhangtuijian', tag: 'project:solar5', sort: 'fav' } as const
    const s = parsePackSearch(url)
    expect(toPackSearch(s)).toEqual(url)
    expect(parsePackSearch(toPackSearch(s) as Record<string, unknown>)).toEqual(s)
  })

  test('legacy redirect targets parse (/packs?group=… and ?tag=dim:slug)', () => {
    expect(parsePackSearch({ group: 'zhanzhangtuijian' }).group).toBe('zhanzhangtuijian')
    expect(parsePackSearch({ tag: 'origin:zhexiawanle' }).tag).toBe('origin:zhexiawanle')
    expect(validatePackSearch({ tag: 'project:solar5' })).toEqual({ tag: 'project:solar5' })
  })

  test('bad values are dropped, not passed to the server', () => {
    const s = parsePackSearch({ kind: 'gif', source: 'mine', tag: 'colour:red', sort: 'oldest', character: '', artist: 'x'.repeat(201), seed: 'abc' })
    expect(s).toEqual(parsePackSearch({}))
    // a seed only means something for the random order
    expect(parsePackSearch({ sort: 'random', seed: 'Bad Seed!' }).seed).toBeNull()
    expect(parsePackSearch({ sort: 'random', seed: 'k3x9' })).toMatchObject({ sort: 'random', seed: 'k3x9' })
    // numbers from the router's JSON search parser are accepted as slugs
    expect(parsePackSearch({ character: 5 }).character).toBe('5')
  })

  test('the default sort is not written to the URL; other sorts are', () => {
    expect(toPackSearch(setSort(parsePackSearch({}), 'hot'))).toEqual({})
    expect(toPackSearch(setSort(parsePackSearch({}), 'new'))).toEqual({ sort: 'new' })
    // changing the sort drops the old random seed
    expect(setSort(parsePackSearch({ sort: 'random', seed: 'abc' }), 'random').seed).toBeNull()
  })

  test('choosing the active value again clears it; clearFilters keeps the sort', () => {
    const s = parsePackSearch({ character: 'aimisi', sort: 'new' })
    expect(setFilter(s, 'character', 'aimisi').character).toBeNull()
    expect(setFilter(s, 'character', 'xin').character).toBe('xin')
    const c = clearFilters(parsePackSearch({ character: 'a', artist: 'b', kind: 'static', source: 'community', group: 'g', tag: 'tool:ps', sort: 'fav' }))
    expect(c).toEqual({ ...parsePackSearch({}), sort: 'fav' })
    // picking a 分组 replaces a group tag that came in through ?tag=group:…
    expect(setFilter(parsePackSearch({ tag: 'group:old' }), 'group', 'new')).toMatchObject({ group: 'new', tag: null })
  })

  test('listInputFor builds a valid packsFn input', () => {
    const s = parsePackSearch({ character: 'aimisi', tag: 'project:solar5', sort: 'random', seed: 'k3x9' })
    const input = listInputFor(s, 'CURSOR', 30)
    expect(input).toEqual({ character: 'aimisi', tag: 'project:solar5', sort: 'random', seed: 'k3x9', cursor: 'CURSOR', limit: 30 })
    expect(listPacksInput.safeParse(input).success).toBe(true)
    expect(listPacksInput.safeParse(listInputFor(parsePackSearch({}))).success).toBe(true)
  })

  test('the client regexes mirror the server schemas', () => {
    expect(String(SEED_RE)).toBe(String(SERVER_SEED_RE))
    expect(String(TAG_FILTER_RE)).toBe(String(SERVER_TAG_RE))
  })

  test('active filter chips are labelled with facet names (slug as fallback)', () => {
    const s = parsePackSearch({ character: 'aimisi', artist: 'unknown-artist', kind: 'animated', group: 'zhanzhangtuijian', tag: 'project:solar5' })
    expect(activeFilters(s, facets)).toEqual([
      { key: 'character', facet: '角色', label: '爱弥斯' },
      { key: 'artist', facet: '画师', label: 'unknown-artist' },
      { key: 'kind', facet: '类型', label: '动态' },
      { key: 'group', facet: '分组', label: '站长推荐' },
      { key: 'tag', facet: '企划', label: 'Solar5' },
    ])
    expect(activeFilters(parsePackSearch({}), facets)).toEqual([])
  })
})
