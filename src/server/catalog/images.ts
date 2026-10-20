import { imgUrl } from '../media/keys'
import type { EmojiImage } from './types'

// Image URLs are computed from (storage_pack_key, id, variant_rev) without a lookup (ARCHITECTURE §3.4):
// the storage key is the pack the emoji was ingested into, which may differ from its current pack.

/** Size used until the worker has probed the original (97.6% of stickers are square, ~300 px). */
export const UNKNOWN_SIZE = 300

/** Raw image fields as selected by emojiJson() (sql.ts), or plain columns mapped to the same names. */
export interface RawImage {
  id: string
  /** storage_pack_key */
  k: string
  /** variant_rev */
  r: number
  w: number | null
  h: number | null
  f: number
}

export function toEmojiImage(raw: RawImage): EmojiImage {
  const ref = { packKey: raw.k, emojiId: raw.id, rev: Number(raw.r) }
  const frames = Number(raw.f) || 1
  const known = raw.w != null && raw.h != null && raw.w > 0 && raw.h > 0
  return {
    id: raw.id,
    poster: imgUrl({ variant: 'p240', ...ref }),
    preview: frames > 1 ? imgUrl({ variant: 'a160', ...ref }) : null,
    full: imgUrl({ variant: 'full', ...ref }),
    width: known ? Number(raw.w) : UNKNOWN_SIZE,
    height: known ? Number(raw.h) : UNKNOWN_SIZE,
    frames,
  }
}

export function toEmojiImageOrNull(raw: RawImage | null | undefined): EmojiImage | null {
  return raw ? toEmojiImage(raw) : null
}
