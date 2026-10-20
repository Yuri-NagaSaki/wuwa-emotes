import { LINK_REVIEW_THRESHOLD, type HoldReason } from './constants'

// Moderation rules (docs/ARCHITECTURE.md §9: held comments go to the queue, nothing is silently
// dropped). A new comment is held (status pending) when any of these is true:
//   first      firstCommentReview is on and the author has no published comment yet
//              (signed in: by account; guest: by IP hash)
//   links      2 or more links (rendered links plus bare domains / emails)
//   blocklist  the body or the guest name matches a 屏蔽词
//   hot        the author is new (guest, or account younger than 24 h) and the thread is hot
//              (20+ comments in the last hour)
// Staff (the `comments` permission) are never held. Edits re-check links and blocklist. Reports hold a
// published comment again at reportThreshold open reports.

export class CommentError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface ModerationFacts {
  links: number
  blocklistHit: boolean
  firstComment: boolean
  newAuthor: boolean
  hotThread: boolean
}

export function holdReasons(f: ModerationFacts, opts: { firstCommentReview: boolean }): HoldReason[] {
  const out: HoldReason[] = []
  if (opts.firstCommentReview && f.firstComment) out.push('first')
  if (f.links >= LINK_REVIEW_THRESHOLD) out.push('links')
  if (f.blocklistHit) out.push('blocklist')
  if (f.newAuthor && f.hotThread) out.push('hot')
  return out
}

// ---- blocklist ----

function normalize(s: string): string {
  return s.normalize('NFKC').toLowerCase()
}

function wordPattern(word: string): string {
  return normalize(word)
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s\\S]{0,20}?')
}

const compiled = new Map<string, RegExp | null>()

/** One case-insensitive regex for the list; `*` matches up to 20 characters. Cached per list. */
export function compileBlocklist(words: readonly string[]): RegExp | null {
  const key = JSON.stringify(words)
  if (compiled.has(key)) return compiled.get(key)!
  const parts = words
    .map((w) => w.trim())
    .filter((w) => w.replace(/\*/g, '').length > 0)
    .map(wordPattern)
  const re = parts.length ? new RegExp(parts.join('|'), 'u') : null
  if (compiled.size > 20) compiled.clear()
  compiled.set(key, re)
  return re
}

/** The matched text, or null. Also checks the text with whitespace removed (「v 信」). */
export function blocklistMatch(words: readonly string[], ...texts: (string | null | undefined)[]): string | null {
  const re = compileBlocklist(words)
  if (!re) return null
  for (const t of texts) {
    if (!t) continue
    const n = normalize(t)
    const m = re.exec(n) ?? re.exec(n.replace(/\s+/g, ''))
    if (m) return m[0]
  }
  return null
}

// ---- avatar color ----

const COLORS = ['teal', 'pink', 'purple', 'yellow', 'mint', 'orange', 'blue', 'peach', 'green', 'lime'] as const

export function avatarColor(seed: string): string {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return COLORS[h % COLORS.length]!
}
