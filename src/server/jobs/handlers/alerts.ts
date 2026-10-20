import { and, eq, gte, inArray, isNotNull, lt, lte, or, sql } from 'drizzle-orm'
import { db, schema } from '../../db/client'
import { log } from '../../log'
import { sendMail } from '../../mail'
import { formatCreditsDate } from '../../media/credits'
import { siteUrl } from '../../media/publish'
import { getSetting, siteIdentity } from '../../settings'

// r2.alert (daily 04:00 Asia/Shanghai, docs/ARCHITECTURE.md §6.2). Month-to-date R2 read operations are
// estimated as the signed original and ZIP downloads in download_stats_daily (kinds orig, batch_item and
// zip; /img origin fetches are not counted). Above 下载与风控 › r2ReadAlertMonthly every active 站长 gets
// one mail, at most once per day: the day is claimed in site_settings before sending and released again
// if sending fails, so a retry sends again and a second run on the same day does not.

export const R2_ALERT_KEY = 'alerts.r2.lastSent'
export const R2_READ_KINDS = ['orig', 'batch_item', 'zip'] as const

const KIND_LABELS: Record<(typeof R2_READ_KINDS)[number], string> = {
  orig: '单张原图（查看、保存）',
  batch_item: '打包清单中的单张',
  zip: '整包 ZIP',
}

export type R2AlertResult =
  | { status: 'disabled' }
  | { status: 'below' | 'already-sent' | 'no-admins'; total: number; threshold: number }
  | { status: 'sent'; total: number; threshold: number; recipients: number }

export interface R2AlertDeps {
  now?: Date
  sendMail?: (to: string, subject: string, text: string) => Promise<void>
}

const fmt = (n: number) => n.toLocaleString('en-US')

export async function checkR2ReadAlert(deps: R2AlertDeps = {}): Promise<R2AlertResult> {
  const now = deps.now ?? new Date()
  const mail = deps.sendMail ?? sendMail
  const { r2ReadAlertMonthly: threshold } = await getSetting('downloads')
  if (threshold == null) return { status: 'disabled' }

  const { downloadStatsDaily: stats, siteSettings, users } = schema
  // calendar month in Asia/Shanghai, the same day boundary as download_counters
  const today = formatCreditsDate(now)
  const monthStart = `${today.slice(0, 7)}-01`
  const rows = await db()
    .select({ kind: stats.kind, n: sql<string>`sum(${stats.n})` })
    .from(stats)
    .where(and(gte(stats.day, monthStart), lte(stats.day, today), inArray(stats.kind, [...R2_READ_KINDS])))
    .groupBy(stats.kind)
  const byKind = Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)])) as Partial<Record<string, number>>
  const total = R2_READ_KINDS.reduce((a, k) => a + (byKind[k] ?? 0), 0)
  if (total <= threshold) return { status: 'below', total, threshold }

  const [previous] = await db().select({ value: siteSettings.value }).from(siteSettings).where(eq(siteSettings.key, R2_ALERT_KEY))
  const claimed = await db()
    .insert(siteSettings)
    .values({ key: R2_ALERT_KEY, value: { day: today, total }, updatedAt: now })
    .onConflictDoUpdate({
      target: siteSettings.key,
      set: { value: { day: today, total }, updatedAt: now },
      setWhere: sql`${siteSettings.value}->>'day' IS DISTINCT FROM ${today}`,
    })
    .returning({ key: siteSettings.key })
  if (!claimed.length) return { status: 'already-sent', total, threshold }

  const release = async () => {
    const mine = and(eq(siteSettings.key, R2_ALERT_KEY), sql`${siteSettings.value}->>'day' = ${today}`)
    if (previous) await db().update(siteSettings).set({ value: previous.value }).where(mine)
    else await db().delete(siteSettings).where(mine)
  }

  try {
    const admins = await db()
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.role, 'admin'), or(eq(users.banned, false), and(isNotNull(users.banExpires), lt(users.banExpires, now)))))
    if (!admins.length) {
      log().error({ total, threshold }, 'r2.alert: threshold exceeded but there is no active admin to notify')
      await release()
      return { status: 'no-admins', total, threshold }
    }
    const site = await siteIdentity()
    const subject = `[${site.name}] R2 读操作本月估算 ${fmt(total)} 次，已超过告警阈值 ${fmt(threshold)}`
    const text = [
      `${site.name} 本月（${monthStart} 至 ${today}，北京时间）R2 读操作估算为 ${fmt(total)} 次，超过「下载与风控」中设置的告警阈值 ${fmt(threshold)} 次。`,
      '',
      '按类别（签发次数）：',
      ...R2_READ_KINDS.map((k) => `  ${KIND_LABELS[k]}：${fmt(byKind[k] ?? 0)}`),
      '',
      '估算只包含原图与 ZIP 的签发次数，不含 /img 回源。需要时可在后台「下载与风控」收紧限额或打开紧急开关：',
      siteUrl('/admin'),
      '',
      '此提醒每天最多发送一次。',
    ].join('\n')
    for (const a of admins) await mail(a.email, subject, text)
    log().warn({ total, threshold, recipients: admins.length }, 'r2.alert: admins notified')
    return { status: 'sent', total, threshold, recipients: admins.length }
  } catch (err) {
    await release()
    throw err
  }
}

export async function r2AlertJob() {
  await checkR2ReadAlert()
}
