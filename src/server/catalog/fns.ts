import { createServerFn } from '@tanstack/react-start'
import { HttpError, publicFn } from '../perm/fn'
import { getArtistDetail, listArtists } from './artists'
import { getCharacterDetail, listCharacters } from './characters'
import { CatalogInputError } from './cursor'
import { getExplore } from './explore'
import { getHome } from './home'
import {
  artistDetailInput,
  characterDetailInput,
  charactersInput,
  emojiIdInput,
  galleryInput,
  listPacksInput,
  packSlugInput,
  searchInput,
  suggestInput,
} from './inputs'
import { getEmojiPermalink, getPackDetail } from './pack'
import { listPacks } from './packs'
import { searchCatalog, suggestCatalog } from './search'
import { getGallery } from './stream'

// Public catalog server functions (GET, publicFn). Thin wrappers: the queries live next to this file
// and are what tests call. Results are viewer independent (see types.ts); a malformed cursor is a 400.
// resolveLegacyPath (legacy.ts) is not exposed here: the platform's 301 handler calls it directly.

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof CatalogInputError) throw new HttpError(400, err.message)
    throw err
  }
}

export const homeFn = createServerFn({ method: 'GET' })
  .middleware([publicFn])
  .handler(() => getHome())

export const packsFn = createServerFn({ method: 'GET' })
  .middleware([publicFn])
  .validator(listPacksInput)
  .handler(({ data }) => guard(() => listPacks(data)))

export const packDetailFn = createServerFn({ method: 'GET' })
  .middleware([publicFn])
  .validator(packSlugInput)
  .handler(({ data }) => getPackDetail(data.slug))

export const emojiPermalinkFn = createServerFn({ method: 'GET' })
  .middleware([publicFn])
  .validator(emojiIdInput)
  .handler(({ data }) => getEmojiPermalink(data.emojiId))

export const charactersFn = createServerFn({ method: 'GET' })
  .middleware([publicFn])
  .validator(charactersInput)
  .handler(({ data }) => listCharacters(data))

export const characterDetailFn = createServerFn({ method: 'GET' })
  .middleware([publicFn])
  .validator(characterDetailInput)
  .handler(({ data }) => guard(() => getCharacterDetail(data)))

export const artistsFn = createServerFn({ method: 'GET' })
  .middleware([publicFn])
  .handler(() => listArtists())

export const artistDetailFn = createServerFn({ method: 'GET' })
  .middleware([publicFn])
  .validator(artistDetailInput)
  .handler(({ data }) => guard(() => getArtistDetail(data)))

export const galleryFn = createServerFn({ method: 'GET' })
  .middleware([publicFn])
  .validator(galleryInput)
  .handler(({ data }) => guard(() => getGallery(data)))

export const exploreFn = createServerFn({ method: 'GET' })
  .middleware([publicFn])
  .handler(() => getExplore())

export const searchFn = createServerFn({ method: 'GET' })
  .middleware([publicFn])
  .validator(searchInput)
  .handler(({ data }) => searchCatalog(data))

export const suggestFn = createServerFn({ method: 'GET' })
  .middleware([publicFn])
  .validator(suggestInput)
  .handler(({ data }) => suggestCatalog(data))
