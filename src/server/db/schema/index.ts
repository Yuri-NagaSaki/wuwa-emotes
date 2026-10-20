import { relations } from 'drizzle-orm'
import { accounts, sessions, users } from './auth'
import {
  artistAliases,
  artists,
  characterAliases,
  characters,
  collectionPacks,
  collections,
  emojiCharacters,
  emojis,
  packArtists,
  packCharacters,
  packs,
  packTags,
  tags,
} from './catalog'
import { submissions, uploadItems } from './submissions'

export * from './auth'
export * from './catalog'
export * from './community'
export * from './submissions'
export * from './downloads'
export * from './system'

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  packs: many(packs),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}))

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}))

export const packsRelations = relations(packs, ({ one, many }) => ({
  owner: one(users, { fields: [packs.ownerId], references: [users.id] }),
  emojis: many(emojis),
  characters: many(packCharacters),
  artists: many(packArtists),
  tags: many(packTags),
  submissions: many(submissions),
}))

export const emojisRelations = relations(emojis, ({ one, many }) => ({
  pack: one(packs, { fields: [emojis.packId], references: [packs.id] }),
  characters: many(emojiCharacters),
}))

export const charactersRelations = relations(characters, ({ many }) => ({
  aliases: many(characterAliases),
  packs: many(packCharacters),
}))

export const characterAliasesRelations = relations(characterAliases, ({ one }) => ({
  character: one(characters, { fields: [characterAliases.characterId], references: [characters.id] }),
}))

export const artistsRelations = relations(artists, ({ many }) => ({
  aliases: many(artistAliases),
  packs: many(packArtists),
}))

export const artistAliasesRelations = relations(artistAliases, ({ one }) => ({
  artist: one(artists, { fields: [artistAliases.artistId], references: [artists.id] }),
}))

export const packCharactersRelations = relations(packCharacters, ({ one }) => ({
  pack: one(packs, { fields: [packCharacters.packId], references: [packs.id] }),
  character: one(characters, { fields: [packCharacters.characterId], references: [characters.id] }),
}))

export const emojiCharactersRelations = relations(emojiCharacters, ({ one }) => ({
  emoji: one(emojis, { fields: [emojiCharacters.emojiId], references: [emojis.id] }),
  character: one(characters, { fields: [emojiCharacters.characterId], references: [characters.id] }),
}))

export const packArtistsRelations = relations(packArtists, ({ one }) => ({
  pack: one(packs, { fields: [packArtists.packId], references: [packs.id] }),
  artist: one(artists, { fields: [packArtists.artistId], references: [artists.id] }),
}))

export const tagsRelations = relations(tags, ({ many }) => ({
  packs: many(packTags),
}))

export const packTagsRelations = relations(packTags, ({ one }) => ({
  pack: one(packs, { fields: [packTags.packId], references: [packs.id] }),
  tag: one(tags, { fields: [packTags.tagId], references: [tags.id] }),
}))

export const collectionsRelations = relations(collections, ({ many }) => ({
  packs: many(collectionPacks),
}))

export const collectionPacksRelations = relations(collectionPacks, ({ one }) => ({
  collection: one(collections, { fields: [collectionPacks.collectionId], references: [collections.id] }),
  pack: one(packs, { fields: [collectionPacks.packId], references: [packs.id] }),
}))

export const submissionsRelations = relations(submissions, ({ one, many }) => ({
  pack: one(packs, { fields: [submissions.packId], references: [packs.id] }),
  submitter: one(users, { fields: [submissions.submitterId], references: [users.id] }),
  uploads: many(uploadItems),
}))

export const uploadItemsRelations = relations(uploadItems, ({ one }) => ({
  submission: one(submissions, { fields: [uploadItems.submissionId], references: [submissions.id] }),
}))
