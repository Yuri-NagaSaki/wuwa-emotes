// Type-level contract check for the catalog server functions, as the page lanes will call them.
// Never executed (no .test suffix); `tsc --noEmit` fails if a call signature or result type drifts.
import {
  artistDetailFn,
  artistsFn,
  characterDetailFn,
  charactersFn,
  emojiPermalinkFn,
  exploreFn,
  galleryFn,
  homeFn,
  packDetailFn,
  packsFn,
  searchFn,
  suggestFn,
} from '#/server/catalog/fns'
import type {
  ArtistCard,
  ArtistLookup,
  CharacterCard,
  CharacterLookup,
  EmojiPermalink,
  EmojiTile,
  ExploreData,
  HomeData,
  PackCard,
  PackLookup,
  Page,
  SearchResult,
  Suggestion,
} from '#/server/catalog/types'

export async function contract(): Promise<void> {
  const home: HomeData = await homeFn()
  const packs: Page<PackCard> = await packsFn({ data: { sort: 'hot' } })
  const filtered: Page<PackCard> = await packsFn({ data: { character: 'aimisi', tag: 'project:solar5', cursor: packs.nextCursor ?? undefined } })
  const detail: PackLookup = await packDetailFn({ data: { slug: 'aimisi-01' } })
  const link: EmojiPermalink | null = await emojiPermalinkFn({ data: { emojiId: 'r-0a7bf47f0ec26d3843bf' } })
  const chars: CharacterCard[] = await charactersFn()
  const charsRecent: CharacterCard[] = await charactersFn({ data: { sort: 'recent' } })
  const char: CharacterLookup = await characterDetailFn({ data: { slug: 'aimisi', tab: 'emojis' } })
  if (char.kind === 'character' && char.tab === 'emojis') {
    const tiles: EmojiTile[] = char.page.items
    void tiles
  }
  const artists: ArtistCard[] = await artistsFn()
  const artist: ArtistLookup = await artistDetailFn({ data: { slug: 'maowushi' } })
  const gallery: Page<EmojiTile> = await galleryFn()
  const shuffled: Page<EmojiTile> = await galleryFn({ data: { sort: 'random', seed: 'abc' } })
  const explore: ExploreData = await exploreFn()
  const found: SearchResult = await searchFn({ data: { q: '心' } })
  const quick: Suggestion[] = await suggestFn({ data: { q: '心' } })
  void [home, filtered, detail, link, chars, charsRecent, artists, artist, gallery, shuffled, explore, found, quick]
}
