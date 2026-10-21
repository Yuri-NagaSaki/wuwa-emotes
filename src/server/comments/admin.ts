import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { EMOJI_ID_RE } from '#/shared/ids'
import { audit } from '../audit'
import { keysetAfter, keyTextSql, keyValues, orderBySql, rows } from '../catalog/sql'
import { db, schema } from '../db/client'
import type { CommentStatus } from '../db/schema/community'
import { setSetting, settingSchemas } from '../settings'
import { HOT_THREAD_PER_HOUR, NEW_ACCOUNT_MS, QUEUE_PER_PAGE, REACTION_KEYS, type HoldReason } from './constants'
import {
  authorAvatar,
  authorName,
  badgeOf,
  decode,
  DESC_COLS,
  encodeCursor,
  finalizeItems,
  isoOf,
  isoOrNull,
  isStaff,
  n,
  nOrNull,
  REPLY_COLS,
  threadRefs,
  withDeps,
  type Actor,
  type CommentDeps,
  type CommentSettings,
} from './common'
import { badgeInput, banInput, moderateInput, pinInput, queueInput } from './inputs'
import { avatarColor, blocklistMatch, CommentError } from './moderation'
import { analyzeBody, renderCached } from './render'
import { lookupStickers } from './stickers'
import { notifyReply } from './write'
import type { BannedCommenter, ModerateAction, ModerateResult, QueueItem, QueuePage, QueueTab, Sticker } from './types'

// 评论审核 (requirePerm('comments'): 站长 and 管理员). The server functions check the permission in
// middleware; these functions check it again so a direct caller cannot skip it. Every change writes an
// audit_logs row (one per comment for bulk actions).
//
// Status model (comments.status is published | pending | spam | deleted):
//   approve  pending / spam / published-with-reports → published; open reports resolved
//   spam     anything not deleted → spam; open reports resolved
//   delete   → status deleted + deleted_at (tombstone while it has replies); open reports resolved
//   restore  status deleted → published, deleted_at cleared
// A comment the author deleted (deleted_at set, status unchanged) is listed under 已删除 but cannot be
// deleted again or restored: the author's choice stands.

function assertStaff(actor: Actor | null): asserts actor is Actor {
  if (!actor) throw new CommentError(401, '请先登录')
  if (!isStaff(actor.role)) throw new CommentError(403, '没有权限执行这个操作')
}

const TAB_WHERE: Record<QueueTab, SQL> = {
  pending: sql.raw(`c.status = 'pending' and c.deleted_at is null`),
  reported: sql.raw(
    `c.status <> 'deleted' and c.deleted_at is null and exists (select 1 from comment_reports cr where cr.comment_id = c.id and cr.resolved_at is null)`,
  ),
  spam: sql.raw(`c.status = 'spam' and c.deleted_at is null`),
  published: sql.raw(`c.status = 'published' and c.deleted_at is null`),
  deleted: sql.raw(`(c.status = 'deleted' or c.deleted_at is not null)`),
}

export async function queueCounts(): Promise<Record<QueueTab, number>> {
  const [r] = await rows<Record<QueueTab, number>>(sql`
    select
      count(*) filter (where ${TAB_WHERE.pending})::int as pending,
      count(*) filter (where ${TAB_WHERE.reported})::int as reported,
      count(*) filter (where ${TAB_WHERE.spam})::int as spam,
      count(*) filter (where ${TAB_WHERE.published})::int as published,
      count(*) filter (where ${TAB_WHERE.deleted})::int as deleted
    from comments c`)
  return { pending: n(r?.pending ?? 0), reported: n(r?.reported ?? 0), spam: n(r?.spam ?? 0), published: n(r?.published ?? 0), deleted: n(r?.deleted ?? 0) }
}

interface QueueRow {
  id: string | number
  thread_type: 'pack' | 'emoji'
  thread_id: string
  root_id: string | number | null
  author_id: string | null
  guest_name: string | null
  author_name: string | null
  author_image: string | null
  author_role: string | null
  body_src: string
  status: CommentStatus
  pinned: boolean
  staff_badge: string | null
  edited_at: Date | null
  deleted_at: Date | null
  created_at: Date
  ip_hash: string | null
  first_comment: boolean
  new_author: boolean
  hot_thread: boolean
  open_reports: number
  total_reports: number
  report_reasons: string[] | null
  ip_history: number
}

function shortHash(h: string | null): string | null {
  return h && h.length >= 8 ? `${h.slice(0, 4)}…${h.slice(-2)}` : null
}

export async function commentQueue(actor: Actor | null, input: unknown, deps: CommentDeps = withDeps()): Promise<QueuePage> {
  assertStaff(actor)
  const { tab, cursor } = queueInput.parse(input ?? {})
  const s = await deps.settings()
  // the queue works oldest first; the archives newest first
  const cols = tab === 'pending' || tab === 'reported' ? REPLY_COLS : DESC_COLS
  const scope = `cm:q:${tab}`
  let where = TAB_WHERE[tab]
  if (cursor) where = sql`${where} and ${keysetAfter(cols, decode(cursor, scope, cols).keys)}`
  const found = await rows<QueueRow & Record<string, string>>(sql`
    select c.id, c.thread_type, c.thread_id, c.root_id, c.author_id, c.guest_name, u.name as author_name, u.image as author_image, u.role as author_role,
      c.body_src, c.status, c.pinned, c.staff_badge, c.edited_at, c.deleted_at, c.created_at, c.ip_hash,
      ${keyTextSql(cols)},
      not exists (
        select 1 from comments o
        where o.id <> c.id and o.created_at < c.created_at and o.status = 'published'
          and ((c.author_id is not null and o.author_id = c.author_id)
            or (c.author_id is null and o.author_id is null and o.ip_hash = c.ip_hash))
      ) as first_comment,
      (c.author_id is null or u.created_at is null or u.created_at > c.created_at - make_interval(secs => ${NEW_ACCOUNT_MS / 1000})) as new_author,
      ((select count(*) from comments h
        where h.thread_type = c.thread_type and h.thread_id = c.thread_id
          and h.created_at > c.created_at - interval '1 hour' and h.created_at < c.created_at) >= ${HOT_THREAD_PER_HOUR}) as hot_thread,
      (select count(*) from comment_reports cr where cr.comment_id = c.id and cr.resolved_at is null)::int as open_reports,
      (select count(*) from comment_reports cr where cr.comment_id = c.id)::int as total_reports,
      (select array_agg(distinct cr.reason) from comment_reports cr where cr.comment_id = c.id and cr.reason is not null) as report_reasons,
      (select count(*) from comments o where o.ip_hash = c.ip_hash and o.id <> c.id and o.status = 'published' and o.created_at < c.created_at)::int as ip_history
    from comments c left join users u on u.id = c.author_id
    where ${where}
    order by ${orderBySql(cols)}
    limit ${QUEUE_PER_PAGE + 1}`)
  const page = found.slice(0, QUEUE_PER_PAGE)
  const refs = await threadRefs(page.map((r) => ({ type: r.thread_type, id: r.thread_id })))
  const banned = new Set(s.bannedUserIds)
  const items: QueueItem[] = page.map((r) => {
    const id = n(r.id)
    const a = analyzeBody(r.body_src)
    const staffAuthor = isStaff(r.author_role)
    const reasons: HoldReason[] = []
    if (!staffAuthor) {
      if (s.firstCommentReview && r.first_comment) reasons.push('first')
      if (a.links >= 2) reasons.push('links')
      if (blocklistMatch(s.blocklist, r.body_src, r.guest_name)) reasons.push('blocklist')
      if (r.new_author && r.hot_thread) reasons.push('hot')
    }
    if (n(r.open_reports) > 0) reasons.push('reported')
    const name = authorName(r)
    return {
      id,
      status: r.status,
      authorDeleted: r.deleted_at != null && r.status !== 'deleted',
      deletedAt: isoOrNull(r.deleted_at),
      thread: refs.get(`${r.thread_type}:${r.thread_id}`)!,
      rootId: nOrNull(r.root_id),
      author: {
        name,
        guest: !r.author_id && !!r.guest_name,
        color: avatarColor(name),
        avatarUrl: authorAvatar(r),
        userId: r.author_id,
        role: r.author_role,
        banned: !!r.author_id && banned.has(r.author_id),
      },
      badge: badgeOf(r.staff_badge),
      pinned: r.pinned,
      html: renderCached(id, r.edited_at, r.body_src),
      bodySrc: r.body_src,
      createdAt: isoOf(r.created_at),
      editedAt: isoOrNull(r.edited_at),
      reasons,
      reports: { open: n(r.open_reports), total: n(r.total_reports), reasons: (r.report_reasons ?? []).slice(0, 5) },
      ipHash: shortHash(r.ip_hash),
      ipHistory: n(r.ip_history),
    }
  })
  await finalizeItems(items)
  const last = page[page.length - 1]
  return {
    tab,
    items,
    nextCursor: found.length > QUEUE_PER_PAGE && last ? encodeCursor({ scope, keys: keyValues(last, cols.length) }) : null,
    counts: await queueCounts(),
  }
}

// ---- actions ----

function nextStatus(action: ModerateAction, row: { status: CommentStatus; deletedAt: Date | null }, openReports: number): CommentStatus | null {
  const authorDeleted = row.deletedAt != null && row.status !== 'deleted'
  switch (action) {
    case 'approve':
      if (row.deletedAt != null || row.status === 'deleted') return null
      if (row.status === 'published' && openReports === 0) return null
      return 'published'
    case 'spam':
      if (row.deletedAt != null || row.status === 'deleted' || (row.status === 'spam' && openReports === 0)) return null
      return 'spam'
    case 'delete':
      if (authorDeleted || row.status === 'deleted') return null
      return 'deleted'
    case 'restore':
      return row.status === 'deleted' ? 'published' : null
  }
}

export async function moderateComments(actor: Actor | null, input: unknown, deps: CommentDeps = withDeps()): Promise<ModerateResult> {
  assertStaff(actor)
  const { ids, action } = moderateInput.parse(input)
  const unique = [...new Set(ids)]
  const now = deps.now()
  return db().transaction(async (tx) => {
    const c = schema.comments
    const found = await tx.select().from(c).where(inArray(c.id, unique)).for('update')
    const reports = await tx
      .select({ id: schema.commentReports.commentId, n: sql<number>`count(*)::int` })
      .from(schema.commentReports)
      .where(and(inArray(schema.commentReports.commentId, unique), isNull(schema.commentReports.resolvedAt)))
      .groupBy(schema.commentReports.commentId)
    const open = new Map(reports.map((r) => [n(r.id), n(r.n)]))
    const done: number[] = []
    const skipped: number[] = unique.filter((id) => !found.some((r) => r.id === id))
    for (const row of found) {
      const openReports = open.get(row.id) ?? 0
      const status = nextStatus(action, row, openReports)
      if (!status) {
        skipped.push(row.id)
        continue
      }
      const set: Partial<typeof c.$inferInsert> = { status }
      if (action === 'delete') set.deletedAt = row.deletedAt ?? now
      if (action === 'restore') set.deletedAt = null
      await tx.update(c).set(set).where(eq(c.id, row.id))
      let resolved = 0
      if (action !== 'restore' && openReports > 0) {
        const r = await tx
          .update(schema.commentReports)
          .set({ resolvedAt: now })
          .where(and(eq(schema.commentReports.commentId, row.id), isNull(schema.commentReports.resolvedAt)))
          .returning({ id: schema.commentReports.id })
        resolved = r.length
      }
      if (status === 'published' && row.status !== 'published') {
        const text = analyzeBody(row.bodySrc).text
        const [author] = row.authorId ? await tx.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, row.authorId)) : []
        await notifyReply(tx, {
          id: row.id,
          threadType: row.threadType,
          threadId: row.threadId,
          rootId: row.rootId,
          parentId: row.parentId,
          authorId: row.authorId,
          byName: author?.name ?? row.guestName ?? '',
          text,
        })
      }
      await audit(
        actor,
        `comment.${action}`,
        { type: 'comment', id: row.id },
        { status: [row.status, status], ...(resolved ? { reportsResolved: resolved } : {}), ...(unique.length > 1 ? { bulk: unique.length } : {}) },
        tx,
      )
      done.push(row.id)
    }
    return { done, skipped }
  })
}

export async function setPinned(actor: Actor | null, input: unknown): Promise<{ id: number; pinned: boolean }> {
  assertStaff(actor)
  const { id, pinned } = pinInput.parse(input)
  const c = schema.comments
  const [row] = await db().select().from(c).where(eq(c.id, id)).limit(1)
  if (!row) throw new CommentError(404, '评论不存在')
  if (row.parentId != null) throw new CommentError(400, '只能置顶楼层，不能置顶回复')
  if (pinned && (row.status !== 'published' || row.deletedAt)) throw new CommentError(409, '只能置顶已公开的评论')
  if (row.pinned !== pinned) {
    await db().transaction(async (tx) => {
      await tx.update(c).set({ pinned }).where(eq(c.id, id))
      await audit(actor, pinned ? 'comment.pin' : 'comment.unpin', { type: 'comment', id }, { pinned: [row.pinned, pinned] }, tx)
    })
  }
  return { id, pinned }
}

export async function setBadge(actor: Actor | null, input: unknown): Promise<{ id: number; badge: string | null }> {
  assertStaff(actor)
  const { id, badge } = badgeInput.parse(input)
  if (badge === 'admin' && actor.role !== 'admin') throw new CommentError(403, '只有站长可以使用站长徽章')
  const c = schema.comments
  const [row] = await db().select().from(c).where(eq(c.id, id)).limit(1)
  if (!row) throw new CommentError(404, '评论不存在')
  if (row.staffBadge !== badge) {
    await db().transaction(async (tx) => {
      await tx.update(c).set({ staffBadge: badge }).where(eq(c.id, id))
      await audit(actor, 'comment.badge', { type: 'comment', id }, { badge: [row.staffBadge, badge] }, tx)
    })
  }
  return { id, badge }
}

// ---- 审核规则 (settings) ----

/** Partial update of the comments settings; bannedUserIds changes go through banCommenter. */
export const commentSettingsPatch = z
  .object({
    guestsAllowed: z.boolean().optional(),
    stickersAllowed: z.boolean().optional(),
    firstCommentReview: z.boolean().optional(),
    editWindowMinutes: z.number().int().min(0).max(1440).optional(),
    blocklist: z.array(z.string().trim().min(1).max(40)).max(500).optional(),
    reportThreshold: z.number().int().min(1).max(100).optional(),
    reactionStickers: z
      .object(Object.fromEntries(REACTION_KEYS.map((k) => [k, z.string().regex(EMOJI_ID_RE).nullable().optional()])))
      .strict()
      .optional(),
  })
  .strict()
export type CommentSettingsPatch = z.input<typeof commentSettingsPatch>

export interface CommentSettingsView {
  settings: Omit<CommentSettings, 'bannedUserIds'>
  reactionStickers: Record<string, Sticker | null>
  banned: BannedCommenter[]
}

export async function readCommentSettings(actor: Actor | null, deps: CommentDeps = withDeps()): Promise<CommentSettingsView> {
  assertStaff(actor)
  const s = await deps.settings()
  const ids = Object.values(s.reactionStickers).filter((v): v is string => !!v)
  const found = await lookupStickers(ids)
  const banned = s.bannedUserIds.length
    ? await db().select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, s.bannedUserIds))
    : []
  const { bannedUserIds: _omit, ...rest } = s
  return {
    settings: rest,
    reactionStickers: Object.fromEntries(REACTION_KEYS.map((k) => [k, (s.reactionStickers[k] && found.get(s.reactionStickers[k]!)) || null])),
    banned: s.bannedUserIds.map((id) => ({ id, name: banned.find((b) => b.id === id)?.name ?? '已注销用户' })),
  }
}

export async function saveCommentSettings(actor: Actor | null, input: unknown, deps: CommentDeps = withDeps()): Promise<CommentSettingsView> {
  assertStaff(actor)
  const patch = commentSettingsPatch.parse(input)
  const before = await deps.settings()
  if (patch.reactionStickers) {
    const ids = Object.values(patch.reactionStickers).filter((v): v is string => !!v)
    const found = await lookupStickers(ids)
    const missing = ids.filter((id) => !found.has(id))
    if (missing.length) throw new CommentError(400, `回应贴纸不存在或尚未发布：${missing[0]}`)
  }
  const blocklist = patch.blocklist ? [...new Set(patch.blocklist.map((w) => w.trim()).filter(Boolean))] : undefined
  const merged = {
    ...before,
    ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    ...(blocklist ? { blocklist } : {}),
    reactionStickers: { ...before.reactionStickers, ...(patch.reactionStickers ?? {}) },
  }
  const after = settingSchemas.comments.parse(merged)
  const diff: Record<string, [unknown, unknown]> = {}
  for (const k of Object.keys(after) as (keyof CommentSettings)[]) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) diff[k] = [before[k], after[k]]
  }
  if (Object.keys(diff).length) {
    await setSetting('comments', after, actor.id)
    await audit(actor, 'settings.comments.update', { type: 'setting', id: 'comments' }, diff)
  }
  return readCommentSettings(actor, { ...deps, settings: async () => after })
}

/** 禁止评论: a comment-only ban kept in the comments settings. */
export async function banCommenter(actor: Actor | null, input: unknown, deps: CommentDeps = withDeps()): Promise<{ userId: string; banned: boolean }> {
  assertStaff(actor)
  const { userId, banned } = banInput.parse(input)
  const [target] = await db().select({ id: schema.users.id, role: schema.users.role }).from(schema.users).where(eq(schema.users.id, userId)).limit(1)
  if (!target) throw new CommentError(404, '用户不存在')
  if (banned) {
    if (target.id === actor.id) throw new CommentError(400, '不能禁止自己评论')
    if (target.role === 'admin') throw new CommentError(403, '不能禁止站长评论')
    if (target.role === 'manager' && actor.role !== 'admin') throw new CommentError(403, '只有站长可以禁止管理员评论')
  }
  const before = await deps.settings()
  const has = before.bannedUserIds.includes(userId)
  if (has === banned) return { userId, banned }
  const after = settingSchemas.comments.parse({
    ...before,
    bannedUserIds: banned ? [...before.bannedUserIds, userId] : before.bannedUserIds.filter((id) => id !== userId),
  })
  await setSetting('comments', after, actor.id)
  await audit(actor, banned ? 'comment.ban_user' : 'comment.unban_user', { type: 'user', id: userId }, { bannedFromComments: [has, banned] })
  return { userId, banned }
}
