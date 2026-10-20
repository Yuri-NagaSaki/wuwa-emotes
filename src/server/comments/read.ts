import { sql, type SQL } from 'drizzle-orm'
import { rows } from '../catalog/sql'
import { keysetAfter, keyTextSql, keyValues, orderBySql } from '../catalog/sql'
import { MAX_BODY, MAX_STICKERS, RATE, REACTION_KEYS, REPLIES_PER_PAGE, REPLY_PREVIEW, ROOTS_PER_PAGE, type ReactionKey } from './constants'
import {
  COMMENT_COLS,
  COMMENT_JOINS,
  decode,
  DESC_COLS,
  encodeCursor,
  finalizeItems,
  ipHashOf,
  isoOf,
  isoOrNull,
  isStaff,
  n,
  NEW_COLS,
  OFFSET_COLS,
  OLD_COLS,
  reactionCounts,
  REPLY_COLS,
  threadRefs,
  toItem,
  visibleSql,
  withDeps,
  type Actor,
  type CommentDeps,
  type CommentRow,
  type RequestCtx,
} from './common'
import { issueFormToken } from './form-token'
import { listRepliesInput, listThreadInput, myCommentsInput, previewInput, stickerSourceInput, threadInput, type StickerSourceInput } from './inputs'
import { CommentError } from './moderation'
import { analyzeBody, finalizeHtml, renderBody, renderCached } from './render'
import { characterStickers, lookupStickers, packStickers, stickersByIds } from './stickers'
import type { CommentItem, MyCommentsPage, PreviewResult, RepliesPage, Sticker, ThreadConfig, ThreadPage, ThreadRoot } from './types'
import { EMOJI_ID_RE } from '#/shared/ids'

// Reading threads. Per-viewer (own pending comments, reactions, edit windows), so the browser fetches
// these after the page loads; nothing here goes into shared-cached HTML.
//
// Which comments show:
//   - published and not deleted: in full
//   - the viewer's own pending comments: in full, marked pending
//   - deleted, held or spam comments: as a tombstone, only while visible replies hang off them
//     (roots: any visible reply in the 楼; replies: a visible reply to that reply)

const ROOT_SHOWN = (viewerId: string | null): SQL => sql`(
  ${visibleSql()}
  or (c.author_id = ${viewerId ?? ''} and c.status = 'pending' and c.deleted_at is null)
  or exists (select 1 from comments r where r.root_id = c.id and r.status = 'published' and r.deleted_at is null)
)`

const REPLY_SHOWN = (viewerId: string | null): SQL => sql`(
  ${visibleSql()}
  or (c.author_id = ${viewerId ?? ''} and c.status = 'pending' and c.deleted_at is null)
  or exists (select 1 from comments r where r.parent_id = c.id and r.status = 'published' and r.deleted_at is null)
)`

/** 最热: reactions + 2 × visible replies, newest first on ties. */
const HOT_SCORE = sql.raw(
  `((select count(*) from comment_reactions x where x.comment_id = c.id) + ` +
    `2 * (select count(*) from comments r where r.root_id = c.id and r.status = 'published' and r.deleted_at is null))`,
)

async function threadConfig(deps: CommentDeps): Promise<{ config: ThreadConfig; editWindowMinutes: number; banned: string[] }> {
  const s = await deps.settings()
  const ids = REACTION_KEYS.map((k) => s.reactionStickers[k]).filter((v): v is string => !!v)
  const found = ids.length ? await lookupStickers(ids) : new Map<string, Sticker>()
  const reactionStickers = Object.fromEntries(
    REACTION_KEYS.map((k) => [k, (s.reactionStickers[k] && found.get(s.reactionStickers[k]!)) || null]),
  ) as Record<ReactionKey, Sticker | null>
  return {
    config: {
      guestsAllowed: s.guestsAllowed,
      stickersAllowed: s.stickersAllowed,
      editWindowMinutes: s.editWindowMinutes,
      maxStickers: MAX_STICKERS,
      maxBody: MAX_BODY,
      reactionStickers,
    },
    editWindowMinutes: s.editWindowMinutes,
    banned: s.bannedUserIds,
  }
}

type KeyedRow = CommentRow & Record<string, unknown>

async function repliesFor(rootIds: number[], viewerId: string | null): Promise<Map<number, KeyedRow[]>> {
  const out = new Map<number, KeyedRow[]>()
  if (!rootIds.length) return out
  const found = await rows<KeyedRow>(sql`
    select x.* from unnest(${sql.param(rootIds)}::bigint[]) as rid(id)
    cross join lateral (
      select ${COMMENT_COLS}, ${keyTextSql(REPLY_COLS)}
      from comments c ${COMMENT_JOINS}
      where c.root_id = rid.id and ${REPLY_SHOWN(viewerId)}
      order by ${orderBySql(REPLY_COLS)}
      limit ${REPLY_PREVIEW + 1}
    ) x`)
  for (const r of found) {
    const root = n(r.root_id)
    const list = out.get(root) ?? []
    list.push(r)
    out.set(root, list)
  }
  return out
}

export async function listThread(ctx: RequestCtx, input: unknown, deps: CommentDeps = withDeps()): Promise<ThreadPage> {
  const parsed = listThreadInput.parse(input)
  const t = threadInput.safeParse(parsed)
  if (!t.success) throw new CommentError(404, '评论区不存在')
  const { threadType, threadId, sort } = parsed
  const viewerId = ctx.viewer?.id ?? null
  const now = deps.now()
  const { config, editWindowMinutes, banned } = await threadConfig(deps)
  const scope = `cm:${sort}:${threadType}:${threadId}`.slice(0, 40)

  let where = sql`c.thread_type = ${threadType} and c.thread_id = ${threadId} and c.parent_id is null and ${ROOT_SHOWN(viewerId)}`
  let order: SQL
  let offset = 0
  const cols = sort === 'old' ? OLD_COLS : NEW_COLS
  if (sort === 'hot') {
    if (parsed.cursor) offset = Number(decode(parsed.cursor, scope, OFFSET_COLS).keys[0])
    if (!Number.isFinite(offset) || offset < 0 || offset > 100_000) throw new CommentError(400, '分页参数无效，请刷新后重试')
    order = sql`c.pinned desc, ${HOT_SCORE} desc, c.created_at desc, c.id desc`
  } else {
    if (parsed.cursor) where = sql`${where} and ${keysetAfter(cols, decode(parsed.cursor, scope, cols).keys)}`
    order = orderBySql(cols)
  }

  const [rootRows, totalRows] = await Promise.all([
    rows<CommentRow & Record<string, string>>(sql`
      select ${COMMENT_COLS}, ${keyTextSql(cols)},
        (select count(*) from comments r where r.root_id = c.id and r.status = 'published' and r.deleted_at is null)::int as reply_count
      from comments c ${COMMENT_JOINS}
      where ${where}
      order by ${order}
      limit ${ROOTS_PER_PAGE + 1} offset ${offset}`),
    rows<{ n: number }>(sql`
      select count(*)::int as n from comments c
      where c.thread_type = ${threadType} and c.thread_id = ${threadId} and ${visibleSql()}`),
  ])
  const more = rootRows.length > ROOTS_PER_PAGE
  const page = rootRows.slice(0, ROOTS_PER_PAGE)
  const replies = await repliesFor(
    page.map((r) => n(r.id)),
    viewerId,
  )
  const allIds = [...page.map((r) => n(r.id)), ...[...replies.values()].flat().map((r) => n(r.id))]
  const reactions = await reactionCounts(allIds, viewerId)
  const opts = { viewerId, editWindowMinutes, now, reactions }

  const items: ThreadRoot[] = page.map((r) => {
    const list = replies.get(n(r.id)) ?? []
    const shown = list.slice(0, REPLY_PREVIEW)
    const last = shown[shown.length - 1]
    return {
      ...toItem(r, opts),
      replies: shown.map((x) => toItem(x, opts)),
      replyCount: n(r.reply_count),
      repliesCursor:
        list.length > REPLY_PREVIEW && last ? encodeCursor({ scope: `cm:r:${n(r.id)}`, keys: keyValues(last, REPLY_COLS.length) }) : null,
    }
  })
  await finalizeItems([...items, ...items.flatMap((i) => i.replies)])

  let nextCursor: string | null = null
  if (more) {
    nextCursor =
      sort === 'hot'
        ? encodeCursor({ scope, keys: [String(offset + ROOTS_PER_PAGE)] })
        : encodeCursor({ scope, keys: keyValues(page[page.length - 1]!, cols.length) })
  }

  const v = ctx.viewer
  return {
    threadType,
    threadId,
    sort,
    total: n(totalRows[0]?.n ?? 0),
    items,
    nextCursor,
    viewer: v ? { id: v.id, name: v.name, staff: isStaff(v.role), banned: banned.includes(v.id) } : null,
    config,
    formToken: issueFormToken(now.getTime()),
  }
}

export async function listReplies(ctx: RequestCtx, input: unknown, deps: CommentDeps = withDeps()): Promise<RepliesPage> {
  const { rootId, cursor } = listRepliesInput.parse(input)
  const viewerId = ctx.viewer?.id ?? null
  const s = await deps.settings()
  let where = sql`c.root_id = ${rootId} and ${REPLY_SHOWN(viewerId)}`
  if (cursor) where = sql`${where} and ${keysetAfter(REPLY_COLS, decode(cursor, `cm:r:${rootId}`, REPLY_COLS).keys)}`
  const found = await rows<CommentRow & Record<string, string>>(sql`
    select ${COMMENT_COLS}, ${keyTextSql(REPLY_COLS)}
    from comments c ${COMMENT_JOINS}
    where ${where}
    order by ${orderBySql(REPLY_COLS)}
    limit ${REPLIES_PER_PAGE + 1}`)
  const page = found.slice(0, REPLIES_PER_PAGE)
  const reactions = await reactionCounts(
    page.map((r) => n(r.id)),
    viewerId,
  )
  const items = page.map((r) => toItem(r, { viewerId, editWindowMinutes: s.editWindowMinutes, now: deps.now(), reactions }))
  await finalizeItems(items)
  const last = page[page.length - 1]
  return {
    items,
    nextCursor: found.length > REPLIES_PER_PAGE && last ? encodeCursor({ scope: `cm:r:${rootId}`, keys: keyValues(last, REPLY_COLS.length) }) : null,
  }
}

/** One comment as its thread shows it to this viewer (after create/edit). */
export async function loadItem(id: number, viewerId: string | null, deps: CommentDeps, ownPending = false): Promise<CommentItem> {
  const s = await deps.settings()
  const found = await rows<CommentRow>(sql`select ${COMMENT_COLS} from comments c ${COMMENT_JOINS} where c.id = ${id}`)
  if (!found[0]) throw new CommentError(404, '评论不存在')
  const reactions = await reactionCounts([id], viewerId)
  const [item] = await finalizeItems([toItem(found[0], { viewerId, editWindowMinutes: s.editWindowMinutes, now: deps.now(), reactions, ownPending })])
  return item!
}

// ---- 我的评论 ----

export async function myComments(viewer: Actor, input: unknown): Promise<MyCommentsPage> {
  const { cursor } = myCommentsInput.parse(input ?? {})
  const scope = 'cm:mine'
  let where = sql`c.author_id = ${viewer.id}`
  if (cursor) where = sql`${where} and ${keysetAfter(DESC_COLS, decode(cursor, scope, DESC_COLS).keys)}`
  const [found, counts] = await Promise.all([
    rows<CommentRow & Record<string, string> & { reply_count: number }>(sql`
      select ${COMMENT_COLS}, ${keyTextSql(DESC_COLS)},
        (select count(*) from comments r where r.parent_id = c.id and r.status = 'published' and r.deleted_at is null)::int as reply_count
      from comments c ${COMMENT_JOINS}
      where ${where}
      order by ${orderBySql(DESC_COLS)}
      limit 31`),
    rows<{ published: number; pending: number; spam: number; deleted: number }>(sql`
      select
        count(*) filter (where status = 'published' and deleted_at is null)::int as published,
        count(*) filter (where status = 'pending' and deleted_at is null)::int as pending,
        count(*) filter (where status = 'spam' and deleted_at is null)::int as spam,
        count(*) filter (where status = 'deleted' or deleted_at is not null)::int as deleted
      from comments where author_id = ${viewer.id}`),
  ])
  const page = found.slice(0, 30)
  const refs = await threadRefs(page.map((r) => ({ type: r.thread_type, id: r.thread_id })))
  const items = page.map((r) => {
    const deleted = r.deleted_at != null || r.status === 'deleted'
    return {
      id: n(r.id),
      status: r.status,
      deleted,
      html: deleted ? null : renderCached(n(r.id), r.edited_at, r.body_src),
      createdAt: isoOf(r.created_at),
      editedAt: isoOrNull(r.edited_at),
      thread: refs.get(`${r.thread_type}:${r.thread_id}`)!,
      replyCount: n(r.reply_count),
    }
  })
  await finalizeItems(items)
  const last = page[page.length - 1]
  return {
    items,
    nextCursor: found.length > 30 && last ? encodeCursor({ scope, keys: keyValues(last, DESC_COLS.length) }) : null,
    counts: counts[0] ?? { published: 0, pending: 0, spam: 0, deleted: 0 },
  }
}

// ---- picker sources ----

export async function stickerSource(input: StickerSourceInput): Promise<Sticker[]> {
  const src = stickerSourceInput.parse(input)
  if (src.kind === 'pack') return 'packId' in src ? packStickers({ packId: src.packId }) : packStickers({ slug: src.slug })
  if (src.kind === 'character') return characterStickers(src.slug)
  return stickersByIds(src.ids.filter((id) => EMOJI_ID_RE.test(id)))
}

// ---- preview ----

export async function preview(ctx: RequestCtx, input: unknown, deps: CommentDeps = withDeps()): Promise<PreviewResult> {
  const { body } = previewInput.parse(input)
  const subject = ctx.viewer ? `user:${ctx.viewer.id}` : `ip:${ipHashOf(ctx)}`
  if ((await deps.hit(subject, 'cm:preview', 60)) > RATE.previewsPerMinute) throw new CommentError(429, '预览太频繁，请稍后再试')
  const s = await deps.settings()
  const a = analyzeBody(body)
  const stickers = await lookupStickers(a.stickerIds)
  const problems: string[] = []
  if (a.badMarkers.length) problems.push(`贴纸标记格式不对：${a.badMarkers.slice(0, 3).join('、')}`)
  if (a.stickers.length > MAX_STICKERS) problems.push(`每条评论最多 ${MAX_STICKERS} 张贴纸`)
  if (a.stickers.length && !s.stickersAllowed) problems.push('评论贴纸暂时关闭')
  if (a.stickerIds.some((id) => !stickers.has(id))) problems.push('有贴纸不存在或尚未发布')
  return { html: finalizeHtml(renderBody(body), stickers), stickers: a.stickers.length, links: a.links, problems }
}

export function formToken(deps: CommentDeps = withDeps()): { formToken: string } {
  return { formToken: issueFormToken(deps.now().getTime()) }
}
