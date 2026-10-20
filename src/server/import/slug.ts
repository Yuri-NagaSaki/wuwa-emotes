import { createHash } from 'node:crypto'
import { pinyin } from 'pinyin-pro'

// URL slugs for characters, artists and tags. Chinese text becomes toneless pinyin written together
// (爱弥斯 → aimisi, the convention of the readable v1 slugs); other characters pass through and any
// run of punctuation or spaces becomes one hyphen (秧秧·玄翎 → yangyang-xuanling).

const READABLE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_LEN = 60

export function slugify(text: string): string {
  const parts = pinyin(text.normalize('NFKC').trim(), { toneType: 'none', type: 'array', nonZh: 'consecutive', v: true })
  const slug = parts
    .join('')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LEN)
    .replace(/-+$/g, '')
  if (slug) return slug
  // nothing transliterable (emoji, symbols): stable short hash of the text
  return 'x-' + createHash('sha256').update(text).digest('hex').slice(0, 8)
}

/**
 * True when a v1 slug should not be shown in our URLs: Halo hash ids (hex blobs, optionally prefixed
 * like `character-…`), numeric ids, and anything that is not lowercase ASCII words (Chinese slugs,
 * spaces, uppercase). Readable slugs such as `aimisi` or `jinhsi` are kept as they are.
 */
export function isHashSlug(slug: string | null | undefined): boolean {
  const s = (slug ?? '').trim()
  if (!s || !READABLE_RE.test(s)) return true
  const tail = s.replace(/^(?:character|artist|tag|c|a|t)-/, '')
  if (/^[0-9a-f]{8,}$/.test(tail)) return true
  if (/^[0-9]+$/.test(tail)) return true
  return false
}

/** `base`, or `base-2`, `base-3`, … — the first one `taken` does not contain. Adds the result to `taken`. */
export function claimSlug(base: string, taken: Set<string>): string {
  let slug = base
  for (let n = 2; taken.has(slug); n++) slug = `${base.slice(0, MAX_LEN - String(n).length - 1)}-${n}`
  taken.add(slug)
  return slug
}
