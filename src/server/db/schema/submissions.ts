import { index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { users } from './auth'
import { packs } from './catalog'
import { createdAt, tstz, updatedAt } from './_shared'

export type SubmissionKind = 'new_pack' | 'add_emojis' | 'edit_pack'
export type SubmissionStatus = 'draft' | 'pending' | 'approved' | 'returned' | 'withdrawn'

/** Proposed change carried by a submission; applied in one transaction on approval. */
export interface SubmissionPayload {
  title?: string
  excerpt?: string | null
  descriptionMd?: string | null
  characterIds?: number[]
  artistIds?: number[]
  commissioner?: string | null
  addEmojiIds?: string[]
  removeEmojiIds?: string[]
  coverEmojiId?: string | null
  kind?: 'animated' | 'static' | 'mixed'
  /** Artists typed by the submitter that are not in the catalog yet; matched by name or alias, or created, on approval. */
  artistNames?: string[]
  /** new_pack only: 官方表情（官转）. Such packs are never downloadable. */
  official?: boolean
}

export interface SubmissionDeclaration {
  identity: 'artist' | 'commissioner' | 'granted' | 'curator'
  license: string
  proofUrl?: string | null
  note?: string | null
  downloadable: boolean
}

export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').$type<SubmissionKind>().notNull(),
    packId: integer('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    submitterId: text('submitter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').$type<SubmissionStatus>().notNull().default('draft'),
    payload: jsonb('payload').$type<SubmissionPayload>().notNull().default({}),
    declaration: jsonb('declaration').$type<SubmissionDeclaration | null>(),
    // edit_pack: packs.updated_at when the submission was created; approval fails if it moved
    baseUpdatedAt: tstz('base_updated_at'),
    reviewerId: text('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    reviewNote: text('review_note'),
    submittedAt: tstz('submitted_at'),
    decidedAt: tstz('decided_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('submissions_status_idx').on(t.status, t.submittedAt),
    index('submissions_submitter_idx').on(t.submitterId, t.createdAt),
    index('submissions_pack_idx').on(t.packId),
  ],
)

export type UploadStatus = 'signed' | 'uploaded' | 'processing' | 'done' | 'duplicate' | 'failed'

export const uploadItems = pgTable(
  'upload_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id').references(() => submissions.id, { onDelete: 'cascade' }),
    packId: integer('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    uploaderId: text('uploader_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tmpKey: text('tmp_key').notNull().unique(),
    filename: text('filename').notNull(),
    bytes: integer('bytes').notNull(),
    mime: text('mime').notNull(),
    status: text('status').$type<UploadStatus>().notNull().default('signed'),
    error: text('error'),
    emojiId: text('emoji_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('upload_items_submission_idx').on(t.submissionId), index('upload_items_status_idx').on(t.status, t.createdAt)],
)
