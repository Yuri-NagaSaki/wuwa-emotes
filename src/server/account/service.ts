import { and, count, eq, isNull, ne, sql } from 'drizzle-orm'
import type { Role } from '#/shared/roles'
import { audit } from '../audit'
import { auth } from '../auth/auth'
import type { Viewer } from '../auth/session'
import { db, schema } from '../db/client'
import { favoriteTotal } from '../favorites/service'
import { log } from '../log'
import { HttpError } from '../perm/fn'
import { purgeSubmission } from '../submissions/cleanup'
import { unreadCount } from './notifications'

// 个人中心: the header summary and 注销账号. Name, password and sessions are changed through Better
// Auth's own endpoints from the browser (update-user, change-password, list/revoke-session).

export interface MeSummary {
  id: string
  name: string
  email: string
  emailVerified: boolean
  role: Role
  submitMode: 'review' | 'trusted' | 'blocked'
  joinedAt: string
  submissions: { approved: number; pending: number; returned: number; draft: number }
  favorites: number
  /** own comments that are not deleted (我的评论) */
  comments: number
  unread: number
}

export async function meSummary(viewer: Pick<Viewer, 'id'>): Promise<MeSummary> {
  const d = db()
  const { users, submissions, comments } = schema
  const [u] = await d.select().from(users).where(eq(users.id, viewer.id))
  if (!u) throw new HttpError(401, '请先登录')
  const grouped = await d.select({ status: submissions.status, n: count() }).from(submissions).where(eq(submissions.submitterId, viewer.id)).groupBy(submissions.status)
  const by = Object.fromEntries(grouped.map((g) => [g.status, g.n])) as Record<string, number>
  const [own] = await d
    .select({ n: count() })
    .from(comments)
    .where(and(eq(comments.authorId, viewer.id), ne(comments.status, 'deleted'), isNull(comments.deletedAt)))
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    emailVerified: u.emailVerified,
    role: u.role,
    submitMode: u.submitMode,
    joinedAt: u.createdAt.toISOString(),
    submissions: { approved: by.approved ?? 0, pending: by.pending ?? 0, returned: by.returned ?? 0, draft: by.draft ?? 0 },
    favorites: await favoriteTotal(viewer.id),
    comments: own?.n ?? 0,
    unread: await unreadCount(viewer.id),
  }
}

export interface DeleteAccountDeps {
  verifyPassword(hash: string, password: string): Promise<boolean>
}

const defaultDeps: DeleteAccountDeps = {
  async verifyPassword(hash, password) {
    const ctx = await auth().$context
    return ctx.password.verify({ hash, password })
  },
}

/**
 * 注销账号: check the password, refuse for the last 站长, delete the user's unapproved submissions with
 * their files, then the user row (sessions, accounts, favorites, notifications cascade; packs and
 * comments keep their content with the owner set to null). Not reversible.
 */
export async function deleteAccount(viewer: Pick<Viewer, 'id' | 'role' | 'impersonatedBy'>, password: string, deps: DeleteAccountDeps = defaultDeps): Promise<void> {
  if (viewer.impersonatedBy) throw new HttpError(403, '模拟登录时不能注销账号')
  const d = db()
  const { accounts, users, submissions } = schema
  const [cred] = await d
    .select({ hash: accounts.password })
    .from(accounts)
    .where(and(eq(accounts.userId, viewer.id), eq(accounts.providerId, 'credential')))
  if (!cred?.hash || !(await deps.verifyPassword(cred.hash, password))) throw new HttpError(400, '密码不正确')
  if (viewer.role === 'admin') {
    const [admins] = await d
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.banned, false)))
    if ((admins?.n ?? 0) <= 1) throw new HttpError(400, '你是最后一位站长，不能注销账号。请先任命另一位站长。')
  }
  const open = await d
    .select({ id: submissions.id, packId: submissions.packId, kind: submissions.kind, status: submissions.status })
    .from(submissions)
    .where(and(eq(submissions.submitterId, viewer.id), ne(submissions.status, 'approved')))
  for (const sub of open) await purgeSubmission(sub)
  try {
    await d.transaction(async (tx) => {
      // favorites cascade with the user; the pack counters must follow (plain SQL: updated_at untouched)
      await tx.execute(sql`
        UPDATE packs SET favorite_count = GREATEST(favorite_count - 1, 0)
        WHERE id IN (SELECT DISTINCT target_id::int FROM favorites WHERE user_id = ${viewer.id} AND target_type = 'pack')`)
      await tx.delete(users).where(eq(users.id, viewer.id))
    })
  } catch (err) {
    // the keep_last_admin trigger (a concurrent demotion) or another constraint; drizzle keeps the
    // PostgreSQL error as the cause
    const e = err as Error & { cause?: { message?: string } }
    const text = `${e.message} ${e.cause?.message ?? ''}`
    log().warn({ err: text, userId: viewer.id }, 'account: delete refused')
    throw new HttpError(400, /active admin|站长/i.test(text) ? '你是最后一位站长，不能注销账号。' : '注销失败，请稍后再试')
  }
  await audit(viewer, 'account.delete', { type: 'user', id: viewer.id }, { submissionsPurged: open.length })
}
