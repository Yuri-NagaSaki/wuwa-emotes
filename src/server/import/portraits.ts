import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import sharp from 'sharp'
import { z } from 'zod'
import { db } from '../db/client'
import { IMMUTABLE } from '../media/img'
import { isPortraitName, PORTRAIT_WIDTHS, type PortraitWidth, portraitKey, type PortraitRef } from '../media/keys'
import { headObject, putObject } from '../media/s3'
import { type PaletteColor, paletteColorOf } from './colors'
import { setThemeColor } from './theme-colors'

// import-portraits: official character portraits (立绘) from a manifest into storage and
// characters.portrait_key, plus a theme colour for characters that have none.
//
// Manifest: a JSON array of { name, url, slug?, width?, height?, crop? }. `crop` is
// { left, top, width, height } in source pixels, for sources that are not a portrait yet.
//
// Each entry is matched to a character by slug, else name, else alias, else the name without
// separators (陆·赫斯 = 陆赫斯). Each URL is downloaded once, one after another with a pause, without a
// referrer; the image is cut to 3:4 from the top, written as WebP at every width in PORTRAIT_WIDTHS the
// source covers (240 always), under characters/v1/portraits/<slug>.<hash8>-<w>.webp with immutable
// caching, and the largest key goes into characters.portrait_key. <hash8> covers the source bytes,
// the crop and the processing, so a re-run with the same source changes nothing ("unchanged"), and a
// new source gets new keys. Old objects are left in place. Two characters never get the same source.
//
// The theme colour (colors.ts) is only written where characters.theme_color is empty: admin choices win.
// --no-colors skips that (review with `derive-colors --dry-run`, then write with `derive-colors`).
// --dry-run matches and reports without any download or write.

/** Bump when the processing changes, so every portrait gets new keys. */
const PIPELINE = 'portrait-v1'
const MAX_SOURCE_BYTES = 25 * 1024 * 1024
const USER_AGENT = 'chaochi-import-portraits/1'

const Crop = z.object({ left: z.number().int().min(0), top: z.number().int().min(0), width: z.number().int().positive(), height: z.number().int().positive() })
const Entry = z.object({
  name: z.string().trim().min(1),
  url: z.url({ protocol: /^https?$/ }),
  slug: z.string().trim().min(1).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  crop: Crop.optional(),
})
export type PortraitEntry = z.infer<typeof Entry>

export function parsePortraitManifest(raw: unknown): { entries: PortraitEntry[]; warnings: string[] } {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : null
  if (!list) throw new Error('manifest: expected a JSON array of { name, url, … }')
  const entries: PortraitEntry[] = []
  const warnings: string[] = []
  list.forEach((x, i) => {
    const r = Entry.safeParse(x)
    if (r.success) entries.push(r.data)
    else warnings.push(`entry ${i}: skipped (${r.error.issues[0]?.path.join('.')}: ${r.error.issues[0]?.message})`)
  })
  return { entries, warnings }
}

interface CharacterInfo {
  id: number
  slug: string
  name: string
  themeColor: string | null
  portraitKey: string | null
  aliases: string[]
}

/** Name for comparisons: NFKC, lower case, without spaces and separators (· ・ • . - _). */
export function normName(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s·・•.\-_]+/g, '')
}

export function matchCharacter(entry: Pick<PortraitEntry, 'name' | 'slug'>, chars: CharacterInfo[]): { character: CharacterInfo; by: 'slug' | 'name' | 'alias' | 'normalized' } | null {
  if (entry.slug) {
    const c = chars.find((x) => x.slug === entry.slug)
    return c ? { character: c, by: 'slug' } : null
  }
  const exact = chars.find((x) => x.name === entry.name)
  if (exact) return { character: exact, by: 'name' }
  const alias = chars.find((x) => x.aliases.includes(entry.name))
  if (alias) return { character: alias, by: 'alias' }
  const n = normName(entry.name)
  const norm = chars.filter((x) => normName(x.name) === n || x.aliases.some((a) => normName(a) === n))
  return norm.length === 1 ? { character: norm[0]!, by: 'normalized' } : null
}

async function loadCharacters(): Promise<CharacterInfo[]> {
  const res = await db().execute<{ id: number; slug: string; name: string; theme_color: string | null; portrait_key: string | null; aliases: string[] }>(sql`
    select c.id, c.slug, c.name, c.theme_color, c.portrait_key,
      coalesce((select array_agg(a.alias order by a.alias) from character_aliases a where a.character_id = c.id), '{}') as aliases
    from characters c order by c.id`)
  return res.rows.map((r) => ({ id: Number(r.id), slug: r.slug, name: r.name, themeColor: r.theme_color, portraitKey: r.portrait_key, aliases: r.aliases ?? [] }))
}

export type Fetcher = (url: string) => Promise<Response>

/** Plain GET without a referrer, following redirects. */
export const defaultFetcher: Fetcher = (url) =>
  fetch(url, { redirect: 'follow', referrerPolicy: 'no-referrer', headers: { 'user-agent': USER_AGENT, accept: 'image/*' } } as RequestInit)

async function download(fetcher: Fetcher, url: string): Promise<Buffer> {
  const res = await fetcher(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const type = res.headers.get('content-type') ?? ''
  if (type && !/^image\//i.test(type) && !/octet-stream/i.test(type)) throw new Error(`not an image (${type})`)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_SOURCE_BYTES) throw new Error(`too large (${declared} bytes)`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_SOURCE_BYTES) throw new Error(`too large (${buf.length} bytes)`)
  if (!buf.length) throw new Error('empty body')
  return buf
}

export interface RenderedPortrait {
  hash8: string
  /** WebP per width, largest last */
  variants: { width: PortraitWidth; bytes: Buffer }[]
  /** the source after cropping */
  sourceWidth: number
  sourceHeight: number
  color: PaletteColor | null
}

/** Crop, cut to 3:4 from the top, encode every width the source covers (240 always). */
export async function renderPortrait(source: Buffer, crop?: PortraitEntry['crop']): Promise<RenderedPortrait> {
  const meta = await sharp(source, { animated: false }).metadata()
  if (!meta.width || !meta.height) throw new Error('unreadable image')
  if (crop && (crop.left + crop.width > meta.width || crop.top + crop.height > meta.height)) {
    throw new Error(`crop ${crop.left},${crop.top} ${crop.width}×${crop.height} is outside the ${meta.width}×${meta.height} image`)
  }
  const base = () => {
    const img = sharp(source, { animated: false }).rotate()
    return crop ? img.extract(crop) : img
  }
  const w = crop?.width ?? meta.width
  const h = crop?.height ?? meta.height
  // the widest 3:4 frame that fits the source decides which widths are real (no upscaling past 240)
  const frameW = Math.min(w, Math.floor((h * 3) / 4))
  const widths = PORTRAIT_WIDTHS.filter((x) => x === 240 || x <= frameW)
  const hash8 = createHash('sha256')
    .update(`${PIPELINE}\n${JSON.stringify(crop ?? null)}\n`)
    .update(source)
    .digest('hex')
    .slice(0, 8)
  const variants: RenderedPortrait['variants'] = []
  for (const width of widths) {
    const bytes = await base()
      .resize(width, Math.round((width * 4) / 3), { fit: 'cover', position: 'top' })
      .webp({ quality: 84, alphaQuality: 90, effort: 5 })
      .toBuffer()
    variants.push({ width, bytes })
  }
  return { hash8, variants, sourceWidth: w, sourceHeight: h, color: await paletteColorOf(variants[0]!.bytes) }
}

/** repaired: same portrait, but some of its objects were missing and have been written again */
export type PortraitOutcome = 'new' | 'replaced' | 'unchanged' | 'repaired' | 'failed' | 'skipped'

export interface PortraitResult {
  entry: string
  url: string
  slug: string | null
  by: string | null
  outcome: PortraitOutcome
  key: string | null
  color: string | null
  colorSet: boolean
  note: string | null
}

export interface PortraitSummary {
  dryRun: boolean
  /** theme colours were written (not --no-colors) */
  colors: boolean
  results: PortraitResult[]
  /** manifest entries that matched no character */
  unmatchedEntries: string[]
  /** characters (slug, name) without a portrait after the run */
  withoutPortrait: { slug: string; name: string }[]
  warnings: string[]
}

export interface ImportPortraitsOptions {
  dryRun?: boolean
  /** write theme colours where empty (default true); false leaves them to derive-colors */
  colors?: boolean
  fetcher?: Fetcher
  /** pause before each download (ms) */
  delayMs?: number
  log?: (line: string) => void
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function importPortraits(raw: unknown, opts: ImportPortraitsOptions = {}): Promise<PortraitSummary> {
  const { entries, warnings } = parsePortraitManifest(raw)
  const fetcher = opts.fetcher ?? defaultFetcher
  const delayMs = opts.delayMs ?? 800
  const log = opts.log ?? (() => {})
  const chars = await loadCharacters()
  const results: PortraitResult[] = []
  const unmatchedEntries: string[] = []
  const claimed = new Map<number, string>()

  const plan: { entry: PortraitEntry; character: CharacterInfo; by: string }[] = []
  for (const entry of entries) {
    const m = matchCharacter(entry, chars)
    if (!m) {
      unmatchedEntries.push(entry.slug ? `${entry.name} (slug ${entry.slug})` : entry.name)
      continue
    }
    const first = claimed.get(m.character.id)
    if (first) {
      warnings.push(`${entry.name}: ${m.character.slug} already gets the portrait of entry "${first}"; skipped`)
      results.push({ entry: entry.name, url: entry.url, slug: m.character.slug, by: m.by, outcome: 'skipped', key: null, color: null, colorSet: false, note: 'duplicate character' })
      continue
    }
    claimed.set(m.character.id, entry.name)
    plan.push({ entry, character: m.character, by: m.by })
  }

  const hashOwner = new Map<string, string>()
  for (const c of chars) {
    const h = c.portraitKey ? /\.([0-9a-f]{8})-\d+\.webp$/.exec(c.portraitKey)?.[1] : null
    if (h) hashOwner.set(h, c.slug)
  }

  const downloaded = new Map<string, Buffer>()
  let fetched = 0
  for (const { entry, character, by } of plan) {
    const base: PortraitResult = { entry: entry.name, url: entry.url, slug: character.slug, by, outcome: 'skipped', key: null, color: null, colorSet: false, note: null }
    if (opts.dryRun) {
      results.push({ ...base, key: character.portraitKey, note: character.portraitKey ? 'has a portrait' : 'no portrait yet' })
      continue
    }
    try {
      let source = downloaded.get(entry.url)
      if (!source) {
        if (fetched++ > 0 && delayMs > 0) await sleep(delayMs)
        source = await download(fetcher, entry.url)
        downloaded.set(entry.url, source)
      }
      const r = await renderPortrait(source, entry.crop)
      const owner = hashOwner.get(r.hash8)
      if (owner && owner !== character.slug) {
        results.push({ ...base, note: `same source as ${owner}` })
        warnings.push(`${entry.name}: same image as the portrait of ${owner}; skipped`)
        continue
      }
      hashOwner.set(r.hash8, character.slug)
      const name = isPortraitName(character.slug) ? character.slug : `c${character.id}`
      const ref = (width: PortraitWidth): PortraitRef => ({ name, hash8: r.hash8, width })
      const keys = r.variants.map((v) => portraitKey(ref(v.width)))
      const largest = keys[keys.length - 1]!
      const present = await Promise.all(keys.map((k) => headObject(k)))
      const same = character.portraitKey === largest
      const outcome: PortraitOutcome = same ? (present.every(Boolean) ? 'unchanged' : 'repaired') : character.portraitKey ? 'replaced' : 'new'
      for (const [k, v] of r.variants.entries()) if (!present[k]) await putObject(keys[k]!, v.bytes, 'image/webp', IMMUTABLE)
      if (!same) await db().execute(sql`update characters set portrait_key = ${largest}, updated_at = now() where id = ${character.id}`)
      const color = r.color?.name ?? null
      const colorSet = color && opts.colors !== false ? await setThemeColor(character.id, color) : false
      results.push({ ...base, outcome, key: largest, color, colorSet, note: `${r.sourceWidth}×${r.sourceHeight} → ${r.variants.map((v) => v.width).join('/')}` })
      log(`  ${outcome.padEnd(9)} ${character.slug} ${largest}${colorSet ? ` (theme ${color})` : ''}`)
    } catch (err) {
      results.push({ ...base, outcome: 'failed', note: err instanceof Error ? err.message : String(err) })
      log(`  failed    ${character.slug} ${entry.url}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const after = opts.dryRun ? chars : await loadCharacters()
  const withPortrait = new Set(opts.dryRun ? plan.map((p) => p.character.id) : [])
  const withoutPortrait = after.filter((c) => !c.portraitKey && !withPortrait.has(c.id)).map((c) => ({ slug: c.slug, name: c.name }))
  return { dryRun: !!opts.dryRun, colors: opts.colors !== false, results, unmatchedEntries, withoutPortrait, warnings }
}

export function formatPortraitSummary(s: PortraitSummary): string {
  const count = (o: PortraitOutcome) => s.results.filter((r) => r.outcome === o).length
  const lines = [
    `import-portraits${s.dryRun ? ' (dry run: nothing downloaded or written)' : ''}`,
    `  matched     ${s.results.length} (${[...new Set(s.results.map((r) => r.by))].map((b) => `${b} ${s.results.filter((r) => r.by === b).length}`).join(', ')})`,
  ]
  if (!s.dryRun) {
    lines.push(`  new ${count('new')}, replaced ${count('replaced')}, unchanged ${count('unchanged')}, repaired ${count('repaired')}, failed ${count('failed')}, skipped ${count('skipped')}`)
    lines.push(`  theme colours set ${s.results.filter((r) => r.colorSet).length} (only where empty${s.colors ? '' : '; --no-colors: none written'})`)
  }
  for (const r of s.results) {
    const tail = [r.key, r.color ? `colour ${r.color}${r.colorSet ? ' (set)' : ''}` : null, r.note].filter(Boolean).join('  ')
    lines.push(`    ${(s.dryRun && r.outcome === 'skipped' && r.note !== 'duplicate character' ? 'match' : r.outcome).padEnd(9)} ${r.entry} → ${r.slug ?? '?'} [${r.by}]  ${tail}`)
  }
  lines.push(`  manifest entries without a character: ${s.unmatchedEntries.length ? s.unmatchedEntries.join(', ') : 'none'}`)
  lines.push(`  characters without a portrait: ${s.withoutPortrait.length ? s.withoutPortrait.map((c) => c.name).join(', ') : 'none'}`)
  if (s.warnings.length) lines.push(`  warnings ${s.warnings.length}`, ...s.warnings.map((w) => `    - ${w}`))
  return lines.join('\n')
}
