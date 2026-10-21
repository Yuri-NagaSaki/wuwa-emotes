import { homeFn } from '#/server/catalog/fns'
import type { EmojiImage, HomeData, PackCard } from '#/server/catalog/types'

// Stickers for the sticker wall on the art side of 登录 / 注册 / 找回密码 / 重置密码 (AuthLayout).
// They come from the home data (homeFn: cached 30 s on the server and shareable at the edge), so a
// page view adds no query of its own. The route loaders map it down to this small list, so only a few
// URLs are serialized into the page, not the whole home payload.

export interface ArtSticker {
  id: string
  /** p240 poster (static WebP) */
  src: string
  /** the poster's size: longest edge 240 */
  w: number
  h: number
}

/**
 * How many distinct stickers the wall shows. A p240 poster is about 11 KB on the live site (sample of
 * 40, October 2026), so 22 keep the wall near 240 KB on a desktop, where all of them are on screen.
 */
export const ART_STICKERS = 22

function sticker(e: EmojiImage): ArtSticker {
  const long = Math.max(1, e.width, e.height)
  return { id: e.id, src: e.poster, w: Math.max(1, Math.round((240 * e.width) / long)), h: Math.max(1, Math.round((240 * e.height) / long)) }
}

/**
 * Up to `count` stickers from the home data, deterministic: every pack's cover first (pinned,
 * featured, latest, official, each pack once), then the first mini of each, and so on, so neighbours
 * come from different packs.
 */
export function pickArtStickers(home: Pick<HomeData, 'pinned' | 'featured' | 'latest' | 'official'>, count = ART_STICKERS): ArtSticker[] {
  const packs: PackCard[] = []
  const seenPack = new Set<number>()
  for (const p of [...home.pinned, ...home.featured, ...home.latest, ...home.official]) {
    if (seenPack.has(p.id)) continue
    seenPack.add(p.id)
    packs.push(p)
  }
  const out: ArtSticker[] = []
  const seen = new Set<string>()
  for (let round = 0; round < 4 && out.length < count; round++) {
    for (const p of packs) {
      const e = round === 0 ? p.cover : p.minis[round - 1]
      if (!e || seen.has(e.id)) continue
      seen.add(e.id)
      out.push(sticker(e))
      if (out.length >= count) break
    }
  }
  return out
}

/** For the route loaders: the wall's stickers, or none (the panel is still complete without them). */
export function loadAuthArt(): Promise<ArtSticker[]> {
  return homeFn().then(
    (home) => pickArtStickers(home),
    () => [],
  )
}
