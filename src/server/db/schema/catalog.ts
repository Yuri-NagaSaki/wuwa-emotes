import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core'
import { users } from './auth'
import { createdAt, tstz, updatedAt } from './_shared'

export type PackStatus = 'draft' | 'published' | 'hidden'
export type EmojiStatus = 'pending' | 'published' | 'hidden'
export type SourceKind = 'community' | 'official'
export type PackKind = 'animated' | 'static' | 'mixed'

export const packs = pgTable(
  'packs',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    // R2 directory name at first ingest; never changes (object keys hang off it)
    packKey: text('pack_key').notNull().unique(),
    // URL slug; renames move the old value into redirects
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    excerpt: text('excerpt'),
    descriptionMd: text('description_md'),
    status: text('status').$type<PackStatus>().notNull().default('draft'),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
    sourceKind: text('source_kind').$type<SourceKind>().notNull().default('community'),
    license: text('license').notNull().default('unknown'),
    // 「允许下载」: off on import; official packs stay off
    downloadable: boolean('downloadable').notNull().default(false),
    kind: text('kind').$type<PackKind>().notNull().default('static'),
    pinLevel: integer('pin_level').notNull().default(0),
    memorial: boolean('memorial').notNull().default(false),
    commissioner: text('commissioner'),
    creditsText: text('credits_text'),
    sourceUrl: text('source_url'),
    legacyPostName: text('legacy_post_name'),
    coverEmojiId: text('cover_emoji_id'),
    emojiCount: integer('emoji_count').notNull().default(0),
    downloadCount: bigint('download_count', { mode: 'number' }).notNull().default(0),
    favoriteCount: integer('favorite_count').notNull().default(0),
    publishedAt: tstz('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('packs_status_published_idx').on(t.status, t.publishedAt),
    index('packs_owner_idx').on(t.ownerId),
    index('packs_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
  ],
)

export const emojis = pgTable(
  'emojis',
  {
    // r- + 20 hex, same as v1
    id: text('id').primaryKey(),
    packId: integer('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    // pack key at ingest; derived keys use it even if the emoji later moves
    storagePackKey: text('storage_pack_key').notNull(),
    status: text('status').$type<EmojiStatus>().notNull().default('pending'),
    sortOrder: integer('sort_order').notNull().default(0),
    originalKey: text('original_key').notNull(),
    format: text('format').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    frames: integer('frames').notNull().default(1),
    durationMs: integer('duration_ms'),
    posterFrame: integer('poster_frame').notNull().default(0),
    sha256: text('sha256'),
    dominantColor: text('dominant_color'),
    // bumped on regeneration; part of every /img URL
    variantRev: integer('variant_rev').notNull().default(1),
    p240Bytes: integer('p240_bytes'),
    a160Bytes: integer('a160_bytes'),
    fullBytes: integer('full_bytes'),
    derivedReady: boolean('derived_ready').notNull().default(false),
    fullReady: boolean('full_ready').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('emojis_pack_sort_idx').on(t.packId, t.sortOrder),
    index('emojis_status_idx').on(t.status),
    index('emojis_sha256_idx').on(t.sha256),
  ],
)

export const characters = pgTable(
  'characters',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    themeColor: text('theme_color'),
    avatarEmojiId: text('avatar_emoji_id'),
    sort: integer('sort').notNull().default(0),
    packCount: integer('pack_count').notNull().default(0),
    emojiCount: integer('emoji_count').notNull().default(0),
    legacySlug: text('legacy_slug'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('characters_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops'))],
)

export const characterAliases = pgTable(
  'character_aliases',
  {
    characterId: integer('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.characterId, t.alias] }),
    unique('character_aliases_alias_key').on(t.alias),
    index('character_aliases_trgm_idx').using('gin', t.alias.op('gin_trgm_ops')),
  ],
)

export const artists = pgTable(
  'artists',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    links: jsonb('links').$type<{ label: string; url: string }[]>().notNull().default([]),
    packCount: integer('pack_count').notNull().default(0),
    legacySlug: text('legacy_slug'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('artists_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops'))],
)

export const artistAliases = pgTable(
  'artist_aliases',
  {
    artistId: integer('artist_id')
      .notNull()
      .references(() => artists.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.artistId, t.alias] }),
    unique('artist_aliases_alias_key').on(t.alias),
    index('artist_aliases_trgm_idx').using('gin', t.alias.op('gin_trgm_ops')),
  ],
)

export const packCharacters = pgTable(
  'pack_characters',
  {
    packId: integer('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    characterId: integer('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.packId, t.characterId] }), index('pack_characters_character_idx').on(t.characterId)],
)

export const emojiCharacters = pgTable(
  'emoji_characters',
  {
    emojiId: text('emoji_id')
      .notNull()
      .references(() => emojis.id, { onDelete: 'cascade' }),
    characterId: integer('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.emojiId, t.characterId] }), index('emoji_characters_character_idx').on(t.characterId)],
)

export type ArtistRole = 'artist' | 'commissioner'

export const packArtists = pgTable(
  'pack_artists',
  {
    packId: integer('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    artistId: integer('artist_id')
      .notNull()
      .references(() => artists.id, { onDelete: 'cascade' }),
    role: text('role').$type<ArtistRole>().notNull().default('artist'),
  },
  (t) => [primaryKey({ columns: [t.packId, t.artistId, t.role] }), index('pack_artists_artist_idx').on(t.artistId)],
)

export type TagDimension = 'group' | 'tool' | 'project' | 'origin' | 'custom'

export const tags = pgTable(
  'tags',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    dimension: text('dimension').$type<TagDimension>().notNull().default('custom'),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('tags_dimension_slug_key').on(t.dimension, t.slug), index('tags_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops'))],
)

export const packTags = pgTable(
  'pack_tags',
  {
    packId: integer('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.packId, t.tagId] }), index('pack_tags_tag_idx').on(t.tagId)],
)

export const collections = pgTable('collections', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  description: text('description'),
  coverEmojiId: text('cover_emoji_id'),
  sort: integer('sort').notNull().default(0),
  published: boolean('published').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const collectionPacks = pgTable(
  'collection_packs',
  {
    collectionId: integer('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    packId: integer('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.packId] })],
)
