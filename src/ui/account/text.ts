// Small text helpers for the account, 投稿 and 审核 pages.

const CJK = /[㐀-鿿]/

/**
 * Message for a failed server function. Our HttpErrors carry Chinese copy; anything else (network,
 * database, a framework error in English) gets the fallback.
 */
export function errorText(err: unknown, fallback = '操作失败，请稍后再试'): string {
  const message = (err as { message?: unknown } | null)?.message
  if (typeof message === 'string' && CJK.test(message) && message.length < 200) return message
  return fallback
}

/** HTTP status of a failed server function (401 / 403), when it survived the round trip. */
export function errorStatus(err: unknown): number | null {
  const e = err as { status?: unknown; message?: unknown } | null
  if (typeof e?.status === 'number') return e.status
  if (typeof e?.message === 'string') {
    if (e.message.includes('请先登录')) return 401
    if (e.message.includes('没有权限')) return 403
  }
  return null
}

const TZ = 'Asia/Shanghai'

/** 10-18, or 2025-10-18 for other years; "今天 04:21" / "昨天 22:10" for the last two days. */
export function shortDate(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return ''
  const d = new Date(iso)
  const day = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(x)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  const today = day(now)
  const yesterday = day(new Date(now.getTime() - 86_400_000))
  const dd = day(d)
  if (dd === today) return `今天 ${time}`
  if (dd === yesterday) return `昨天 ${time}`
  return dd.slice(0, 4) === today.slice(0, 4) ? dd.slice(5) : dd
}

/** "3 分钟前", "14 小时前", "5 天前", then the date. */
export function ago(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return ''
  const s = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86_400) return `${Math.floor(s / 3600)} 小时前`
  if (s < 86_400 * 7) return `${Math.floor(s / 86_400)} 天前`
  return shortDate(iso, now)
}

/** 2026-09-03 */
export function fullDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}
