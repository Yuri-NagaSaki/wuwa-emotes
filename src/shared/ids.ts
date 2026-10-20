// Identifier formats shared by routes, storage keys and validation.
// Every existing R2 key matches these (309 pack keys, 15,272 emoji ids, checked 2026-10-20).

export const EMOJI_ID_RE = /^r-[0-9a-f]{20}$/
export const PACK_KEY_RE = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/
export const REV_RE = /^[1-9][0-9]*$/

export function isEmojiId(value: string): boolean {
  return EMOJI_ID_RE.test(value)
}

export function isPackKey(value: string): boolean {
  return PACK_KEY_RE.test(value)
}

/** New emoji ids: `r-` + 20 lowercase hex chars (80 random bits), same shape as v1. */
export function newEmojiId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return 'r-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Pack keys for new packs: a readable slug part plus a random suffix, always matching PACK_KEY_RE.
 * The slug part is optional because many titles are Chinese-only.
 */
export function newPackKey(slugHint = ''): string {
  const base = slugHint
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  const suffix = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return base ? `${base}-${suffix}` : `u-${suffix}`
}
