import type { PackDetail } from '#/server/catalog/types'

// Browser-only memory of recently shown pack details, so switching between /packs/:slug and the
// /e/:emojiId deep link of the same pack (open, ←/→, close, Back) never refetches or flashes.
// The server never reads it: SSR always loads fresh data.

declare module '@tanstack/history' {
  interface HistoryState {
    /** set on the history entry the single-emoji dialog pushed, so closing it can go back */
    tpDialog?: boolean
  }
}

const TTL_MS = 5 * 60_000
const MAX = 8
const packs = new Map<string, { at: number; pack: PackDetail }>()

export function rememberPack(pack: PackDetail): void {
  if (typeof window === 'undefined') return
  packs.delete(pack.slug)
  packs.set(pack.slug, { at: Date.now(), pack })
  while (packs.size > MAX) packs.delete(packs.keys().next().value!)
}

export function cachedPack(slug: string): PackDetail | null {
  if (typeof window === 'undefined') return null
  const hit = packs.get(slug)
  if (!hit || Date.now() - hit.at > TTL_MS) return null
  return hit.pack
}

/** The cached pack holding this emoji, with the emoji's index. */
export function cachedPackOf(emojiId: string): { pack: PackDetail; index: number } | null {
  if (typeof window === 'undefined') return null
  for (const { at, pack } of packs.values()) {
    if (Date.now() - at > TTL_MS) continue
    const index = pack.emojis.findIndex((e) => e.id === emojiId)
    if (index >= 0) return { pack, index }
  }
  return null
}
