// Comment DTOs: the contract between src/server/comments and the UI. Type-only (client code imports it).
// Plain JSON: timestamps are ISO strings, absent values are null. Comment bodies only ever travel as
// HTML rendered by src/server/comments/render.ts; body_src goes back to its author while the comment
// can still be edited (to prefill the editor) and to moderators in the queue.

import type { CommentStatus, CommentThread } from '../db/schema/community'
import type { Badge, HoldReason, ReactionKey } from './constants'

export type { Badge, CommentStatus, CommentThread, HoldReason, ReactionKey }
export type IsoDate = string
export type CommentSort = 'hot' | 'new' | 'old'

/** A sticker as the picker and the renderer see it: the p240 poster and its pixel size. */
export interface Sticker {
  id: string
  /** /img/v1/p240/<packKey>/<id>.r<rev>.webp */
  poster: string
  width: number
  height: number
}

export interface CommentAuthor {
  name: string
  guest: boolean
  /** Deterministic avatar color (a --c-* palette name). */
  color: string
  /** 64 px 头像 (/img/v1/avatar/…-64.webp); null for guests, deleted accounts and users without one. */
  avatarUrl: string | null
}

export interface ReactionCount {
  key: ReactionKey
  n: number
  /** The viewer reacted with this key. */
  mine: boolean
}

/**
 * - visible: published, body shown
 * - pending: the viewer's own comment waiting for review (only the author sees it)
 * - deleted: tombstone 「该评论已删除」 (kept because it has replies)
 * - hidden: tombstone 「该评论已隐藏」 (held or marked spam after others replied)
 */
export type CommentState = 'visible' | 'pending' | 'deleted' | 'hidden'

export interface CommentItem {
  id: number
  threadType: CommentThread
  threadId: string
  /** null for a root (楼) */
  rootId: number | null
  parentId: number | null
  /** Author name of the parent when this replies to a reply (rendered as 「回复 @name」). */
  replyTo: string | null
  /** null on tombstones */
  author: CommentAuthor | null
  badge: Badge | null
  pinned: boolean
  state: CommentState
  /** Rendered body; null on tombstones. */
  html: string | null
  createdAt: IsoDate
  editedAt: IsoDate | null
  reactions: ReactionCount[]
  /** The viewer wrote it (signed-in authors only; guests cannot edit or delete). */
  mine: boolean
  /** Editable until this time (the viewer's own comment inside the edit window), else null. */
  editableUntil: IsoDate | null
  /** body_src, only with editableUntil. */
  bodySrc: string | null
}

export interface ThreadRoot extends CommentItem {
  /** First replies (oldest first), at most REPLY_PREVIEW. */
  replies: CommentItem[]
  /** Visible replies in total. */
  replyCount: number
  /** Cursor for listReplies after the preview; null when all are shown. */
  repliesCursor: string | null
}

export interface ThreadViewer {
  id: string
  name: string
  /** May pin, badge and moderate (站长、管理员). */
  staff: boolean
  /** On the 禁止评论 list. */
  banned: boolean
}

export interface ThreadConfig {
  guestsAllowed: boolean
  stickersAllowed: boolean
  editWindowMinutes: number
  maxStickers: number
  maxBody: number
  /** Optional sticker per reaction key (回应贴纸), else null (text label). */
  reactionStickers: Record<ReactionKey, Sticker | null>
}

export interface ThreadPage {
  threadType: CommentThread
  threadId: string
  sort: CommentSort
  /** Visible comments in the thread (roots + replies). */
  total: number
  items: ThreadRoot[]
  nextCursor: string | null
  viewer: ThreadViewer | null
  config: ThreadConfig
  /** Signed timestamp for the composer (min fill time). */
  formToken: string
}

export interface RepliesPage {
  items: CommentItem[]
  nextCursor: string | null
}

export interface CreateResult {
  comment: CommentItem
  /** published = shown now; pending = waiting for review */
  status: 'published' | 'pending'
}

export interface PreviewResult {
  html: string
  stickers: number
  links: number
  /** Problems the server would reject on submit (bad sticker ids, too many stickers, …). */
  problems: string[]
}

/** 「我的评论」 row. */
export interface MyComment {
  id: number
  status: CommentStatus
  /** Deleted by the author or a moderator. */
  deleted: boolean
  html: string | null
  createdAt: IsoDate
  editedAt: IsoDate | null
  thread: ThreadRef
  replyCount: number
}

export interface MyCommentsPage {
  items: MyComment[]
  nextCursor: string | null
  /** All of the viewer's comments, by status (deleted ones counted separately). */
  counts: { published: number; pending: number; spam: number; deleted: number }
}

/** Where a thread lives, for links in 我的评论 and the moderation queue. */
export interface ThreadRef {
  type: CommentThread
  id: string
  title: string
  /** /packs/<slug> or /e/<emojiId>; null when the pack is no longer public. */
  href: string | null
}

// ---- moderation ----

export type QueueTab = 'pending' | 'reported' | 'spam' | 'published' | 'deleted'

export interface QueueItem {
  id: number
  status: CommentStatus
  /** deleted_at set by the author (not restorable) */
  authorDeleted: boolean
  deletedAt: IsoDate | null
  thread: ThreadRef
  rootId: number | null
  author: CommentAuthor & { userId: string | null; role: string | null; banned: boolean }
  badge: Badge | null
  pinned: boolean
  html: string
  bodySrc: string
  createdAt: IsoDate
  editedAt: IsoDate | null
  /** Recomputed when read: why this comment would be (or was) held. */
  reasons: HoldReason[]
  reports: { open: number; total: number; reasons: string[] }
  /** First 4 + last 2 hex of the IP hash, e.g. 7c1e…09; null when not recorded. */
  ipHash: string | null
  /** Published comments from the same IP hash before this one. */
  ipHistory: number
}

export interface QueuePage {
  tab: QueueTab
  items: QueueItem[]
  nextCursor: string | null
  counts: Record<QueueTab, number>
}

export type ModerateAction = 'approve' | 'spam' | 'delete' | 'restore'

export interface ModerateResult {
  done: number[]
  /** Comments the action does not apply to (e.g. restoring an author-deleted comment). */
  skipped: number[]
}

export interface BannedCommenter {
  id: string
  name: string
}
