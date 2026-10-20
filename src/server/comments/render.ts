import MarkdownIt from 'markdown-it'
import type { StateCore, StateInline, Token } from 'markdown-it'
import { EMOJI_ID_RE } from '#/shared/ids'
import type { Sticker } from './types'

// The one place comment bodies become HTML (docs/ARCHITECTURE.md §9). Server only: never import this
// from src/ui (it would ship markdown-it to the browser).
//
// - markdown-it with html: false (raw HTML is escaped), linkify on, typographer off, images disabled.
//   Headings, tables, rules, reference links and indented code are off too: a comment is a paragraph
//   or a few, not a document.
// - validateLink: the default check (no javascript:/vbscript:/file:, data: only for a few image types)
//   runs first; on top of it only http(s):, mailto: and scheme-less (site-relative) URLs pass, so the
//   default's data:image/* allowance never reaches an href. A rejected link renders as its text.
// - Every link gets rel="nofollow ugc noopener" target="_blank".
// - Stickers: `:s[r-<20 hex>]` is an inline token (so a marker inside `code` stays literal and is not
//   counted). Rendering emits a placeholder comment `<!--stk:<id>:<b|i>-->`, which user text can never
//   produce (html: false escapes "<"); finalizeHtml() swaps it for the <img> when the sticker is still
//   published, or drops it. So the cached HTML does not go stale when a sticker is hidden later.

const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: true })
md.disable(['image', 'heading', 'lheading', 'table', 'hr', 'reference', 'code', 'html_block', 'html_inline'])
md.linkify.set({ fuzzyEmail: false })

// Link counting for moderation also sees what is not rendered as a link: bare domains (example.cn,
// www.example.com) and email addresses are what spam usually carries.
const fuzzy = new MarkdownIt().linkify.set({ fuzzyLink: true, fuzzyEmail: true, fuzzyIP: true })

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i
const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto'])
const defaultValidateLink = md.validateLink.bind(md)

export function isAllowedHref(url: string): boolean {
  if (!defaultValidateLink(url)) return false
  const m = SCHEME_RE.exec(url.trim())
  return !m || ALLOWED_SCHEMES.has(m[1]!.toLowerCase())
}
md.validateLink = isAllowedHref

// ---- sticker markers ----

const COLON = 0x3a
const LOWER_S = 0x73
const OPEN_BRACKET = 0x5b
const MAX_MARKER_INNER = 64

function stickerRule(state: StateInline, silent: boolean): boolean {
  const pos = state.pos
  const src = state.src
  if (src.charCodeAt(pos) !== COLON || src.charCodeAt(pos + 1) !== LOWER_S || src.charCodeAt(pos + 2) !== OPEN_BRACKET) return false
  const end = src.indexOf(']', pos + 3)
  if (end < 0 || end >= state.posMax || end - (pos + 3) > MAX_MARKER_INNER) return false
  const inner = src.slice(pos + 3, end)
  if (/[[\n]/.test(inner)) return false
  if (!silent) {
    const t = state.push('sticker', '', 0)
    t.content = inner
    t.markup = src.slice(pos, end + 1)
  }
  state.pos = end + 1
  return true
}
md.inline.ruler.before('linkify', 'sticker', stickerRule)

/** A link whose destination failed validateLink keeps href="": drop the <a> and keep its text. */
function dropEmptyLinks(state: StateCore) {
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue
    const out: Token[] = []
    const dropped: boolean[] = []
    for (const t of block.children) {
      if (t.type === 'link_open') {
        const drop = !t.attrGet('href')
        dropped.push(drop)
        if (drop) continue
      } else if (t.type === 'link_close') {
        if (dropped.pop()) continue
      }
      out.push(t)
    }
    block.children = out
  }
}

/** Stickers alone on a line show big (92 px boxes); stickers inside text show at text size. */
function markStickerSize(state: StateCore) {
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue
    const kids = block.children
    const alone = kids.every((t) => t.type === 'sticker' || t.type === 'softbreak' || t.type === 'hardbreak' || (t.type === 'text' && !t.content.trim()))
    for (const t of kids) if (t.type === 'sticker') t.meta = { big: alone }
  }
}
md.core.ruler.push('drop_empty_links', dropEmptyLinks)
md.core.ruler.push('sticker_size', markStickerSize)

md.renderer.rules.sticker = (tokens, idx) => {
  const t = tokens[idx]!
  if (!EMOJI_ID_RE.test(t.content)) return md.utils.escapeHtml(t.markup)
  const big = (t.meta as { big?: boolean } | null)?.big !== false
  return `<!--stk:${t.content}:${big ? 'b' : 'i'}-->`
}

md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  const t = tokens[idx]!
  t.attrSet('rel', 'nofollow ugc noopener')
  t.attrSet('target', '_blank')
  return self.renderToken(tokens, idx, options)
}

// ---- analysis ----

export interface BodyAnalysis {
  /** Sticker ids in order of appearance (with repeats), valid format only. */
  stickers: string[]
  /** Distinct valid ids, in order of first appearance (what sticker_ids stores). */
  stickerIds: string[]
  /** Markers whose content is not an emoji id. */
  badMarkers: string[]
  /** Links that render as <a> (markdown links, autolinks, linkified URLs) plus bare domains and emails. */
  links: number
  /** Plain text for excerpts (stickers become 「[贴纸]」). */
  text: string
}

function walk(tokens: Token[], visit: (t: Token) => void) {
  for (const t of tokens) {
    visit(t)
    if (t.children) walk(t.children, visit)
  }
}

export function analyzeBody(src: string): BodyAnalysis {
  const tokens = md.parse(src, {})
  const stickers: string[] = []
  const badMarkers: string[] = []
  const text: string[] = []
  const plain: string[] = []
  let links = 0
  let inLink = 0
  walk(tokens, (t) => {
    if (t.type === 'sticker') {
      if (EMOJI_ID_RE.test(t.content)) stickers.push(t.content)
      else badMarkers.push(t.markup)
      text.push('[贴纸]')
      plain.push(' ')
    } else if (t.type === 'link_open') {
      links++
      inLink++
    } else if (t.type === 'link_close') inLink--
    else if (t.type === 'text' || t.type === 'code_inline' || t.type === 'fence' || t.type === 'code_block') {
      text.push(t.content)
      plain.push(inLink > 0 ? ' ' : t.content)
    } else if (t.type === 'softbreak' || t.type === 'hardbreak' || t.type === 'paragraph_close') {
      text.push(' ')
      plain.push(' ')
    }
  })
  links += fuzzy.match(plain.join(''))?.length ?? 0
  return {
    stickers,
    stickerIds: [...new Set(stickers)],
    badMarkers,
    links,
    text: text.join('').replace(/\s+/g, ' ').trim(),
  }
}

/** Markdown → HTML with sticker placeholders. Uncached; use renderCached for stored comments. */
export function renderBody(src: string): string {
  return md.render(src)
}

// ---- in-process cache, keyed by (comment id, edited_at) ----

const CACHE_MAX = 4000
const cache = new Map<string, string>()

export function renderCached(id: number, editedAt: Date | string | null, src: string): string {
  const stamp = editedAt == null ? 0 : new Date(editedAt).getTime()
  const key = `${id}:${stamp}`
  const hit = cache.get(key)
  if (hit !== undefined) {
    // refresh LRU position
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const html = renderBody(src)
  cache.set(key, html)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
  return html
}

export function renderCacheSize(): number {
  return cache.size
}

export function clearRenderCache() {
  cache.clear()
}

// ---- placeholders → <img> ----

const PLACEHOLDER_RE = /<!--stk:(r-[0-9a-f]{20}):([bi])-->/g
const P240 = 240

/** Pixel size of the p240 poster (longest edge 240, never upscaled). */
export function posterSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= P240) return { width, height }
  const k = P240 / longest
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }
}

export function placeholderIds(html: string): string[] {
  return [...html.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!)
}

/** Replace sticker placeholders with <img> for stickers in `stickers`; drop the rest. */
export function finalizeHtml(html: string, stickers: ReadonlyMap<string, Sticker>): string {
  return html.replace(PLACEHOLDER_RE, (_, id: string, size: string) => {
    const s = stickers.get(id)
    if (!s) return ''
    const cls = size === 'b' ? 'cmt-stk' : 'cmt-stk is-inline'
    const esc = md.utils.escapeHtml
    return `<img class="${cls}" src="${esc(s.poster)}" width="${s.width}" height="${s.height}" alt="" loading="lazy" decoding="async">`
  })
}
