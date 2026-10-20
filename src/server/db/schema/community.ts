import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core'
import { users } from './auth'
import { createdAt, tstz, updatedAt } from './_shared'

export const favoriteFolders = pgTable(
  'favorite_folders',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('favorite_folders_user_idx').on(t.userId)],
)

export type FavoriteTarget = 'pack' | 'emoji'

export const favorites = pgTable(
  'favorites',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    folderId: integer('folder_id').references(() => favoriteFolders.id, { onDelete: 'cascade' }),
    targetType: text('target_type').$type<FavoriteTarget>().notNull(),
    // pack id (as text) or emoji id
    targetId: text('target_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('favorites_user_target_key').on(t.userId, t.folderId, t.targetType, t.targetId),
    index('favorites_target_idx').on(t.targetType, t.targetId),
  ],
)

/** 打包清单, synced from the browser once the user signs in */
export const batchLists = pgTable('batch_lists', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  items: jsonb('items').$type<string[]>().notNull().default([]),
  updatedAt: updatedAt(),
})

export type CommentStatus = 'published' | 'pending' | 'spam' | 'deleted'
export type CommentThread = 'pack' | 'emoji'

export const comments = pgTable(
  'comments',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    threadType: text('thread_type').$type<CommentThread>().notNull(),
    threadId: text('thread_id').notNull(),
    parentId: bigint('parent_id', { mode: 'number' }),
    rootId: bigint('root_id', { mode: 'number' }),
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    guestName: text('guest_name'),
    guestEmailHash: text('guest_email_hash'),
    // source text with sticker markers like :s[r-…]; rendered on read
    bodySrc: text('body_src').notNull(),
    stickerIds: text('sticker_ids').array().notNull().default([]),
    status: text('status').$type<CommentStatus>().notNull().default('pending'),
    pinned: boolean('pinned').notNull().default(false),
    staffBadge: text('staff_badge'),
    editedAt: tstz('edited_at'),
    deletedAt: tstz('deleted_at'),
    ipHash: text('ip_hash'),
    createdAt: createdAt(),
  },
  (t) => [
    index('comments_thread_idx').on(t.threadType, t.threadId, t.createdAt),
    index('comments_status_idx').on(t.status, t.createdAt),
    index('comments_root_idx').on(t.rootId),
  ],
)

export const commentReactions = pgTable(
  'comment_reactions',
  {
    commentId: bigint('comment_id', { mode: 'number' })
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    // user id, or a salted hash for guests
    reactorKey: text('reactor_key').notNull(),
    reactionKey: text('reaction_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.reactorKey, t.reactionKey] })],
)

export const commentReports = pgTable(
  'comment_reports',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    commentId: bigint('comment_id', { mode: 'number' })
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    reporterKey: text('reporter_key').notNull(),
    reason: text('reason'),
    resolvedAt: tstz('resolved_at'),
    createdAt: createdAt(),
  },
  (t) => [unique('comment_reports_once_key').on(t.commentId, t.reporterKey)],
)

export const notifications = pgTable(
  'notifications',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    readAt: tstz('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
)
