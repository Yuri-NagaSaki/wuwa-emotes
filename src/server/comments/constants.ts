// Comment limits and fixed vocabularies (docs/ARCHITECTURE.md §9). No server imports: the UI and the
// settings schema read these too.

/** Characters of body_src. */
export const MAX_BODY = 1000
/** Sticker markers per comment (occurrences, not distinct ids). */
export const MAX_STICKERS = 6
export const GUEST_NAME_MAX = 20

/** Honeypot field name in the composer form; any value rejects the submission. */
export const HONEYPOT_FIELD = 'website'
/** The signed form timestamp must be at least this old when the comment is posted. */
export const MIN_FILL_MS = 3000
/** …and at most this old (the composer fetches a fresh one when it is older). */
export const FORM_TOKEN_MAX_AGE_MS = 24 * 3600_000

/** Rate limits per IP hash and per account (create + edit share them). */
export const RATE = {
  perMinute: 5,
  perDay: 50,
  reactionsPerMinute: 30,
  reportsPerHour: 10,
  previewsPerMinute: 30,
} as const

/** 「热帖」: at least this many comments in the thread during the last hour. */
export const HOT_THREAD_PER_HOUR = 20
/** Accounts younger than this count as new for the hot-thread rule. */
export const NEW_ACCOUNT_MS = 24 * 3600_000
/** Two or more links hold a comment for review. */
export const LINK_REVIEW_THRESHOLD = 2

/** Replies shown under each root before 「展开其余 n 条回复」. */
export const REPLY_PREVIEW = 3
export const ROOTS_PER_PAGE = 20
export const REPLIES_PER_PAGE = 50
export const QUEUE_PER_PAGE = 50

/** Fixed reaction set; labels match the prototype's 回应贴纸. */
export const REACTION_KEYS = ['like', 'lol', 'cry', 'hug', 'q', 'wow'] as const
export type ReactionKey = (typeof REACTION_KEYS)[number]
export const REACTION_LABELS: Record<ReactionKey, string> = {
  like: '好耶',
  lol: '笑死',
  cry: '哭哭',
  hug: '贴贴',
  q: '问号',
  wow: '震撼',
}

/** staff_badge values. Staff authors get their role automatically; 画师 is set by a moderator. */
export const BADGES = ['admin', 'manager', 'artist'] as const
export type Badge = (typeof BADGES)[number]
export const BADGE_LABELS: Record<Badge, string> = { admin: '站长', manager: '管理员', artist: '画师' }

/** Loose marker shape (anything between `:s[` and `]` on one line); the id inside must match EMOJI_ID_RE. */
export const STICKER_MARKER_RE = /:s\[([^\[\]\n]{0,64})\]/g

export function stickerMarker(id: string): string {
  return `:s[${id}]`
}

/** Moderation reasons shown in the 评论审核 queue. */
export type HoldReason = 'first' | 'links' | 'blocklist' | 'hot' | 'reported'
export const HOLD_REASON_LABELS: Record<HoldReason, string> = {
  first: '首次评论',
  links: '外链',
  blocklist: '屏蔽词',
  hot: '新用户 · 热帖',
  reported: '被举报',
}
