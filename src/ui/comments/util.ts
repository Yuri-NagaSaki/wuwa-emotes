import { MAX_STICKERS, STICKER_MARKER_RE, stickerMarker } from '#/server/comments/constants'
import type { Sticker } from '#/server/comments/types'

// Browser-side helpers for the comment components: times, local storage, composing the body.

/** 刚刚 / 5 分钟前 / 3 小时前 / 昨天 21:06 / 10-14 21:06 / 2025-10-14 */
export function relTime(iso: string, now = Date.now()): string {
  const t = new Date(iso)
  const diff = now - t.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 6 * 3600_000) return `${Math.floor(diff / 3600_000)} 小时前`
  const d = new Date(now)
  const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(t, d)) return `今天 ${hm}`
  const y = new Date(d)
  y.setDate(d.getDate() - 1)
  if (sameDay(t, y)) return `昨天 ${hm}`
  const md = `${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  return t.getFullYear() === d.getFullYear() ? `${md} ${hm}` : `${t.getFullYear()}-${md}`
}

export function fullTime(iso: string): string {
  const t = new Date(iso)
  return t.toLocaleString('zh-CN', { hour12: false })
}

// ---- local storage ----

const RECENT_KEY = 'tp:recent-stickers'
const GUEST_KEY = 'tp:comment-guest'
const RECENT_MAX = 24

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // private mode / quota: recent stickers are a convenience only
  }
}

function isSticker(v: unknown): v is Sticker {
  const s = v as Sticker
  return !!s && typeof s.id === 'string' && /^r-[0-9a-f]{20}$/.test(s.id) && typeof s.poster === 'string' && s.poster.startsWith('/img/')
}

export function recentStickers(): Sticker[] {
  const list = read<unknown[]>(RECENT_KEY, [])
  return Array.isArray(list) ? list.filter(isSticker).slice(0, RECENT_MAX) : []
}

export function rememberStickers(used: Sticker[]) {
  const ids = new Set(used.map((s) => s.id))
  write(RECENT_KEY, [...used, ...recentStickers().filter((s) => !ids.has(s.id))].slice(0, RECENT_MAX))
}

export function replaceRecent(list: Sticker[]) {
  write(RECENT_KEY, list.slice(0, RECENT_MAX))
}

export interface GuestIdentity {
  name: string
  email: string
}

export function guestIdentity(): GuestIdentity {
  const g = read<Partial<GuestIdentity>>(GUEST_KEY, {})
  return { name: typeof g.name === 'string' ? g.name : '', email: typeof g.email === 'string' ? g.email : '' }
}

export function rememberGuest(g: GuestIdentity) {
  write(GUEST_KEY, g)
}

// ---- body ----

/** Markers typed into the text (any shape; the server rejects malformed ones). */
export function markersIn(text: string): number {
  return [...text.matchAll(STICKER_MARKER_RE)].length
}

/** Text + picked stickers → body_src: the stickers go into their own paragraph (shown big). */
export function composeBody(text: string, stickers: Sticker[]): string {
  const t = text.trim()
  if (!stickers.length) return t
  const line = stickers.map((s) => stickerMarker(s.id)).join(' ')
  return t ? `${t}\n\n${line}` : line
}

/** Editing: a trailing paragraph made only of markers goes back into the chips. */
export function splitBody(body: string, known: ReadonlyMap<string, Sticker>): { text: string; stickers: Sticker[] } {
  const m = /(?:^|\n\n)((?::s\[r-[0-9a-f]{20}\][ \t]*)+)\s*$/.exec(body)
  if (!m) return { text: body, stickers: [] }
  const ids = [...m[1]!.matchAll(/:s\[(r-[0-9a-f]{20})\]/g)].map((x) => x[1]!)
  if (!ids.every((id) => known.has(id)) || ids.length > MAX_STICKERS) return { text: body, stickers: [] }
  return { text: body.slice(0, m.index).trimEnd(), stickers: ids.map((id) => known.get(id)!) }
}

/** Sticker <img> tags in rendered HTML → Sticker objects (to prefill the chips when editing). */
export function stickersInHtml(html: string | null): Map<string, Sticker> {
  const out = new Map<string, Sticker>()
  if (!html) return out
  for (const m of html.matchAll(/<img class="cmt-stk[^"]*" src="([^"]+\/(r-[0-9a-f]{20})\.r\d+\.webp)" width="(\d+)" height="(\d+)"/g)) {
    out.set(m[2]!, { id: m[2]!, poster: m[1]!, width: Number(m[3]), height: Number(m[4]) })
  }
  return out
}

/** Readable message from a server function error. */
export function errorMessage(err: unknown, fallback = '操作失败，请稍后再试'): string {
  const msg = (err as { message?: unknown } | null)?.message
  if (typeof msg !== 'string' || !msg) return fallback
  // zod / internal messages are not for people
  if (msg.startsWith('[') || msg.length > 120) return fallback
  return msg
}
