import type { ListPacksInput } from '#/server/catalog/inputs'
import type { PackFacets } from '#/server/catalog/types'
import { KIND_LABEL, SOURCE_LABEL } from './labels'

// /packs filters ↔ URL query. The URL is the state: shareable, Back/Forward walk through filter
// changes, and the legacy redirects (/tags/… → /packs?group= or ?tag=dim:slug) land on it.
// Pure; the regexes mirror src/server/catalog/inputs.ts (checked by tests/pages/filters.test.ts),
// copied so the client bundle does not pull in zod for them.

export type PackPageSort = 'hot' | 'new' | 'fav' | 'random'
export type KindFilter = 'animated' | 'static' | 'mixed'
export type SourceFilter = 'community' | 'official'

export const SORTS: readonly { value: PackPageSort; label: string }[] = [
  { value: 'hot', label: '最热' },
  { value: 'new', label: '最新' },
  { value: 'fav', label: '收藏最多' },
  { value: 'random', label: '随机' },
]
/** The page's default order (the API's default is 'new'). Omitted from URLs. */
export const DEFAULT_SORT: PackPageSort = 'hot'

export const SEED_RE = /^[0-9a-z]{1,16}$/
export const TAG_FILTER_RE = /^(group|tool|project|origin|custom):(.{1,200})$/
const SLUG_MAX = 200

export interface PackSearch {
  character?: string
  artist?: string
  kind?: KindFilter
  source?: SourceFilter
  group?: string
  tag?: string
  sort?: Exclude<PackPageSort, 'hot'>
  seed?: string
}

export interface PackFilterState {
  character: string | null
  artist: string | null
  kind: KindFilter | null
  source: SourceFilter | null
  group: string | null
  tag: string | null
  sort: PackPageSort
  seed: string | null
}

export type FilterKey = 'character' | 'artist' | 'kind' | 'source' | 'group' | 'tag'
export const FILTER_KEYS: readonly FilterKey[] = ['character', 'artist', 'kind', 'source', 'group', 'tag']

function slugOf(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const s = String(v).trim()
  return s && s.length <= SLUG_MAX ? s : null
}

/** URL search (already JSON-parsed by the router) → validated state; unknown or bad values are dropped. */
export function parsePackSearch(raw: Record<string, unknown>): PackFilterState {
  const kind = raw.kind === 'animated' || raw.kind === 'static' || raw.kind === 'mixed' ? raw.kind : null
  const source = raw.source === 'community' || raw.source === 'official' ? raw.source : null
  const tag = typeof raw.tag === 'string' && TAG_FILTER_RE.test(raw.tag) ? raw.tag : null
  const sort = SORTS.some((s) => s.value === raw.sort) ? (raw.sort as PackPageSort) : DEFAULT_SORT
  const seed = sort === 'random' && typeof raw.seed === 'string' && SEED_RE.test(raw.seed) ? raw.seed : null
  return {
    character: slugOf(raw.character),
    artist: slugOf(raw.artist),
    kind,
    source,
    group: slugOf(raw.group),
    tag,
    sort,
    seed,
  }
}

/** State → the search object the router puts in the URL (defaults and empty filters omitted). */
export function toPackSearch(s: PackFilterState): PackSearch {
  const out: PackSearch = {}
  if (s.character) out.character = s.character
  if (s.artist) out.artist = s.artist
  if (s.kind) out.kind = s.kind
  if (s.source) out.source = s.source
  if (s.group) out.group = s.group
  if (s.tag) out.tag = s.tag
  if (s.sort !== 'hot') out.sort = s.sort // DEFAULT_SORT
  if (s.sort === 'random' && s.seed) out.seed = s.seed
  return out
}

/** validateSearch for the route: parse, then normalize back to the URL shape. */
export function validatePackSearch(raw: Record<string, unknown>): PackSearch {
  return toPackSearch(parsePackSearch(raw))
}

/** Input of packsFn / packsPageFn for this state. */
export function listInputFor(s: PackFilterState, cursor?: string, limit = 24): ListPacksInput {
  const input: ListPacksInput = { sort: s.sort, limit }
  for (const k of FILTER_KEYS) {
    const v = s[k]
    if (v) (input as Record<string, unknown>)[k] = v
  }
  if (s.sort === 'random' && s.seed) input.seed = s.seed
  if (cursor) input.cursor = cursor
  return input
}

/** Set (or clear with null) one filter. Choosing the active value again clears it. */
export function setFilter<K extends FilterKey>(s: PackFilterState, key: K, value: PackFilterState[K]): PackFilterState {
  const next = { ...s, [key]: s[key] === value ? null : value }
  // a tag filter for the group dimension is the same thing as ?group=
  if (key === 'group' && next.tag?.startsWith('group:')) next.tag = null
  return next
}

export function setSort(s: PackFilterState, sort: PackPageSort): PackFilterState {
  return { ...s, sort, seed: null }
}

export function clearFilters(s: PackFilterState): PackFilterState {
  return { ...s, character: null, artist: null, kind: null, source: null, group: null, tag: null }
}

export function hasFilters(s: PackFilterState): boolean {
  return FILTER_KEYS.some((k) => s[k] != null)
}

export interface ActiveFilter {
  key: FilterKey
  /** facet name, e.g. 角色 */
  facet: string
  label: string
}

const TAG_DIMENSION_LABEL: Record<string, string> = { group: '分组', tool: '工具', project: '企划', origin: '原设', custom: '标签' }

/** The chips under the filter bar, labelled with facet names (falls back to the slug). */
export function activeFilters(s: PackFilterState, f: PackFacets | null): ActiveFilter[] {
  const out: ActiveFilter[] = []
  const name = (list: { slug: string; name: string }[] | undefined, slug: string) => list?.find((x) => x.slug === slug)?.name ?? slug
  if (s.character) out.push({ key: 'character', facet: '角色', label: name(f?.characters, s.character) })
  if (s.artist) out.push({ key: 'artist', facet: '画师', label: name(f?.artists, s.artist) })
  if (s.kind) out.push({ key: 'kind', facet: '类型', label: KIND_LABEL[s.kind] ?? s.kind })
  if (s.source) out.push({ key: 'source', facet: '来源', label: SOURCE_LABEL[s.source] ?? s.source })
  if (s.group) out.push({ key: 'group', facet: '分组', label: name(f?.tags.group, s.group) })
  if (s.tag) {
    const m = TAG_FILTER_RE.exec(s.tag)
    const dim = m?.[1] ?? 'custom'
    const slug = m?.[2] ?? s.tag
    out.push({ key: 'tag', facet: TAG_DIMENSION_LABEL[dim] ?? '标签', label: name(f?.tags[dim as keyof PackFacets['tags']], slug) })
  }
  return out
}
