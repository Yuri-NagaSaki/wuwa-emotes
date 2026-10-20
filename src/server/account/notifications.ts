import { and, count, desc, eq, inArray, isNull, lt } from 'drizzle-orm'
import { db, schema } from '../db/client'

// 站内通知 (notifications table). Writers pass their transaction so a notice is only stored when the
// change itself commits. Kinds are open strings; the ones below have copy in src/ui/account.

export type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0]
type Runner = ReturnType<typeof db> | Tx

export interface SubmissionNotice {
  submissionId: string
  packId: number
  slug: string
  title: string
  /** 退回原因 */
  reason?: string | null
  auto?: boolean
}

export interface NoticePayloads {
  'submission.approved': SubmissionNotice
  'submission.returned': SubmissionNotice
}

export type NoticeKind = keyof NoticePayloads

export async function notify<K extends NoticeKind>(userId: string, kind: K, payload: NoticePayloads[K], runner: Runner = db()) {
  await runner.insert(schema.notifications).values({ userId, kind, payload: payload as unknown as Record<string, unknown> })
}

export interface NotificationItem {
  id: number
  kind: string
  /** fields of the known kinds; unknown kinds render a generic line */
  payload: Partial<SubmissionNotice>
  read: boolean
  createdAt: string
}

const PAGE = 30

/** Newest first; `before` is the id of the last item of the previous page. */
export async function listNotifications(userId: string, before?: number): Promise<{ items: NotificationItem[]; unread: number; more: boolean }> {
  const { notifications: n } = schema
  const rows = await db()
    .select()
    .from(n)
    .where(and(eq(n.userId, userId), before ? lt(n.id, before) : undefined))
    .orderBy(desc(n.id))
    .limit(PAGE + 1)
  return {
    items: rows.slice(0, PAGE).map((r) => ({ id: r.id, kind: r.kind, payload: r.payload as Partial<SubmissionNotice>, read: r.readAt != null, createdAt: r.createdAt.toISOString() })),
    unread: await unreadCount(userId),
    more: rows.length > PAGE,
  }
}

export async function unreadCount(userId: string): Promise<number> {
  const { notifications: n } = schema
  const [row] = await db()
    .select({ n: count() })
    .from(n)
    .where(and(eq(n.userId, userId), isNull(n.readAt)))
  return row?.n ?? 0
}

/** Mark some (or, without ids, all) of the user's notifications read. Returns the new unread count. */
export async function markRead(userId: string, ids?: number[]): Promise<number> {
  const { notifications: n } = schema
  await db()
    .update(n)
    .set({ readAt: new Date() })
    .where(and(eq(n.userId, userId), isNull(n.readAt), ids ? inArray(n.id, ids.length ? ids : [-1]) : undefined))
  return unreadCount(userId)
}
