import type { EmojiImage, Page } from '#/server/catalog/types'

/** Follow nextCursor until the end; fails the test on a runaway loop. */
export async function allPages<T>(load: (cursor?: string) => Promise<Page<T>>, maxPages = 200): Promise<{ items: T[]; pages: Page<T>[] }> {
  const pages: Page<T>[] = []
  let cursor: string | undefined
  for (let i = 0; i < maxPages; i++) {
    const page = await load(cursor)
    pages.push(page)
    if (!page.nextCursor) return { items: pages.flatMap((p) => p.items), pages }
    cursor = page.nextCursor
  }
  throw new Error('pagination did not terminate')
}

/** Every EmojiImage-shaped object anywhere inside a value. */
export function collectImages(value: unknown, out: EmojiImage[] = []): EmojiImage[] {
  if (Array.isArray(value)) {
    for (const v of value) collectImages(v, out)
  } else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (typeof o.id === 'string' && typeof o.poster === 'string' && typeof o.full === 'string') out.push(o as unknown as EmojiImage)
    for (const v of Object.values(o)) collectImages(v, out)
  }
  return out
}

export const EMOJI_ID_GLOBAL = /r-[0-9a-f]{20}/g
