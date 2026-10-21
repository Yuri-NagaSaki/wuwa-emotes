import { eq, sql, type SQL } from 'drizzle-orm'
import { ROLES, type Role, type SubmitMode } from '#/shared/roles'
import { deleteAvatarFiles, swapAvatarHash } from '../account/avatar'
import { audit } from '../audit'
import { auth } from '../auth/auth'
import { db, schema } from '../db/client'
import { avatarPath, avatarUrl, isAvatarHash } from '../media/keys'
import { purgeImgUrls } from '../media/purge'
import { HttpError } from '../perm/fn'
import { type Actor, assertOwner, badRequest, likePattern, many, notFound, pageOf, roleOf, toIso, toNum } from './common'
import type { UserListData, UserRow } from './types'

// 用户与权限 (站长 only, docs/ARCHITECTURE.md §5.1). Role, ban, session and impersonation changes go
// through Better Auth's admin endpoints with the caller's own headers, so the plugin enforces 站长-only
// access a second time; the users_keep_last_admin trigger keeps at least one active 站长. The audit row
// is written after the endpoint succeeded.

const LAST_ADMIN = '至少要保留一位站长：请先任命另一位站长，再修改这个账号'

function isLastAdminError(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== 'object' || depth > 5) return false
  const e = err as { code?: unknown; message?: unknown; cause?: unknown; body?: unknown }
  if (e.code === '23514' || (typeof e.message === 'string' && e.message.includes('at least one active admin'))) return true
  return isLastAdminError(e.cause, depth + 1) || isLastAdminError(e.body, depth + 1)
}

/** Better Auth / database errors → messages the 用户与权限 page can show as they are. */
export function authError(err: unknown): HttpError {
  if (err instanceof HttpError) return err
  if (isLastAdminError(err)) return new HttpError(409, LAST_ADMIN)
  const e = err as { status?: unknown; statusCode?: unknown; body?: { message?: string; code?: string }; message?: string }
  const status = typeof e.statusCode === 'number' ? e.statusCode : typeof e.status === 'number' ? e.status : 500
  const code = e.body?.code ?? ''
  const known: Record<string, string> = {
    YOU_CANNOT_BAN_YOURSELF: '不能封禁自己',
    YOU_CANNOT_IMPERSONATE_ADMINS: '不能模拟登录其他站长',
    USER_NOT_FOUND: '用户不存在',
    YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE: '只有站长可以修改角色',
    YOU_ARE_NOT_ALLOWED_TO_BAN_USERS: '只有站长可以封禁用户',
    YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS: '只有站长可以模拟登录',
    YOU_ARE_NOT_ALLOWED_TO_REVOKE_USERS_SESSIONS: '只有站长可以强制下线',
  }
  if (known[code]) return new HttpError(status >= 400 && status < 600 ? status : 400, known[code]!)
  if (status === 401) return new HttpError(401, '请先登录')
  if (status === 403) return new HttpError(403, '没有权限执行这个操作')
  if (status >= 400 && status < 500) return new HttpError(status, e.body?.message ?? e.message ?? '操作失败')
  return new HttpError(500, '操作失败，请稍后再试')
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw authError(err)
  }
}

function userFilters(input: { q?: string; role?: Role; submitMode?: SubmitMode; banned?: boolean }, withRole: boolean): SQL {
  const parts: SQL[] = [sql`true`]
  if (input.q) parts.push(sql`(u.name ILIKE ${likePattern(input.q)} OR u.email ILIKE ${likePattern(input.q)} OR u.id = ${input.q})`)
  if (withRole && input.role) parts.push(sql`u.role = ${input.role}`)
  if (input.submitMode) parts.push(sql`u.submit_mode = ${input.submitMode}`)
  if (input.banned !== undefined) parts.push(sql`u.banned = ${input.banned}`)
  return sql.join(parts, sql` AND `)
}

export async function listUsers(input: { q?: string; role?: Role; submitMode?: SubmitMode; banned?: boolean; page?: number }): Promise<UserListData> {
  const where = userFilters(input, true)
  const [{ n } = { n: 0 }] = await many<{ n: number }>(sql`SELECT count(*)::int AS n FROM users u WHERE ${where}`)
  const pg = pageOf(input.page, toNum(n))
  const rows = await many<{
    id: string
    name: string
    email: string
    image: string | null
    role: string
    submit_mode: SubmitMode
    banned: boolean
    ban_reason: string | null
    ban_expires: Date | null
    created_at: Date
    last_active: Date | null
    packs: number
    approved: number
    sessions: number
  }>(sql`
    SELECT u.id, u.name, u.email, u.image, u.role, u.submit_mode, u.banned, u.ban_reason, u.ban_expires, u.created_at,
      (SELECT max(s.updated_at) FROM sessions s WHERE s.user_id = u.id) AS last_active,
      (SELECT count(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now())::int AS sessions,
      (SELECT count(*) FROM packs p WHERE p.owner_id = u.id)::int AS packs,
      (SELECT count(*) FROM submissions x WHERE x.submitter_id = u.id AND x.status = 'approved')::int AS approved
    FROM users u WHERE ${where}
    ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, last_active DESC NULLS LAST, u.created_at DESC
    LIMIT ${pg.size} OFFSET ${pg.offset}`)
  const counted = await many<{ role: string; n: number }>(sql`SELECT u.role, count(*)::int AS n FROM users u WHERE ${userFilters(input, false)} GROUP BY u.role`)
  const counts: Record<Role, number> = { admin: 0, manager: 0, user: 0 }
  for (const c of counted) counts[roleOf(c.role)] += toNum(c.n)
  return {
    rows: rows.map(
      (r): UserRow => ({
        id: r.id,
        name: r.name,
        email: r.email,
        avatarUrl: avatarUrl(r.id, r.image, 256),
        role: roleOf(r.role),
        submitMode: r.submit_mode,
        banned: r.banned,
        banReason: r.ban_reason,
        banExpires: toIso(r.ban_expires),
        createdAt: toIso(r.created_at) ?? '',
        lastActive: toIso(r.last_active),
        packs: toNum(r.packs),
        approved: toNum(r.approved),
        sessions: toNum(r.sessions),
      }),
    ),
    total: toNum(n),
    page: pg.page,
    pages: pg.pages,
    pageSize: pg.size,
    counts,
  }
}

async function loadUser(userId: string) {
  const [u] = await db().select().from(schema.users).where(eq(schema.users.id, userId))
  if (!u) throw notFound('这个用户')
  return u
}

export async function setUserRole(actor: Actor, headers: Headers, input: { userId: string; role: Role }) {
  assertOwner(actor)
  const u = await loadUser(input.userId)
  if (u.role === input.role) return { role: input.role }
  await call(() => auth().api.setRole({ body: { userId: u.id, role: input.role as 'admin' }, headers }))
  await audit(actor, 'user.role', { type: 'user', id: u.id }, { role: [u.role, input.role], name: u.name })
  return { role: input.role }
}

/** 投稿模式: only 站长 may change it (a 管理员 must not be able to make themselves 免审). */
export async function setSubmitMode(actor: Actor, input: { userId: string; mode: SubmitMode }) {
  assertOwner(actor)
  const u = await loadUser(input.userId)
  if (u.submitMode === input.mode) return { mode: input.mode }
  await db().update(schema.users).set({ submitMode: input.mode }).where(eq(schema.users.id, u.id))
  await audit(actor, 'user.submit_mode', { type: 'user', id: u.id }, { submitMode: [u.submitMode, input.mode], name: u.name })
  return { mode: input.mode }
}

export async function banUser(actor: Actor, headers: Headers, input: { userId: string; reason?: string; days?: number }) {
  assertOwner(actor)
  const u = await loadUser(input.userId)
  if (u.id === actor.id) throw badRequest('不能封禁自己')
  await call(() =>
    auth().api.banUser({
      body: { userId: u.id, banReason: input.reason || undefined, banExpiresIn: input.days ? input.days * 86_400 : undefined },
      headers,
    }),
  )
  await audit(actor, 'user.ban', { type: 'user', id: u.id }, { name: u.name, reason: input.reason ?? null, days: input.days ?? null })
  return { banned: true }
}

export async function unbanUser(actor: Actor, headers: Headers, input: { userId: string }) {
  assertOwner(actor)
  const u = await loadUser(input.userId)
  await call(() => auth().api.unbanUser({ body: { userId: u.id }, headers }))
  await audit(actor, 'user.unban', { type: 'user', id: u.id }, { name: u.name })
  return { banned: false }
}

export async function revokeSessions(actor: Actor, headers: Headers, input: { userId: string }) {
  assertOwner(actor)
  const u = await loadUser(input.userId)
  await call(() => auth().api.revokeUserSessions({ body: { userId: u.id }, headers }))
  await audit(actor, 'user.revoke_sessions', { type: 'user', id: u.id }, { name: u.name })
  return { ok: true }
}

export interface ClearAvatarDeps {
  /** Cloudflare purge by URL (src/server/media/purge.ts). */
  purge(urls: string[]): Promise<{ purged: number; skipped: boolean }>
}

/**
 * 清除头像 (站长): the user's avatar back to the letter, both files deleted and their URLs purged from
 * the CDN (a cleared avatar is usually one that should not be seen). Audited with the purge outcome.
 */
export async function clearUserAvatar(actor: Actor, input: { userId: string }, deps: ClearAvatarDeps = { purge: (urls) => purgeImgUrls(urls) }) {
  assertOwner(actor)
  const u = await loadUser(input.userId)
  const swapped = await swapAvatarHash(u.id, null)
  if (!swapped) throw notFound('这个用户')
  if (swapped.previous == null) return { cleared: false }
  await deleteAvatarFiles(u.id, swapped.previous)
  // origin paths: the purge adds each object's public URL when PUBLIC_IMG_BASE is set
  const prev = swapped.previous
  const urls = isAvatarHash(prev) ? [avatarPath(u.id, prev, 256), avatarPath(u.id, prev, 64)] : []
  let purge: { urls: number; purged: number; skipped: boolean; error: string | null } = { urls: urls.length, purged: 0, skipped: false, error: null }
  try {
    const r = await deps.purge(urls)
    purge = { ...purge, purged: r.purged, skipped: r.skipped }
  } catch (err) {
    purge.error = (err as Error).message
  }
  await audit(actor, 'user.avatar_clear', { type: 'user', id: u.id }, { name: u.name, from: swapped.previous, purge })
  return { cleared: true }
}

/**
 * 模拟登录: Better Auth swaps the session cookie for one of the target user (30 minutes). Every write
 * made meanwhile is audited with impersonated_by = the 站长.
 */
export async function impersonateUser(actor: Actor, headers: Headers, input: { userId: string }) {
  assertOwner(actor)
  const u = await loadUser(input.userId)
  if (u.id === actor.id) throw badRequest('不能模拟登录自己')
  await call(() => auth().api.impersonateUser({ body: { userId: u.id }, headers }))
  await audit(actor, 'user.impersonate', { type: 'user', id: u.id }, { name: u.name, role: u.role })
  return { ok: true, role: roleOf(u.role), name: u.name, roleName: ROLES[roleOf(u.role)].name }
}

/**
 * 结束模拟, called by the impersonated session itself: Better Auth deletes it and puts the 站长's own
 * session cookie back (kept in its admin_session cookie). Audited as the 站长.
 */
export async function stopImpersonating(viewer: Actor, headers: Headers) {
  if (!viewer.impersonatedBy) throw badRequest('当前没有在模拟登录')
  const res = await call(() => auth().api.stopImpersonating({ headers }))
  const admin = res.user as { id: string; role?: string | null }
  await audit({ id: admin.id, role: roleOf(admin.role), impersonatedBy: null }, 'user.impersonate_stop', { type: 'user', id: viewer.id }, { name: viewer.name })
  return { ok: true }
}
