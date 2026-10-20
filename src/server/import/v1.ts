import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { EMOJI_ID_RE, PACK_KEY_RE } from '../../shared/ids'
import { db, schema } from '../db/client'
import type { PackKind, PackStatus, SourceKind, TagDimension } from '../db/schema'
import { parseLicense } from '../media/credits'
import { originalKey } from '../media/keys'
import { bucket, getObjectBytes, isNotFound } from '../media/s3'
import { mapLimit } from './pool'
import { claimSlug, isHashSlug, slugify } from './slug'

// v1 snapshot → PostgreSQL (docs/ARCHITECTURE.md §6.4 and §7; DEVELOPMENT.md §3–4).
//
// Reads meta/v1/{packs,characters,artists,facets}.json plus each pack's emoji list from
// assets/v1/packs/<pk>/pack.json (the authoritative file list), falling back to
// meta/v1/index/by-pack/<pk>.json. A pack with neither is imported as a draft. Objects are never moved.
//
// Re-runs are idempotent. Rows are matched on natural keys: pack_key, emoji id, the character's v1
// slug (slug or legacy_slug), the trimmed artist name, tag (dimension, name) and redirect path.
// v1 owns descriptive metadata; the site owns lifecycle state. A re-run therefore never resets
// downloadable (except that official packs are forced off), status (except draft → published once
// assets exist), slugs, licenses, image dimensions, hashes or derivative state, and never renames
// taxonomy rows that already exist.

export const ASSETS_PREFIX = 'assets/v1/packs/'

const TAG_DIMENSIONS: Record<string, TagDimension> = { 分组: 'group', 工具: 'tool', 企划: 'project', 原设: 'origin' }
const CHARACTER_FACET = '角色'
const ARTIST_FACET = '画师'

const FORMAT_MIME: Record<string, string> = { gif: 'image/gif', png: 'image/png', webp: 'image/webp', jpeg: 'image/jpeg' }

// ---------- v1 shapes (lenient: unknown keys are ignored, bad items are skipped with a warning) ----------

const nstr = z.string().nullish()
const nnum = z.number().nullish()

const V1Ref = z.object({ name: nstr, kind: nstr, slug: nstr, displayName: nstr })
export type V1Ref = z.infer<typeof V1Ref>

const V1PackItem = z.object({
  name: z.string(),
  postName: nstr,
  title: nstr,
  excerpt: nstr,
  description: nstr,
  permalink: nstr,
  url: nstr,
  publishTime: nstr,
  pinLevel: nnum,
  memorial: z.boolean().nullish(),
  characters: z.array(V1Ref).nullish(),
  artists: z.array(z.union([z.string(), V1Ref])).nullish(),
  artistNames: z.array(z.string()).nullish(),
  // values are strings or { value } objects; anything that is not a plain object is ignored
  facets: z.unknown().transform((v) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)),
  favoriteCount: nnum,
  downloadCount: nnum,
  cover: z.object({ resourceId: nstr }).loose().nullish(),
  license: nstr,
  listingChannel: nstr,
})
export type V1Pack = z.infer<typeof V1PackItem>

const V1Emoji = z.object({
  id: z.string(),
  objectKey: nstr,
  format: nstr,
  contentType: nstr,
  bytes: nnum,
  animated: z.boolean().nullish(),
  characters: z.array(z.string()).nullish(),
})
export type V1Emoji = z.infer<typeof V1Emoji>

const ItemList = z.object({ items: z.array(z.unknown()) })
const Manifest = z.object({ emojis: z.array(z.unknown()) })
const Facets = z.object({ dimensions: z.record(z.string(), z.unknown()) })

export interface V1Manifest {
  source: 'pack.json' | 'by-pack'
  emojis: V1Emoji[]
}

export interface V1Snapshot {
  packs: V1Pack[]
  characters: V1Ref[]
  artists: V1Ref[]
  facets: Record<string, string[]>
  manifests: Map<string, V1Manifest | null>
  warnings: string[]
}

export type ReadJson = (key: string) => Promise<unknown | null>

/** JSON object from the configured bucket; null when the key does not exist. */
export async function readBucketJson(key: string): Promise<unknown | null> {
  try {
    return JSON.parse(new TextDecoder().decode(await getObjectBytes(key)))
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

/** Code-point order: slug assignment must not depend on the runtime's locale. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function strings(v: unknown): string[] {
  const arr = v == null ? [] : Array.isArray(v) ? v : [v]
  return arr
    .map((x) => {
      if (typeof x === 'string') return x
      if (x && typeof x === 'object' && 'value' in x && typeof x.value === 'string') return x.value
      return ''
    })
    .map(clean)
    .filter(Boolean)
}

function parseItems<T>(raw: unknown, item: z.ZodType<T>, label: string, warnings: string[]): T[] {
  if (raw == null) return []
  const list = ItemList.safeParse(raw)
  if (!list.success) {
    warnings.push(`${label}: no items[] array; ignored`)
    return []
  }
  const out: T[] = []
  list.data.items.forEach((x, i) => {
    const r = item.safeParse(x)
    if (r.success) out.push(r.data)
    else {
      const name = x && typeof x === 'object' && 'name' in x && typeof x.name === 'string' ? ` "${x.name}"` : ''
      const issue = r.error.issues[0]
      warnings.push(`${label}: item ${i}${name} skipped (${issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid'})`)
    }
  })
  return out
}

export async function loadV1Snapshot(
  opts: { prefix?: string; assetsPrefix?: string; read?: ReadJson; concurrency?: number } = {},
): Promise<V1Snapshot> {
  const prefix = opts.prefix ?? 'meta/v1/'
  const assetsPrefix = opts.assetsPrefix ?? ASSETS_PREFIX
  const read = opts.read ?? readBucketJson
  const warnings: string[] = []

  const packsRaw = await read(`${prefix}packs.json`)
  if (packsRaw == null) throw new Error(`${prefix}packs.json not found in bucket ${bucket()}`)
  const packs = parseItems(packsRaw, V1PackItem, 'packs.json', warnings)
  const characters = parseItems(await read(`${prefix}characters.json`), V1Ref, 'characters.json', warnings)
  const artists = parseItems(await read(`${prefix}artists.json`), V1Ref, 'artists.json', warnings)

  const facets: Record<string, string[]> = {}
  const facetsRaw = Facets.safeParse(await read(`${prefix}facets.json`))
  if (facetsRaw.success) for (const [dim, values] of Object.entries(facetsRaw.data.dimensions)) facets[dim.trim()] = strings(values)

  const manifests = new Map<string, V1Manifest | null>()
  const keys = [...new Set(packs.map((p) => p.name.trim()).filter((k) => PACK_KEY_RE.test(k)))]
  await mapLimit(keys, opts.concurrency ?? 8, async (pk) => {
    let source: V1Manifest['source'] = 'pack.json'
    let raw = await read(`${assetsPrefix}${pk}/pack.json`)
    if (raw == null) {
      source = 'by-pack'
      raw = await read(`${prefix}index/by-pack/${pk}.json`)
    }
    if (raw == null) {
      manifests.set(pk, null)
      return
    }
    const m = Manifest.safeParse(raw)
    if (!m.success) {
      warnings.push(`pack ${pk}: ${source} has no emojis[]; treated as having no assets`)
      manifests.set(pk, null)
      return
    }
    const emojis: V1Emoji[] = []
    m.data.emojis.forEach((x, i) => {
      const r = V1Emoji.safeParse(x)
      if (r.success) emojis.push(r.data)
      else warnings.push(`pack ${pk}: emoji ${i} skipped (${r.error.issues[0]?.message ?? 'invalid'})`)
    })
    manifests.set(pk, { source, emojis })
  })

  return { packs, characters, artists, facets, manifests, warnings }
}

// ---------- planning (pure) ----------

export interface ExistingState {
  packs: { id: number; packKey: string; slug: string }[]
  emojiIds: Set<string>
  characters: { id: number; slug: string; legacySlug: string | null; name: string }[]
  artists: { id: number; slug: string; name: string }[]
  tags: { id: number; dimension: string; slug: string; name: string }[]
}

export const EMPTY_STATE: ExistingState = { packs: [], emojiIds: new Set(), characters: [], artists: [], tags: [] }

export interface PlannedCharacter {
  key: string
  v1Slug: string | null
  name: string
  slug: string
  legacySlug: string | null
  existingId: number | null
}

export interface PlannedArtist {
  name: string
  slug: string
  legacySlug: string | null
  existingId: number | null
}

export interface PlannedTag {
  dimension: TagDimension
  name: string
  slug: string
  existingId: number | null
}

export interface PlannedEmoji {
  id: string
  originalKey: string
  format: string
  mime: string
  bytes: number
  sortOrder: number
  animated: boolean
  characterKeys: string[]
  isNew: boolean
}

export interface PlannedPack {
  packKey: string
  slug: string
  title: string
  excerpt: string | null
  descriptionMd: string | null
  status: PackStatus
  sourceKind: SourceKind
  license: string
  kind: PackKind
  pinLevel: number
  memorial: boolean
  sourceUrl: string | null
  legacyPostName: string | null
  publishedAt: Date | null
  coverEmojiId: string | null
  downloadCount: number
  favoriteCount: number
  emojis: PlannedEmoji[]
  characterKeys: string[]
  artistNames: string[]
  tags: { dimension: TagDimension; name: string }[]
  isNew: boolean
}

export interface ImportPlan {
  packs: PlannedPack[]
  characters: PlannedCharacter[]
  artists: PlannedArtist[]
  tags: PlannedTag[]
  redirects: { fromPath: string; toPath: string }[]
  warnings: string[]
}

/** v1 marks official re-posts (官转) in the title and the pack key; there is no explicit flag. */
export function isOfficialPack(item: Pick<V1Pack, 'name' | 'title' | 'listingChannel'>): boolean {
  return /^\s*【官转】/.test(item.title ?? '') || /^official-/.test(item.name.trim()) || /official|官方/i.test(item.listingChannel ?? '')
}

function parseTime(s: string | null | undefined): Date | null {
  if (!s) return null
  const t = Date.parse(s.replace(/(\.\d{3})\d+/, '$1'))
  return Number.isNaN(t) ? null : new Date(t)
}

/** URL-encoded pathname of a v1 page under /archives/, or null. */
function archivePath(s: string | null | undefined): string | null {
  if (!s?.trim()) return null
  try {
    const p = new URL(s.trim(), 'https://v1.invalid').pathname.replace(/\/+$/, '')
    return p.startsWith('/archives/') && p.length > '/archives/'.length ? p : null
  } catch {
    return null
  }
}

function extOf(key: string | null | undefined): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(key ?? '')
  return m ? m[1]!.toLowerCase() : null
}

function normFormat(f: string | null | undefined): string | null {
  const v = (f ?? '').trim().toLowerCase()
  if (!v) return null
  return v === 'jpg' ? 'jpeg' : v
}

/** Display name of a v1 reference; Halo metadata names (`character-…`, `artist-…`) are not names. */
function refName(r: V1Ref): string {
  const meta = clean(r.name)
  return clean(r.displayName) || (meta && !/^(?:character|artist|tag)-[0-9a-f]{8,}$/i.test(meta) ? meta : '') || clean(r.slug)
}

/** /tags/character-<old> as used by v1 (a slug that already carries the prefix is used as is). */
export function characterLegacyPath(v1Slug: string): string {
  const s = v1Slug.trim()
  return `/tags/${encodeURIComponent(s.startsWith('character-') ? s : `character-${s}`)}`
}

export function planImport(snap: V1Snapshot, existing: ExistingState = EMPTY_STATE): ImportPlan {
  const warnings = [...snap.warnings]

  // ----- characters -----
  const chars = new Map<string, { key: string; v1Slug: string | null; name: string }>()
  const charKeyByName = new Map<string, string>()
  const addChar = (r: V1Ref): string | null => {
    const v1Slug = clean(r.slug) || null
    const name = refName(r)
    if (!name) return null
    const key = v1Slug ? `slug:${v1Slug}` : `name:${name}`
    if (!chars.has(key)) chars.set(key, { key, v1Slug, name })
    if (!charKeyByName.has(name)) charKeyByName.set(name, key)
    return key
  }
  for (const c of snap.characters) addChar(c)
  for (const p of snap.packs) for (const c of p.characters ?? []) addChar(c)
  for (const p of snap.packs)
    for (const n of strings(p.facets?.[CHARACTER_FACET])) if (!charKeyByName.has(n)) addChar({ displayName: n })
  for (const n of snap.facets[CHARACTER_FACET] ?? []) if (!charKeyByName.has(n)) addChar({ displayName: n })

  const takenCharSlugs = new Set(existing.characters.map((c) => c.slug))
  const exByLegacy = new Map(existing.characters.filter((c) => c.legacySlug).map((c) => [c.legacySlug!, c]))
  const exBySlug = new Map(existing.characters.map((c) => [c.slug, c]))
  const exByName = new Map(existing.characters.map((c) => [c.name, c]))
  const rank = (c: { v1Slug: string | null }) => (c.v1Slug == null ? 2 : isHashSlug(c.v1Slug) ? 1 : 0)
  const characters: PlannedCharacter[] = []
  for (const c of [...chars.values()].sort((a, b) => rank(a) - rank(b) || cmp(a.key, b.key))) {
    const hit = c.v1Slug
      ? (exByLegacy.get(c.v1Slug) ?? (isHashSlug(c.v1Slug) ? undefined : exBySlug.get(c.v1Slug)))
      : exByName.get(c.name)
    if (hit) {
      characters.push({ ...c, slug: hit.slug, legacySlug: hit.legacySlug, existingId: hit.id })
      continue
    }
    let slug: string
    if (c.v1Slug && !isHashSlug(c.v1Slug) && !takenCharSlugs.has(c.v1Slug)) {
      slug = c.v1Slug
      takenCharSlugs.add(slug)
    } else {
      slug = claimSlug(slugify(c.name), takenCharSlugs)
      if (c.v1Slug && !isHashSlug(c.v1Slug)) warnings.push(`character ${c.v1Slug}: slug already taken, using ${slug}`)
    }
    characters.push({ ...c, slug, legacySlug: c.v1Slug && c.v1Slug !== slug ? c.v1Slug : null, existingId: null })
  }
  const charByKey = new Map(characters.map((c) => [c.key, c]))

  // ----- artists (structured list ∪ artistNames ∪ 画师 facet; deduped on the trimmed name) -----
  const artistV1Slug = new Map<string, string | null>()
  const addArtist = (name: string, v1Slug: string | null = null) => {
    if (!name) return
    if (!artistV1Slug.has(name) || (v1Slug && !artistV1Slug.get(name))) artistV1Slug.set(name, v1Slug)
  }
  for (const a of snap.artists) addArtist(refName(a), clean(a.slug) || null)
  const packArtistNames = (p: V1Pack): string[] => {
    const names: string[] = []
    for (const a of p.artists ?? []) names.push(typeof a === 'string' ? clean(a) : refName(a))
    for (const a of p.artistNames ?? []) names.push(clean(a))
    names.push(...strings(p.facets?.[ARTIST_FACET]))
    return [...new Set(names.filter(Boolean))]
  }
  for (const p of snap.packs) {
    for (const a of p.artists ?? []) if (typeof a !== 'string') addArtist(refName(a), clean(a.slug) || null)
    for (const n of packArtistNames(p)) addArtist(n)
  }
  for (const n of snap.facets[ARTIST_FACET] ?? []) addArtist(n)

  const takenArtistSlugs = new Set(existing.artists.map((a) => a.slug))
  const exArtistByName = new Map(existing.artists.map((a) => [a.name, a]))
  const artistRank = (s: string | null) => (s && !isHashSlug(s) ? 0 : 1)
  const artists: PlannedArtist[] = []
  const artistSlugBase = new Map<string, string>()
  for (const [name, v1Slug] of [...artistV1Slug.entries()].sort(
    (a, b) => artistRank(a[1]) - artistRank(b[1]) || cmp(a[0], b[0]),
  )) {
    const hit = exArtistByName.get(name)
    if (hit) {
      artists.push({ name, slug: hit.slug, legacySlug: null, existingId: hit.id })
      continue
    }
    let slug: string
    if (v1Slug && !isHashSlug(v1Slug) && !takenArtistSlugs.has(v1Slug)) {
      slug = v1Slug
      takenArtistSlugs.add(slug)
    } else {
      const base = slugify(name)
      slug = claimSlug(base, takenArtistSlugs)
      const other = artistSlugBase.get(base)
      if (other && slug !== base) warnings.push(`artists "${other}" and "${name}" share the slug ${base}; kept apart as ${base} and ${slug}`)
      artistSlugBase.set(base, artistSlugBase.get(base) ?? name)
    }
    artists.push({ name, slug, legacySlug: v1Slug && v1Slug !== slug ? v1Slug : null, existingId: null })
  }

  // ----- tags (facet dimensions 分组/工具/企划/原设; 角色 and 画师 are not tags) -----
  const tagRefs = new Map<string, { dimension: TagDimension; name: string }>()
  const packTags = (facets: Record<string, unknown> | null | undefined) => {
    const out: { dimension: TagDimension; name: string }[] = []
    for (const [dimRaw, values] of Object.entries(facets ?? {})) {
      const dimension = TAG_DIMENSIONS[dimRaw.trim()]
      if (!dimension) continue
      for (const name of strings(values)) out.push({ dimension, name })
    }
    return out
  }
  for (const t of packTags(snap.facets)) tagRefs.set(`${t.dimension}\u0000${t.name}`, t)
  for (const p of snap.packs) for (const t of packTags(p.facets)) tagRefs.set(`${t.dimension}\u0000${t.name}`, t)
  const takenTagSlugs = new Map<string, Set<string>>()
  for (const t of existing.tags) {
    if (!takenTagSlugs.has(t.dimension)) takenTagSlugs.set(t.dimension, new Set())
    takenTagSlugs.get(t.dimension)!.add(t.slug)
  }
  const exTag = new Map(existing.tags.map((t) => [`${t.dimension}\u0000${t.name}`, t]))
  const tags: PlannedTag[] = []
  for (const [k, t] of [...tagRefs.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    const hit = exTag.get(k)
    if (hit) {
      tags.push({ ...t, slug: hit.slug, existingId: hit.id })
      continue
    }
    if (!takenTagSlugs.has(t.dimension)) takenTagSlugs.set(t.dimension, new Set())
    tags.push({ ...t, slug: claimSlug(slugify(t.name), takenTagSlugs.get(t.dimension)!), existingId: null })
  }

  // ----- packs and emojis -----
  const exPack = new Map(existing.packs.map((p) => [p.packKey, p]))
  const takenPackSlugs = new Set(existing.packs.map((p) => p.slug))
  const seenPacks = new Set<string>()
  const seenEmojis = new Set<string>()
  const packs: PlannedPack[] = []
  const redirects = new Map<string, string>()

  for (const item of snap.packs) {
    const pk = item.name.trim()
    if (!PACK_KEY_RE.test(pk)) {
      warnings.push(`pack "${pk}": key does not match ${PACK_KEY_RE}; skipped`)
      continue
    }
    if (seenPacks.has(pk)) {
      warnings.push(`pack ${pk}: listed twice in packs.json; second entry ignored`)
      continue
    }
    seenPacks.add(pk)

    const ex = exPack.get(pk)
    let slug: string
    if (ex) slug = ex.slug
    else if (!takenPackSlugs.has(pk)) {
      slug = pk
      takenPackSlugs.add(pk)
    } else {
      slug = claimSlug(pk, takenPackSlugs)
      warnings.push(`pack ${pk}: slug already used by another pack, using ${slug}`)
    }

    const manifest = snap.manifests.get(pk) ?? null
    const emojis: PlannedEmoji[] = []
    for (const e of manifest?.emojis ?? []) {
      const id = e.id.trim()
      if (!EMOJI_ID_RE.test(id)) {
        warnings.push(`pack ${pk}: emoji id "${id}" is malformed; skipped`)
        continue
      }
      if (seenEmojis.has(id)) {
        warnings.push(`emoji ${id}: listed in more than one pack; kept in the first`)
        continue
      }
      const format = normFormat(e.format) ?? normFormat(extOf(e.objectKey))
      if (!format || !FORMAT_MIME[format]) {
        warnings.push(`emoji ${id}: unsupported format "${e.format ?? ''}"; skipped`)
        continue
      }
      seenEmojis.add(id)
      const ext = extOf(e.objectKey) ?? (format === 'jpeg' ? 'jpg' : format)
      const expected = originalKey(pk, id, ext)
      const key = e.objectKey?.trim() || expected
      if (key !== expected) warnings.push(`emoji ${id}: object key ${key} is outside the v1 layout; kept as is`)
      if (e.bytes == null) warnings.push(`emoji ${id}: no byte size in v1 metadata; stored as 0`)
      const characterKeys: string[] = []
      for (const s of e.characters ?? []) {
        const k = `slug:${s.trim()}`
        if (charByKey.has(k)) characterKeys.push(k)
        else warnings.push(`emoji ${id}: unknown character slug "${s}"; link skipped`)
      }
      emojis.push({
        id,
        originalKey: key,
        format,
        mime: e.contentType?.trim() || FORMAT_MIME[format]!,
        bytes: Math.max(0, Math.round(e.bytes ?? 0)),
        sortOrder: emojis.length,
        animated: e.animated ?? format === 'gif',
        characterKeys: [...new Set(characterKeys)],
        isNew: !existing.emojiIds.has(id),
      })
    }
    if (manifest && !emojis.length) warnings.push(`pack ${pk}: ${manifest.source} lists no usable emojis; imported as draft`)

    const animated = emojis.filter((e) => e.animated).length
    const kind: PackKind = !emojis.length || !animated ? 'static' : animated === emojis.length ? 'animated' : 'mixed'
    const status: PackStatus = emojis.length ? 'published' : 'draft'
    const coverId = item.cover?.resourceId?.trim()
    const characterKeys = new Set<string>()
    for (const c of item.characters ?? []) {
      const name = refName(c)
      const k = clean(c.slug) ? `slug:${clean(c.slug)}` : name ? charKeyByName.get(name) : undefined
      if (k && charByKey.has(k)) characterKeys.add(k)
    }
    for (const n of strings(item.facets?.[CHARACTER_FACET])) {
      const k = charKeyByName.get(n)
      if (k) characterKeys.add(k)
    }
    const official = isOfficialPack(item)

    packs.push({
      packKey: pk,
      slug,
      title: clean(item.title) || pk,
      excerpt: clean(item.excerpt) || null,
      descriptionMd: item.description?.trim() || null,
      status,
      sourceKind: official ? 'official' : 'community',
      license: parseLicense(item.license),
      kind,
      pinLevel: Math.round(item.pinLevel ?? 0),
      memorial: item.memorial ?? false,
      sourceUrl: clean(item.url) || null,
      legacyPostName: clean(item.postName) || null,
      publishedAt: status === 'published' ? parseTime(item.publishTime) : null,
      coverEmojiId: emojis.find((e) => e.id === coverId)?.id ?? emojis[0]?.id ?? null,
      downloadCount: Math.max(0, Math.round(item.downloadCount ?? 0)),
      favoriteCount: Math.max(0, Math.round(item.favoriteCount ?? 0)),
      emojis,
      characterKeys: [...characterKeys],
      artistNames: packArtistNames(item),
      tags: packTags(item.facets),
      isNew: !ex,
    })

    const to = `/packs/${encodeURIComponent(slug)}`
    for (const from of [archivePath(item.permalink) ?? archivePath(item.url), item.postName?.trim() ? `/archives/${encodeURIComponent(item.postName.trim())}` : null])
      if (from && from !== to) redirects.set(from, to)
  }

  for (const c of characters) if (c.v1Slug) redirects.set(characterLegacyPath(c.v1Slug), `/characters/${encodeURIComponent(c.slug)}`)

  return {
    packs,
    characters,
    artists,
    tags,
    redirects: [...redirects.entries()].map(([fromPath, toPath]) => ({ fromPath, toPath })).sort((a, b) => cmp(a.fromPath, b.fromPath)),
    warnings,
  }
}

// ---------- database ----------

export async function loadExistingState(): Promise<ExistingState> {
  const d = db()
  const [packs, emojiRows, characters, artists, tags] = await Promise.all([
    d.select({ id: schema.packs.id, packKey: schema.packs.packKey, slug: schema.packs.slug }).from(schema.packs),
    d.select({ id: schema.emojis.id }).from(schema.emojis),
    d
      .select({ id: schema.characters.id, slug: schema.characters.slug, legacySlug: schema.characters.legacySlug, name: schema.characters.name })
      .from(schema.characters),
    d.select({ id: schema.artists.id, slug: schema.artists.slug, name: schema.artists.name }).from(schema.artists),
    d.select({ id: schema.tags.id, dimension: schema.tags.dimension, slug: schema.tags.slug, name: schema.tags.name }).from(schema.tags),
  ])
  return { packs, emojiIds: new Set(emojiRows.map((r) => r.id)), characters, artists, tags }
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

/** Packs, emojis and links are written one pack per transaction; taxonomy first, counts last. */
export async function applyPlan(plan: ImportPlan): Promise<void> {
  const d = db()
  const { characters, artists, tags, packs, emojis, packCharacters, packArtists, packTags, emojiCharacters, redirects } = schema

  // taxonomy: existing rows are reused untouched; new rows are inserted
  const charId = new Map<string, number>()
  for (const c of plan.characters) if (c.existingId != null) charId.set(c.key, c.existingId)
  for (const batch of chunks(plan.characters.filter((c) => c.existingId == null), 500)) {
    await d
      .insert(characters)
      .values(batch.map((c) => ({ slug: c.slug, name: c.name, legacySlug: c.legacySlug })))
      .onConflictDoNothing({ target: characters.slug })
    const rows = await d
      .select({ id: characters.id, slug: characters.slug })
      .from(characters)
      .where(inArray(characters.slug, batch.map((c) => c.slug)))
    const bySlug = new Map(rows.map((r) => [r.slug, r.id]))
    for (const c of batch) charId.set(c.key, bySlug.get(c.slug)!)
  }

  const artistId = new Map<string, number>()
  for (const a of plan.artists) if (a.existingId != null) artistId.set(a.name, a.existingId)
  for (const batch of chunks(plan.artists.filter((a) => a.existingId == null), 500)) {
    await d
      .insert(artists)
      .values(batch.map((a) => ({ slug: a.slug, name: a.name, legacySlug: a.legacySlug })))
      .onConflictDoNothing({ target: artists.slug })
    const rows = await d
      .select({ id: artists.id, slug: artists.slug })
      .from(artists)
      .where(inArray(artists.slug, batch.map((a) => a.slug)))
    const bySlug = new Map(rows.map((r) => [r.slug, r.id]))
    for (const a of batch) artistId.set(a.name, bySlug.get(a.slug)!)
  }

  const tagId = new Map<string, number>()
  const tagKey = (t: { dimension: string; name: string }) => `${t.dimension}\u0000${t.name}`
  for (const t of plan.tags) if (t.existingId != null) tagId.set(tagKey(t), t.existingId)
  for (const t of plan.tags.filter((x) => x.existingId == null)) {
    await d.insert(tags).values({ dimension: t.dimension, slug: t.slug, name: t.name }).onConflictDoNothing({ target: [tags.dimension, tags.slug] })
    const [row] = await d
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.dimension, t.dimension), eq(tags.slug, t.slug)))
    tagId.set(tagKey(t), row!.id)
  }

  for (const p of plan.packs) {
    await d.transaction(async (tx) => {
      const values = {
        packKey: p.packKey,
        slug: p.slug,
        title: p.title,
        excerpt: p.excerpt,
        descriptionMd: p.descriptionMd,
        status: p.status,
        sourceKind: p.sourceKind,
        license: p.license,
        downloadable: false,
        kind: p.kind,
        pinLevel: p.pinLevel,
        memorial: p.memorial,
        sourceUrl: p.sourceUrl,
        legacyPostName: p.legacyPostName,
        coverEmojiId: p.coverEmojiId,
        downloadCount: p.downloadCount,
        favoriteCount: p.favoriteCount,
        publishedAt: p.publishedAt,
      }
      await tx
        .insert(packs)
        .values(values)
        .onConflictDoUpdate({
          target: packs.packKey,
          set: {
            title: sql`excluded.title`,
            excerpt: sql`excluded.excerpt`,
            descriptionMd: sql`excluded.description_md`,
            sourceKind: sql`excluded.source_kind`,
            kind: sql`excluded.kind`,
            pinLevel: sql`excluded.pin_level`,
            memorial: sql`excluded.memorial`,
            sourceUrl: sql`excluded.source_url`,
            legacyPostName: sql`excluded.legacy_post_name`,
            status: sql`CASE WHEN ${packs.status} = 'draft' AND excluded.status = 'published' THEN 'published' ELSE ${packs.status} END`,
            downloadable: sql`CASE WHEN excluded.source_kind = 'official' THEN false ELSE ${packs.downloadable} END`,
            publishedAt: sql`COALESCE(${packs.publishedAt}, excluded.published_at)`,
            coverEmojiId: sql`COALESCE(${packs.coverEmojiId}, excluded.cover_emoji_id)`,
            downloadCount: sql`GREATEST(${packs.downloadCount}, excluded.download_count)`,
            favoriteCount: sql`GREATEST(${packs.favoriteCount}, excluded.favorite_count)`,
          },
          // only touch rows (and updated_at) when something v1 owns actually changed
          setWhere: sql`(${packs.title}, ${packs.excerpt}, ${packs.descriptionMd}, ${packs.sourceKind}, ${packs.kind}, ${packs.pinLevel}, ${packs.memorial}, ${packs.sourceUrl}, ${packs.legacyPostName})
              IS DISTINCT FROM (excluded.title, excluded.excerpt, excluded.description_md, excluded.source_kind, excluded.kind, excluded.pin_level, excluded.memorial, excluded.source_url, excluded.legacy_post_name)
            OR (${packs.status} = 'draft' AND excluded.status = 'published')
            OR (excluded.source_kind = 'official' AND ${packs.downloadable})
            OR (${packs.publishedAt} IS NULL AND excluded.published_at IS NOT NULL)
            OR (${packs.coverEmojiId} IS NULL AND excluded.cover_emoji_id IS NOT NULL)
            OR ${packs.downloadCount} < excluded.download_count
            OR ${packs.favoriteCount} < excluded.favorite_count`,
        })
      const [row] = await tx.select({ id: packs.id }).from(packs).where(eq(packs.packKey, p.packKey))
      const packId = row!.id

      for (const batch of chunks(p.emojis, 500)) {
        await tx
          .insert(emojis)
          .values(
            batch.map((e) => ({
              id: e.id,
              packId,
              storagePackKey: p.packKey,
              status: 'published' as const,
              sortOrder: e.sortOrder,
              originalKey: e.originalKey,
              format: e.format,
              mime: e.mime,
              bytes: e.bytes,
            })),
          )
          .onConflictDoUpdate({
            target: emojis.id,
            set: { format: sql`excluded.format`, mime: sql`excluded.mime`, bytes: sql`excluded.bytes` },
            setWhere: sql`${emojis.packId} = excluded.pack_id AND (${emojis.format}, ${emojis.mime}, ${emojis.bytes}) IS DISTINCT FROM (excluded.format, excluded.mime, excluded.bytes)`,
          })
      }

      const charLinks = p.characterKeys.map((k) => charId.get(k)).filter((id): id is number => id != null)
      if (charLinks.length)
        await tx
          .insert(packCharacters)
          .values(charLinks.map((characterId) => ({ packId, characterId })))
          .onConflictDoNothing()
      const artistLinks = p.artistNames.map((n) => artistId.get(n)).filter((id): id is number => id != null)
      if (artistLinks.length)
        await tx
          .insert(packArtists)
          .values(artistLinks.map((aid) => ({ packId, artistId: aid, role: 'artist' as const })))
          .onConflictDoNothing()
      const tagLinks = [...new Set(p.tags.map((t) => tagId.get(tagKey(t))).filter((id): id is number => id != null))]
      if (tagLinks.length)
        await tx
          .insert(packTags)
          .values(tagLinks.map((tid) => ({ packId, tagId: tid })))
          .onConflictDoNothing()
      const emojiLinks = p.emojis.flatMap((e) => e.characterKeys.map((k) => ({ emojiId: e.id, characterId: charId.get(k)! })))
      for (const batch of chunks(emojiLinks, 1000)) await tx.insert(emojiCharacters).values(batch).onConflictDoNothing()
    })
  }

  for (const batch of chunks(plan.redirects, 500)) {
    await d
      .insert(redirects)
      .values(batch.map((r) => ({ fromPath: r.fromPath, toPath: r.toPath, code: 301 })))
      .onConflictDoUpdate({
        target: redirects.fromPath,
        set: { toPath: sql`excluded.to_path` },
        setWhere: sql`${redirects.toPath} IS DISTINCT FROM excluded.to_path`,
      })
  }

  await recomputeCatalogCounts()
}

/**
 * Denormalised counters from the link tables. Public counts only include published packs and
 * emojis. Plain SQL so packs.updated_at (the edit-submission base version) is not bumped.
 */
export async function recomputeCatalogCounts(): Promise<void> {
  const d = db()
  await d.execute(sql`
    UPDATE packs p SET emoji_count = s.n
    FROM (SELECT p2.id, count(e.id) FILTER (WHERE e.status = 'published')::int AS n
          FROM packs p2 LEFT JOIN emojis e ON e.pack_id = p2.id GROUP BY p2.id) s
    WHERE p.id = s.id AND p.emoji_count <> s.n`)
  await d.execute(sql`
    UPDATE characters c SET pack_count = s.pc, emoji_count = s.ec
    FROM (SELECT c2.id,
            (SELECT count(*) FROM pack_characters pc JOIN packs p ON p.id = pc.pack_id AND p.status = 'published'
              WHERE pc.character_id = c2.id)::int AS pc,
            (SELECT count(*) FROM emoji_characters ec
              JOIN emojis e ON e.id = ec.emoji_id AND e.status = 'published'
              JOIN packs p ON p.id = e.pack_id AND p.status = 'published'
              WHERE ec.character_id = c2.id)::int AS ec
          FROM characters c2) s
    WHERE c.id = s.id AND (c.pack_count, c.emoji_count) IS DISTINCT FROM (s.pc, s.ec)`)
  await d.execute(sql`
    UPDATE artists a SET pack_count = s.n
    FROM (SELECT a2.id,
            (SELECT count(DISTINCT pa.pack_id) FROM pack_artists pa JOIN packs p ON p.id = pa.pack_id AND p.status = 'published'
              WHERE pa.artist_id = a2.id)::int AS n
          FROM artists a2) s
    WHERE a.id = s.id AND a.pack_count <> s.n`)
}

// ---------- entry point ----------

export interface ImportSummary {
  dryRun: boolean
  prefix: string
  packs: { total: number; published: number; draft: number; official: number; new: number }
  emojis: { total: number; new: number }
  characters: { total: number; new: number; renamed: number }
  artists: { total: number; new: number }
  tags: { total: number; new: number }
  redirects: number
  warnings: string[]
}

export function summarize(plan: ImportPlan, opts: { dryRun: boolean; prefix: string }): ImportSummary {
  const emojis = plan.packs.flatMap((p) => p.emojis)
  return {
    dryRun: opts.dryRun,
    prefix: opts.prefix,
    packs: {
      total: plan.packs.length,
      published: plan.packs.filter((p) => p.status === 'published').length,
      draft: plan.packs.filter((p) => p.status === 'draft').length,
      official: plan.packs.filter((p) => p.sourceKind === 'official').length,
      new: plan.packs.filter((p) => p.isNew).length,
    },
    emojis: { total: emojis.length, new: emojis.filter((e) => e.isNew).length },
    characters: {
      total: plan.characters.length,
      new: plan.characters.filter((c) => c.existingId == null).length,
      renamed: plan.characters.filter((c) => c.v1Slug && c.slug !== c.v1Slug).length,
    },
    artists: { total: plan.artists.length, new: plan.artists.filter((a) => a.existingId == null).length },
    tags: { total: plan.tags.length, new: plan.tags.filter((t) => t.existingId == null).length },
    redirects: plan.redirects.length,
    warnings: plan.warnings,
  }
}

export function formatSummary(s: ImportSummary): string {
  const lines = [
    `import-v1${s.dryRun ? ' (dry run, nothing written)' : ''}: ${s.prefix} in bucket ${bucket()}`,
    `  packs       ${s.packs.total} (published ${s.packs.published}, draft ${s.packs.draft}, official ${s.packs.official}; new ${s.packs.new})`,
    `  emojis      ${s.emojis.total} (new ${s.emojis.new})`,
    `  characters  ${s.characters.total} (new ${s.characters.new}; hash slugs replaced ${s.characters.renamed})`,
    `  artists     ${s.artists.total} (new ${s.artists.new})`,
    `  tags        ${s.tags.total} (new ${s.tags.new})`,
    `  redirects   ${s.redirects}`,
    `  warnings    ${s.warnings.length}`,
    ...s.warnings.slice(0, 50).map((w) => `    - ${w}`),
  ]
  if (s.warnings.length > 50) lines.push(`    … ${s.warnings.length - 50} more`)
  return lines.join('\n')
}

export async function importV1(opts: { prefix?: string; dryRun?: boolean; read?: ReadJson } = {}): Promise<ImportSummary> {
  const prefix = opts.prefix ?? 'meta/v1/'
  const snap = await loadV1Snapshot({ prefix, read: opts.read })
  const plan = planImport(snap, await loadExistingState())
  if (!opts.dryRun) await applyPlan(plan)
  return summarize(plan, { dryRun: !!opts.dryRun, prefix })
}
