import { EMOJI_ID_RE } from '#/shared/ids'

// validateSearch helpers for route modules (kept apart from the hooks so routes stay light).

/** The open sticker of the single-emoji dialog: keep a well-formed ?e=, drop anything else. */
export function emojiParam(raw: Record<string, unknown>): { e?: string } {
  return typeof raw.e === 'string' && EMOJI_ID_RE.test(raw.e) ? { e: raw.e } : {}
}
