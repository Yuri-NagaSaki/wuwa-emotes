import { sql } from 'drizzle-orm'
import type { Role } from '#/shared/roles'
import { can } from '#/shared/roles'
import type { Viewer } from '../auth/session'
import { verifyCapToken, type CapResult } from '../auth/cap'
import { rows } from '../catalog/sql'
import { CatalogInputError, decodeCursor, encodeCursor } from '../catalog/cursor'
import type { KeyCol } from '../catalog/sql'
import type { CommentStatus, CommentThread } from '../db/schema/community'
import { hashValue } from '../http/client'
import { hitWindow } from '../ratelimit'
import { getSetting, type SettingValue } from '../settings'
import { BADGES, REACTION_KEYS, type Badge, type ReactionKey } from './constants'
import { avatarColor, CommentError } from './moderation'
import { finalizeHtml, placeholderIds, renderCached } from './render'
import { lookupStickers } from './stickers'
import type { CommentItem, CommentState, ReactionCount, Sticker, ThreadRef } from './types'

// Shared plumbing for the comment service: injectable dependencies, the per-request context, row →
// DTO mapping and thread lookups.

export type CommentSettings = SettingValue<'comments'>

export interface CommentDeps {
  now: () => Date
  /** Single-use Cap verification; called at most once per request. */
  verifyCap: (token: string | null) => Promise<CapResult>
  settings: () => Promise<CommentSettings>
  /** Fixed-window counter (src/server/ratelimit.ts); returns the count after this hit. */
  hit: (subject: string, bucket: string, windowSeconds: number) => Promise<number>
}

export const defaultDeps: CommentDeps = {
  now: () => new Date(),
  verifyCap: (token) => verifyCapToken(token),
  settings: () => getSetting('comments'),
  hit: (subject, bucket, windowSeconds) => hitWindow(subject, bucket, windowSeconds),
}

export function withDeps(over: Partial<CommentDeps> = {}): CommentDeps {
  return { ...defaultDeps, ...over }
}

export type Actor = Pick<Viewer, 'id' | 'name' | 'role' | 'impersonatedBy'> & Partial<Pick<Viewer, 'email'>>

/** Who is asking. `ip` is the raw client IP (clientIp); only its salted hash is stored. */
export interface RequestCtx {
  viewer: Actor | null
  ip: string
  /** x-cap-token header (guests) */
  capToken?: string | null
}

export function ipHashOf(ctx: RequestCtx): string {
  return hashValue(ctx.ip)!
}

export function isStaff(role: Role | string | null | undefined): boolean {
  return can(role, 'comments')
}

export function badgeOf(value: string | null): Badge | null {
  return (BADGES as readonly string[]).includes(value ?? '') ? (value as Badge) : null
}

// ---- rows ----

export interface CommentRow {
  id: number | string
  thread_type: CommentThread
  thread_id: string
  parent_id: number | string | null
  root_id: number | string | null
  author_id: string | null
  guest_name: string | null
  body_src: string
  status: CommentStatus
  pinned: boolean
  staff_badge: string | null
  edited_at: Date | string | null
  deleted_at: Date | string | null
  created_at: Date | string
  author_name: string | null
  /** author name of the parent, when parent ≠ root */
  reply_to: string | null
}

/** Select list for CommentRow; `c` = comments, joins users `u` and the parent `pc`/`pu`. */
export const COMMENT_COLS = sql.raw(
  `c.id, c.thread_type, c.thread_id, c.parent_id, c.root_id, c.author_id, c.guest_name, c.body_src, c.status, ` +
    `c.pinned, c.staff_badge, c.edited_at, c.deleted_at, c.created_at, u.name as author_name, ` +
    `case when c.parent_id is not null and c.parent_id <> c.root_id then coalesce(pu.name, pc.guest_name) end as reply_to`,
)
export const COMMENT_JOINS = sql.raw(
  `left join users u on u.id = c.author_id ` + `left join comments pc on pc.id = c.parent_id ` + `left join users pu on pu.id = pc.author_id`,
)

/** Published and not deleted. */
export function visibleSql(alias = 'c') {
  return sql.raw(`(${alias}.status = 'published' and ${alias}.deleted_at is null)`)
}

export function n(v: unknown): number {
  return typeof v === 'number' ? v : Number(v)
}

export function nOrNull(v: unknown): number | null {
  return v == null ? null : Number(v)
}

export function isoOf(v: Date | string): string {
  return (v instanceof Date ? v : new Date(v)).toISOString()
}

export function isoOrNull(v: Date | string | null): string | null {
  return v == null ? null : isoOf(v)
}

export function stateOf(row: Pick<CommentRow, 'status' | 'deleted_at' | 'author_id'>, viewerId: string | null, ownPending = false): CommentState {
  if (row.deleted_at != null || row.status === 'deleted') return 'deleted'
  if (row.status === 'published') return 'visible'
  if (row.status === 'pending' && (ownPending || (viewerId && row.author_id === viewerId))) return 'pending'
  return 'hidden'
}

export function authorName(row: Pick<CommentRow, 'author_id' | 'author_name' | 'guest_name'>): string {
  if (row.author_id) return row.author_name ?? '已注销用户'
  if (row.guest_name) return row.guest_name
  return '已注销用户'
}

export interface ItemOpts {
  viewerId: string | null
  editWindowMinutes: number
  now: Date
  reactions: Map<number, ReactionCount[]>
  /** Show a pending comment to whoever just wrote it (a guest has no id to match). */
  ownPending?: boolean
}

/** Row → DTO with sticker placeholders still in `html` (see finalizeItems). */
export function toItem(row: CommentRow, o: ItemOpts): CommentItem {
  const id = n(row.id)
  const state = stateOf(row, o.viewerId, o.ownPending)
  const shown = state === 'visible' || state === 'pending'
  const mine = !!o.viewerId && row.author_id === o.viewerId
  const created = row.created_at instanceof Date ? row.created_at : new Date(row.created_at)
  const until = new Date(created.getTime() + o.editWindowMinutes * 60_000)
  const editable = mine && shown && until > o.now
  const name = authorName(row)
  return {
    id,
    threadType: row.thread_type,
    threadId: row.thread_id,
    rootId: nOrNull(row.root_id),
    parentId: nOrNull(row.parent_id),
    replyTo: shown ? (row.reply_to ?? null) : null,
    author: shown ? { name, guest: !row.author_id && !!row.guest_name, color: avatarColor(name) } : null,
    badge: shown ? badgeOf(row.staff_badge) : null,
    pinned: row.pinned,
    state,
    html: shown ? renderCached(id, row.edited_at, row.body_src) : null,
    createdAt: created.toISOString(),
    editedAt: isoOrNull(row.edited_at),
    reactions: shown ? (o.reactions.get(id) ?? []) : [],
    mine,
    editableUntil: editable ? until.toISOString() : null,
    bodySrc: editable ? row.body_src : null,
  }
}

/** Swap sticker placeholders for <img> in every html field (one lookup for the whole batch). */
export async function finalizeItems<T extends { html: string | null }>(items: T[]): Promise<T[]> {
  const ids = new Set<string>()
  for (const it of items) if (it.html) for (const id of placeholderIds(it.html)) ids.add(id)
  const stickers = ids.size ? await lookupStickers([...ids]) : new Map<string, Sticker>()
  for (const it of items) if (it.html) it.html = finalizeHtml(it.html, stickers)
  return items
}

export async function reactionCounts(ids: number[], viewerKey: string | null): Promise<Map<number, ReactionCount[]>> {
  const out = new Map<number, ReactionCount[]>()
  if (!ids.length) return out
  const found = await rows<{ comment_id: string | number; reaction_key: string; n: number; mine: boolean }>(sql`
    select comment_id, reaction_key, count(*)::int as n, bool_or(reactor_key = ${viewerKey ?? ''}) as mine
    from comment_reactions
    where comment_id = any(${sql.param(ids)}::bigint[])
    group by comment_id, reaction_key`)
  for (const r of found) {
    if (!(REACTION_KEYS as readonly string[]).includes(r.reaction_key)) continue
    const id = n(r.comment_id)
    const list = out.get(id) ?? []
    list.push({ key: r.reaction_key as ReactionKey, n: n(r.n), mine: !!r.mine })
    out.set(id, list)
  }
  for (const list of out.values()) list.sort((a, b) => REACTION_KEYS.indexOf(a.key) - REACTION_KEYS.indexOf(b.key))
  return out
}

// ---- threads ----

interface ThreadRow {
  type: CommentThread
  id: string
  title: string | null
  slug: string | null
  public: boolean
}

/** Title and link per thread; missing threads get a placeholder title and no link. */
export async function threadRefs(list: { type: CommentThread; id: string }[]): Promise<Map<string, ThreadRef>> {
  const out = new Map<string, ThreadRef>()
  const packIds = [...new Set(list.filter((t) => t.type === 'pack' && /^[1-9][0-9]{0,9}$/.test(t.id)).map((t) => Number(t.id)))]
  const emojiIds = [...new Set(list.filter((t) => t.type === 'emoji').map((t) => t.id))]
  const found: ThreadRow[] = []
  if (packIds.length) {
    found.push(
      ...(await rows<ThreadRow>(sql`
        select 'pack' as type, p.id::text as id, p.title, p.slug, p.status = 'published' as public
        from packs p where p.id = any(${sql.param(packIds)}::int[])`)),
    )
  }
  if (emojiIds.length) {
    found.push(
      ...(await rows<ThreadRow>(sql`
        select 'emoji' as type, e.id, p.title, p.slug, (e.status = 'published' and p.status = 'published') as public
        from emojis e join packs p on p.id = e.pack_id where e.id = any(${sql.param(emojiIds)}::text[])`)),
    )
  }
  for (const r of found) {
    const href = r.public ? (r.type === 'pack' ? `/packs/${r.slug}` : `/e/${r.id}`) : null
    const title = r.type === 'pack' ? (r.title ?? '表情包') : `${r.title ?? '表情包'} · 单张表情`
    out.set(`${r.type}:${r.id}`, { type: r.type, id: r.id, title, href })
  }
  for (const t of list) {
    const key = `${t.type}:${t.id}`
    if (!out.has(key)) out.set(key, { type: t.type, id: t.id, title: t.type === 'pack' ? '已删除的表情包' : '已删除的表情', href: null })
  }
  return out
}

/** The thread is public (a published pack, or a published emoji in a published pack). */
export async function threadIsPublic(type: CommentThread, id: string): Promise<boolean> {
  const ref = (await threadRefs([{ type, id }])).get(`${type}:${id}`)
  return !!ref?.href
}

// ---- cursors ----

export function decode(raw: string, scope: string, cols: KeyCol[]) {
  try {
    return decodeCursor(raw, scope, cols)
  } catch (err) {
    if (err instanceof CatalogInputError) throw new CommentError(400, '分页参数无效，请刷新后重试')
    throw err
  }
}

export { encodeCursor }

export const NEW_COLS: KeyCol[] = [
  { expr: sql.raw('c.pinned::int'), desc: true, type: 'int' },
  { expr: sql.raw('c.created_at'), desc: true, type: 'timestamptz' },
  { expr: sql.raw('c.id'), desc: true, type: 'bigint' },
]
export const OLD_COLS: KeyCol[] = [
  { expr: sql.raw('c.pinned::int'), desc: true, type: 'int' },
  { expr: sql.raw('c.created_at'), desc: false, type: 'timestamptz' },
  { expr: sql.raw('c.id'), desc: false, type: 'bigint' },
]
export const REPLY_COLS: KeyCol[] = [
  { expr: sql.raw('c.created_at'), desc: false, type: 'timestamptz' },
  { expr: sql.raw('c.id'), desc: false, type: 'bigint' },
]
export const OFFSET_COLS: KeyCol[] = [{ expr: sql.raw('0'), desc: false, type: 'int' }]
export const DESC_COLS: KeyCol[] = [
  { expr: sql.raw('c.created_at'), desc: true, type: 'timestamptz' },
  { expr: sql.raw('c.id'), desc: true, type: 'bigint' },
]
