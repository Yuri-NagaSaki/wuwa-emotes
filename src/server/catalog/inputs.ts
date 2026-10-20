import { z } from 'zod'
import { EMOJI_ID_RE } from '#/shared/ids'

// Input schemas for the public catalog functions. Shared by the server functions (validator) and
// the query functions (which parse again, so direct callers get the same defaults and limits).
// zod only: safe to import from client code.

// Slugs are mostly pinyin, but some imported artist slugs are Chinese (e.g. 爱秧斯坦).
const slug = z.string().trim().min(1).max(200)
const cursor = z.string().max(1024)
const limit = (dflt: number, max = 60) => z.number().int().min(1).max(max).default(dflt)

export const SEED_RE = /^[0-9a-z]{1,16}$/
const seed = z.string().regex(SEED_RE)

export const TAG_FILTER_RE = /^(group|tool|project|origin|custom):(.{1,200})$/

export const packSortSchema = z.enum(['hot', 'new', 'fav', 'random'])
export const streamSortSchema = z.enum(['new', 'random'])
export const emojiTypeSchema = z.enum(['animated', 'static'])

export const listPacksInput = z.object({
  /** character slug (pack_characters) */
  character: slug.optional(),
  /** artist slug, any role (artist or commissioner) */
  artist: slug.optional(),
  kind: z.enum(['animated', 'static', 'mixed']).optional(),
  source: z.enum(['community', 'official']).optional(),
  /** tag slug in dimension "group" (分组) */
  group: slug.optional(),
  /** any tag, as "<dimension>:<slug>", e.g. "project:solar5" */
  tag: z.string().regex(TAG_FILTER_RE).optional(),
  sort: packSortSchema.default('new'),
  /** sort = random: start a new order with this seed (ignored when a cursor is given) */
  seed: seed.optional(),
  cursor: cursor.optional(),
  limit: limit(24),
})
export type ListPacksInput = z.input<typeof listPacksInput>

export const packSlugInput = z.object({ slug })
export const emojiIdInput = z.object({ emojiId: z.string().regex(EMOJI_ID_RE) })

/** Ids per batchItemsFn call (the 打包清单 holds up to 2000; the page asks in pages of this size). */
export const BATCH_ITEMS_MAX = 500
export const batchItemsInput = z.object({ ids: z.array(z.string().regex(EMOJI_ID_RE)).max(BATCH_ITEMS_MAX) })
export type BatchItemsInput = z.infer<typeof batchItemsInput>

export const charactersInput = z
  .object({ sort: z.enum(['count', 'recent', 'pinyin']).default('count') })
  .default({ sort: 'count' })
export type CharactersInput = z.input<typeof charactersInput>

export const characterDetailInput = z.object({
  slug,
  tab: z.enum(['packs', 'emojis']).default('packs'),
  /** tab = packs */
  sort: packSortSchema.default('new'),
  /** tab = emojis */
  emojiSort: streamSortSchema.default('new'),
  type: emojiTypeSchema.optional(),
  seed: seed.optional(),
  cursor: cursor.optional(),
  limit: limit(24, 120),
})
export type CharacterDetailInput = z.input<typeof characterDetailInput>

export const artistDetailInput = z.object({
  slug,
  sort: packSortSchema.default('new'),
  seed: seed.optional(),
  cursor: cursor.optional(),
  limit: limit(24),
})
export type ArtistDetailInput = z.input<typeof artistDetailInput>

export const galleryInput = z
  .object({
    sort: streamSortSchema.default('new'),
    /** character slug (emoji_characters) */
    character: slug.optional(),
    type: emojiTypeSchema.optional(),
    seed: seed.optional(),
    cursor: cursor.optional(),
    limit: limit(48, 120),
  })
  .default({ sort: 'new', limit: 48 })
export type GalleryInput = z.input<typeof galleryInput>

export const searchInput = z.object({
  q: z.string().max(200),
  /** per group */
  limit: limit(8, 60),
})
export type SearchInput = z.input<typeof searchInput>

export const suggestInput = z.object({
  q: z.string().max(200),
  limit: limit(8, 20),
})
export type SuggestInput = z.input<typeof suggestInput>
