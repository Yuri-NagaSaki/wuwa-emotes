import { and, eq, isNull, sql } from 'drizzle-orm'
import { capErrorMessage } from '../auth/cap'
import { audit } from '../audit'
import { rows } from '../catalog/sql'
import { db, schema } from '../db/client'
import type { CommentStatus } from '../db/schema/community'
import { hashValue } from '../http/client'
import { HONEYPOT_FIELD, HOT_THREAD_PER_HOUR, MAX_STICKERS, NEW_ACCOUNT_MS, RATE } from './constants'
import { ipHashOf, isStaff, n, reactionCounts, threadIsPublic, withDeps, type CommentDeps, type RequestCtx } from './common'
import { checkFormToken } from './form-token'
import { createInput, editInput, guestNameSchema, idInput, reactInput, reportInput, threadInput } from './inputs'
import { blocklistMatch, CommentError, holdReasons } from './moderation'
import { loadItem } from './read'
import { analyzeBody, type BodyAnalysis } from './render'
import { lookupStickers } from './stickers'
import type { CommentItem, CreateResult, HoldReason, ReactionCount } from './types'

// Writing comments. Order inside createComment matters: every check that can reject runs before the
// guest's Cap token is verified (tokens are single-use, so a rejection after verification would burn
// it), and the token is verified before anything is written. The rate counters come right after Cap.

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0]

const FORM_ERRORS = {
  invalid: '提交失败，请刷新页面后重试',
  too_fast: '写得太快了，请稍等几秒再发布',
  expired: '页面停留太久，请刷新后再发布',
} as const

/** Body checks shared by create and edit; returns the analysis. */
async function checkBody(body: string, stickersAllowed: boolean): Promise<BodyAnalysis> {
  if (!body) throw new CommentError(400, '写点什么，或者发一张贴纸')
  const a = analyzeBody(body)
  if (a.badMarkers.length) throw new CommentError(400, `贴纸标记格式不对：${a.badMarkers[0]}`)
  if (a.stickers.length > MAX_STICKERS) throw new CommentError(400, `每条评论最多 ${MAX_STICKERS} 张贴纸`)
  if (a.stickers.length && !stickersAllowed) throw new CommentError(400, '评论贴纸暂时关闭')
  if (a.stickerIds.length) {
    const found = await lookupStickers(a.stickerIds)
    if (a.stickerIds.some((id) => !found.has(id))) throw new CommentError(400, '有贴纸不存在或尚未发布')
  }
  return a
}

async function rateLimit(subjects: string[], bucket: string, perMinute: number, perDay: number | null, deps: CommentDeps) {
  for (const subject of subjects) {
    if ((await deps.hit(subject, `${bucket}:1m`, 60)) > perMinute) throw new CommentError(429, '操作太频繁，请一分钟后再试')
    if (perDay != null && (await deps.hit(subject, `${bucket}:1d`, 86_400)) > perDay) throw new CommentError(429, '今天的评论次数已用完，明天再来吧')
  }
}

function subjectsOf(ctx: RequestCtx): string[] {
  const out = [`ip:${ipHashOf(ctx)}`]
  if (ctx.viewer) out.push(`user:${ctx.viewer.id}`)
  return out
}

interface ParentRow {
  id: number
  root_id: number | null
  author_id: string | null
  thread_type: string
  thread_id: string
  status: CommentStatus
  deleted_at: Date | null
}

async function moderationFacts(
  ctx: RequestCtx,
  thread: { type: string; id: string },
  now: Date,
): Promise<{ firstComment: boolean; newAuthor: boolean; hotThread: boolean }> {
  const v = ctx.viewer
  const [prior, recent, account] = await Promise.all([
    v
      ? rows<{ n: number }>(sql`select count(*)::int as n from (select 1 from comments where author_id = ${v.id} and status = 'published' limit 1) x`)
      : rows<{ n: number }>(
          sql`select count(*)::int as n from (select 1 from comments where author_id is null and ip_hash = ${ipHashOf(ctx)} and status = 'published' limit 1) x`,
        ),
    rows<{ n: number }>(sql`
      select count(*)::int as n from comments
      where thread_type = ${thread.type} and thread_id = ${thread.id} and created_at > ${new Date(now.getTime() - 3600_000)}`),
    v ? rows<{ created_at: Date }>(sql`select created_at from users where id = ${v.id}`) : Promise.resolve([]),
  ])
  const createdAt = account[0]?.created_at ? new Date(account[0].created_at) : null
  return {
    firstComment: n(prior[0]?.n ?? 0) === 0,
    newAuthor: !v || !createdAt || now.getTime() - createdAt.getTime() < NEW_ACCOUNT_MS,
    hotThread: n(recent[0]?.n ?? 0) >= HOT_THREAD_PER_HOUR,
  }
}

/** Notify the parent's author about a published reply (not guests, not yourself). */
export async function notifyReply(
  tx: Tx | ReturnType<typeof db>,
  reply: { id: number; threadType: string; threadId: string; rootId: number | null; parentId: number | null; authorId: string | null; byName: string; text: string },
) {
  if (!reply.parentId) return
  const parent = await tx
    .select({ authorId: schema.comments.authorId })
    .from(schema.comments)
    .where(eq(schema.comments.id, reply.parentId))
    .limit(1)
  const to = parent[0]?.authorId
  if (!to || to === reply.authorId) return
  const already = await tx.execute(
    sql`select 1 from notifications where user_id = ${to} and kind = 'comment.reply' and payload->>'commentId' = ${String(reply.id)} limit 1`,
  )
  if (already.rows.length) return
  await tx.insert(schema.notifications).values({
    userId: to,
    kind: 'comment.reply',
    payload: {
      commentId: reply.id,
      parentId: reply.parentId,
      rootId: reply.rootId,
      threadType: reply.threadType,
      threadId: reply.threadId,
      by: reply.byName,
      excerpt: reply.text.slice(0, 80),
    },
  })
}

export async function createComment(ctx: RequestCtx, input: unknown, deps: CommentDeps = withDeps()): Promise<CreateResult> {
  const p = createInput.parse(input)
  const now = deps.now()
  const viewer = ctx.viewer

  // 1. traps: honeypot field and minimum fill time
  if (p[HONEYPOT_FIELD]?.trim()) throw new CommentError(400, FORM_ERRORS.invalid)
  const form = checkFormToken(p.formToken, now.getTime())
  if (!form.ok) throw new CommentError(400, FORM_ERRORS[form.reason])

  // 2. settings gates
  const s = await deps.settings()
  if (!viewer && !s.guestsAllowed) throw new CommentError(403, '请登录后再评论')
  if (viewer && s.bannedUserIds.includes(viewer.id)) throw new CommentError(403, '你已被禁止评论')
  if (!threadInput.safeParse(p).success) throw new CommentError(404, '评论区不存在')

  // 3. author fields (guests)
  let guestName: string | null = null
  let guestEmailHash: string | null = null
  if (!viewer) {
    const name = guestNameSchema.safeParse(p.guestName ?? '')
    if (!name.success) throw new CommentError(400, name.error.issues[0]?.message ?? '请填写昵称')
    guestName = name.data
    guestEmailHash = p.guestEmail ? hashValue(p.guestEmail.trim().toLowerCase()) : null
  }

  // 4. content and target (reads only)
  const body = p.body.trim()
  const a = await checkBody(body, s.stickersAllowed)
  if (!(await threadIsPublic(p.threadType, p.threadId))) throw new CommentError(404, '评论区不存在')
  let parent: ParentRow | null = null
  if (p.parentId) {
    const found = await rows<ParentRow>(
      sql`select id, root_id, author_id, thread_type, thread_id, status, deleted_at from comments where id = ${p.parentId}`,
    )
    parent = found[0] ?? null
    if (
      !parent ||
      parent.thread_type !== p.threadType ||
      parent.thread_id !== p.threadId ||
      parent.status !== 'published' ||
      parent.deleted_at != null
    ) {
      throw new CommentError(404, '要回复的评论不存在或已删除')
    }
  }

  // 5. moderation decision
  const staff = !!viewer && isStaff(viewer.role)
  let reasons: HoldReason[] = []
  if (!staff) {
    const facts = await moderationFacts(ctx, { type: p.threadType, id: p.threadId }, now)
    reasons = holdReasons(
      { ...facts, links: a.links, blocklistHit: blocklistMatch(s.blocklist, body, guestName) != null },
      { firstCommentReview: s.firstCommentReview },
    )
  }
  const status: 'published' | 'pending' = reasons.length ? 'pending' : 'published'

  // 6. Cap: guests only, verified exactly once, before any write
  if (!viewer) {
    const cap = await deps.verifyCap(ctx.capToken ?? null)
    if (!cap.ok) throw new CommentError(cap.reason === 'unavailable' ? 503 : 400, capErrorMessage(cap.reason))
  }

  // 7. rate limits (per IP hash and per account)
  await rateLimit(subjectsOf(ctx), 'cm', RATE.perMinute, RATE.perDay, deps)

  // 8. write
  const rootId = parent ? n(parent.root_id ?? parent.id) : null
  const parentId = parent ? n(parent.id) : null
  const id = await db().transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.comments)
      .values({
        threadType: p.threadType,
        threadId: p.threadId,
        parentId,
        rootId,
        authorId: viewer?.id ?? null,
        guestName,
        guestEmailHash,
        bodySrc: body,
        stickerIds: a.stickerIds,
        status,
        staffBadge: staff ? viewer!.role : null,
        ipHash: ipHashOf(ctx),
        createdAt: now,
      })
      .returning({ id: schema.comments.id })
    const newId = n(row!.id)
    if (status === 'published') {
      await notifyReply(tx, {
        id: newId,
        threadType: p.threadType,
        threadId: p.threadId,
        rootId,
        parentId,
        authorId: viewer?.id ?? null,
        byName: viewer?.name ?? guestName ?? '',
        text: a.text,
      })
    }
    return newId
  })

  // a guest cannot see their own pending comment in the thread later; this response shows it once
  const comment = await loadItem(id, viewer?.id ?? null, deps, true)
  return { comment, status }
}

export async function editComment(ctx: RequestCtx, input: unknown, deps: CommentDeps = withDeps()): Promise<CreateResult> {
  const viewer = ctx.viewer
  if (!viewer) throw new CommentError(401, '请先登录')
  const p = editInput.parse(input)
  const now = deps.now()
  const s = await deps.settings()
  if (s.bannedUserIds.includes(viewer.id)) throw new CommentError(403, '你已被禁止评论')
  const [row] = await db().select().from(schema.comments).where(eq(schema.comments.id, p.id)).limit(1)
  if (!row || row.authorId !== viewer.id) throw new CommentError(404, '只能编辑自己的评论')
  if (row.deletedAt || row.status === 'deleted' || row.status === 'spam') throw new CommentError(409, '这条评论已经不能编辑了')
  if (row.createdAt.getTime() + s.editWindowMinutes * 60_000 <= now.getTime()) {
    throw new CommentError(403, `评论发布 ${s.editWindowMinutes} 分钟后不能再编辑`)
  }
  const body = p.body.trim()
  const a = await checkBody(body, s.stickersAllowed)
  await rateLimit([`user:${viewer.id}`], 'cm-edit', RATE.perMinute * 2, null, deps)

  let status = row.status
  if (!isStaff(viewer.role) && status === 'published') {
    const reasons = holdReasons(
      { links: a.links, blocklistHit: blocklistMatch(s.blocklist, body) != null, firstComment: false, newAuthor: false, hotThread: false },
      { firstCommentReview: false },
    )
    if (reasons.length) status = 'pending'
  }
  await db().transaction(async (tx) => {
    await tx
      .update(schema.comments)
      .set({ bodySrc: body, stickerIds: a.stickerIds, editedAt: now, status })
      .where(eq(schema.comments.id, row.id))
    await audit(
      viewer,
      'comment.edit',
      { type: 'comment', id: row.id },
      { body: [row.bodySrc, body], ...(status !== row.status ? { status: [row.status, status] } : {}) },
      tx,
    )
  })
  return { comment: await loadItem(row.id, viewer.id, deps), status: status === 'published' ? 'published' : 'pending' }
}

/** Author deletes their own comment: a tombstone (deleted_at); replies stay. Not restorable by moderators. */
export async function deleteOwnComment(ctx: RequestCtx, input: unknown, deps: CommentDeps = withDeps()): Promise<CommentItem> {
  const viewer = ctx.viewer
  if (!viewer) throw new CommentError(401, '请先登录')
  const { id } = idInput.parse(input)
  const [row] = await db().select().from(schema.comments).where(eq(schema.comments.id, id)).limit(1)
  if (!row || row.authorId !== viewer.id) throw new CommentError(404, '只能删除自己的评论')
  if (!row.deletedAt) {
    await db().transaction(async (tx) => {
      await tx.update(schema.comments).set({ deletedAt: deps.now() }).where(eq(schema.comments.id, id))
      await audit(viewer, 'comment.delete_own', { type: 'comment', id }, { status: row.status }, tx)
    })
  }
  return loadItem(id, viewer.id, deps)
}

async function visibleComment(id: number) {
  const [row] = await db()
    .select({ id: schema.comments.id, authorId: schema.comments.authorId, status: schema.comments.status })
    .from(schema.comments)
    .where(and(eq(schema.comments.id, id), eq(schema.comments.status, 'published'), isNull(schema.comments.deletedAt)))
    .limit(1)
  if (!row) throw new CommentError(404, '评论不存在或已删除')
  return row
}

/** Toggle one reaction; returns the comment's reaction counts. */
export async function toggleReaction(ctx: RequestCtx, input: unknown, deps: CommentDeps = withDeps()): Promise<ReactionCount[]> {
  const viewer = ctx.viewer
  if (!viewer) throw new CommentError(401, '登录后才能回应')
  const { id, key } = reactInput.parse(input)
  await visibleComment(id)
  if ((await deps.hit(`user:${viewer.id}`, 'cm-react:1m', 60)) > RATE.reactionsPerMinute) throw new CommentError(429, '操作太频繁，请稍后再试')
  const r = schema.commentReactions
  const removed = await db()
    .delete(r)
    .where(and(eq(r.commentId, id), eq(r.reactorKey, viewer.id), eq(r.reactionKey, key)))
    .returning({ k: r.reactionKey })
  if (!removed.length) await db().insert(r).values({ commentId: id, reactorKey: viewer.id, reactionKey: key }).onConflictDoNothing()
  return (await reactionCounts([id], viewer.id)).get(id) ?? []
}

export interface ReportResult {
  /** This account had already reported the comment. */
  already: boolean
  /** The report moved the comment back to the review queue. */
  hidden: boolean
}

/** Report once per account; at reportThreshold open reports a published comment goes back to pending. */
export async function reportComment(ctx: RequestCtx, input: unknown, deps: CommentDeps = withDeps()): Promise<ReportResult> {
  const viewer = ctx.viewer
  if (!viewer) throw new CommentError(401, '登录后才能举报')
  const { id, reason } = reportInput.parse(input)
  const target = await visibleComment(id)
  if (target.authorId === viewer.id) throw new CommentError(400, '不能举报自己的评论')
  if ((await deps.hit(`user:${viewer.id}`, 'cm-report:1h', 3600)) > RATE.reportsPerHour) throw new CommentError(429, '举报太频繁，请稍后再试')
  const s = await deps.settings()
  return db().transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.commentReports)
      .values({ commentId: id, reporterKey: viewer.id, reason: reason || null })
      .onConflictDoNothing()
      .returning({ id: schema.commentReports.id })
    if (!inserted.length) return { already: true, hidden: false }
    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.commentReports)
      .where(and(eq(schema.commentReports.commentId, id), isNull(schema.commentReports.resolvedAt)))
    const count = n(open?.n ?? 0)
    if (count < s.reportThreshold) return { already: false, hidden: false }
    const moved = await tx
      .update(schema.comments)
      .set({ status: 'pending' })
      .where(and(eq(schema.comments.id, id), eq(schema.comments.status, 'published')))
      .returning({ id: schema.comments.id })
    if (moved.length) await audit(null, 'comment.autohide', { type: 'comment', id }, { status: ['published', 'pending'], openReports: count }, tx)
    return { already: false, hidden: moved.length > 0 }
  })
}
