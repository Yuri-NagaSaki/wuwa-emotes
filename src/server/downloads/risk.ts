import { and, desc, eq, gt, inArray, like, sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '../audit'
import type { Viewer } from '../auth/session'
import { db, schema } from '../db/client'
import type { CounterKind } from '../db/schema/downloads'
import { R2_READ_KINDS } from '../jobs/handlers/alerts'
import { setSetting, settingSchemas } from '../settings'
import { type DownloadSettings, shanghaiDay } from './policy'
import { flagBucket, flagExpiry } from './store'

// Data behind 后台 › 下载与风控 (站长 only; the server functions in ./admin-fns add requirePerm('downloads')).
// Plain functions so they can be tested without the Start runtime.

const COUNTER_KINDS: CounterKind[] = ['orig', 'batch_item', 'batch', 'zip']
type Actor = Pick<Viewer, 'id' | 'role' | 'impersonatedBy'>

// ---------- overview ----------

export interface RiskOverview {
  /** today, Asia/Shanghai */
  day: string
  /** originals signed today (orig + batch_item) */
  todayOriginals: number
  yesterdayOriginals: number
  /** packs signed today (zip + batch volumes) */
  todayPacks: number
  monthToDate: {
    from: string
    to: string
    byKind: Record<CounterKind, number>
    /** estimated R2 read operations: signed originals and ZIPs (the R2 alert's kinds) */
    r2Reads: number
    /** 下载与风控 › r2ReadAlertMonthly; null = alert off */
    threshold: number | null
  }
  /** requests refused by a minute rate or a daily limit today */
  throttled: { events: number; ips: number }
  /** active blocked_sources entries */
  sources: { blocked: number; watched: number }
}

/**
 * Today's numbers come from the live counters (download_counters). Earlier days come from
 * download_stats_daily, which the hourly rollup fills; for every (day, kind) the larger of the two is
 * used, so the last hour before a rollup and a counter table emptied by a crash are both covered
 * without counting anything twice.
 */
export async function riskOverview(now = new Date()): Promise<RiskOverview> {
  const today = shanghaiDay(now)
  const yesterday = shanghaiDay(new Date(now.getTime() - 86_400_000))
  const monthStart = `${today.slice(0, 7)}-01`
  const from = yesterday < monthStart ? yesterday : monthStart
  const res = await db().execute<{ day: string; kind: string; n: string }>(sql`
    WITH live AS (
      SELECT day, kind, sum(n)::bigint AS n FROM download_counters
      WHERE day >= ${from} AND day <= ${today} GROUP BY day, kind
    ), st AS (
      SELECT day, kind, n FROM download_stats_daily WHERE day >= ${from} AND day <= ${today}
    )
    SELECT to_char(coalesce(live.day, st.day), 'YYYY-MM-DD') AS day, coalesce(live.kind, st.kind) AS kind,
           GREATEST(coalesce(live.n, 0), coalesce(st.n, 0))::bigint AS n
    FROM live FULL JOIN st ON live.day = st.day AND live.kind = st.kind
  `)
  const byDay = new Map<string, Partial<Record<string, number>>>()
  for (const r of res.rows) {
    const d = byDay.get(r.day) ?? {}
    d[r.kind] = Number(r.n)
    byDay.set(r.day, d)
  }
  const get = (day: string, kinds: readonly string[]) => kinds.reduce((a, k) => a + (byDay.get(day)?.[k] ?? 0), 0)
  const byKind = Object.fromEntries(COUNTER_KINDS.map((k) => [k, 0])) as Record<CounterKind, number>
  for (const [day, kinds] of byDay) {
    if (day < monthStart) continue
    for (const k of COUNTER_KINDS) byKind[k] += kinds[k] ?? 0
  }

  const throttledRes = await db().execute<{ events: string; ips: string }>(sql`
    SELECT coalesce(sum(n), 0)::bigint AS events, count(DISTINCT subject)::bigint AS ips FROM rate_windows
    WHERE bucket = ${flagBucket('throttled')} AND window_start = ${flagExpiry(today)} AND subject LIKE 'ip:%'
  `)
  const { blockedSources: b } = schema
  const modes = await db()
    .select({ mode: b.mode, n: sql<string>`count(*)` })
    .from(b)
    .where(sql`${b.until} IS NULL OR ${b.until} > ${now}`)
    .groupBy(b.mode)
  const settings = await readDownloadSettings()
  return {
    day: today,
    todayOriginals: get(today, ['orig', 'batch_item']),
    yesterdayOriginals: get(yesterday, ['orig', 'batch_item']),
    todayPacks: get(today, ['zip', 'batch']),
    monthToDate: {
      from: monthStart,
      to: today,
      byKind,
      r2Reads: R2_READ_KINDS.reduce((a, k) => a + byKind[k], 0),
      threshold: settings.r2ReadAlertMonthly,
    },
    throttled: { events: Number(throttledRes.rows[0]?.events ?? 0), ips: Number(throttledRes.rows[0]?.ips ?? 0) },
    sources: {
      blocked: Number(modes.find((m) => m.mode === 'block')?.n ?? 0),
      watched: Number(modes.find((m) => m.mode === 'watch')?.n ?? 0),
    },
  }
}

// ---------- settings ----------

/** Current downloads settings straight from the table (getSetting caches for 10 s per process). */
export async function readDownloadSettings(): Promise<DownloadSettings> {
  const [row] = await db().select().from(schema.siteSettings).where(eq(schema.siteSettings.key, 'downloads')).limit(1)
  const parsed = settingSchemas.downloads.safeParse(row?.value ?? undefined)
  return parsed.success ? parsed.data : settingSchemas.downloads.parse(undefined)
}

const downloadsShape = settingSchemas.downloads.unwrap().shape

/**
 * A partial update of the downloads settings. Keys left out keep their value; null clears a limit
 * (unlimited). The field schemas are the ones in settingSchemas.downloads without their defaults, which
 * would otherwise fill every missing key; the merged result is validated with settingSchemas.downloads.
 */
export const downloadsPatch = z
  .object(Object.fromEntries(Object.entries(downloadsShape).map(([k, v]) => [k, v.unwrap().optional()])))
  .strict() as unknown as z.ZodType<Partial<DownloadSettings>>

export async function saveDownloadSettings(actor: Actor, patch: Partial<DownloadSettings>): Promise<DownloadSettings> {
  const before = await readDownloadSettings()
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  const after = settingSchemas.downloads.parse({ ...before, ...defined })
  const diff: Record<string, [unknown, unknown]> = {}
  for (const k of Object.keys(after) as (keyof DownloadSettings)[]) {
    if (before[k] !== after[k]) diff[k] = [before[k], after[k]]
  }
  if (!Object.keys(diff).length) return before
  await setSetting('downloads', after, actor.id)
  await audit(actor, 'settings.downloads.update', { type: 'setting', id: 'downloads' }, diff)
  return after
}

// ---------- 可疑来源 ----------

export const SUBJECT_RE = /^(?:ip:[0-9a-f]{32}|user:[A-Za-z0-9_-]{1,64})$/

export interface SuspiciousSource {
  subject: string
  kind: 'ip' | 'user'
  /** short display form: IP 哈希 a91c…2f, or the account name */
  label: string
  /** signed today and yesterday (Asia/Shanghai) */
  originals: number
  packs: number
  total: number
  /** occurrences today and yesterday */
  features: { burst: number; noReferer: number; throttled: number }
  mode: 'block' | 'watch' | null
  until: string | null
  reason: string | null
  /** the blocked_sources entry is in force (no `until`, or `until` in the future) */
  active: boolean
}

/**
 * Top subjects of the last day by signed downloads (download_counters of today and yesterday, the
 * counters' day granularity), plus the most flagged ones and every blocked_sources entry, with their
 * features (burst = sequential crawling, noReferer, throttled). Originals are counted per account for
 * signed-in users (user:<id>), everything else per IP (ip:<hash>).
 */
export async function suspiciousSources(opts: { limit?: number; now?: Date } = {}): Promise<SuspiciousSource[]> {
  const limit = opts.limit ?? 50
  const now = opts.now ?? new Date()
  const yesterday = shanghaiDay(new Date(now.getTime() - 86_400_000))
  const { downloadCounters: c, rateWindows: r, blockedSources: b, users } = schema

  const counted = sql<number>`sum(${c.n})`
  const topCounted = await db()
    .select({ subject: c.subject })
    .from(c)
    .where(sql`${c.day} >= ${yesterday}`)
    .groupBy(c.subject)
    .orderBy(desc(counted), c.subject)
    .limit(limit)
  const flagged = sql<number>`sum(${r.n})`
  const topFlagged = await db()
    .select({ subject: r.subject })
    .from(r)
    .where(and(like(r.bucket, 'flag:%'), gt(r.windowStart, now)))
    .groupBy(r.subject)
    .orderBy(desc(flagged), r.subject)
    .limit(limit)
  const listed = await db().select().from(b)
  const subjects = [...new Set([...topCounted.map((x) => x.subject), ...topFlagged.map((x) => x.subject), ...listed.map((x) => x.subject)])]
  if (!subjects.length) return []

  const totals = await db()
    .select({
      subject: c.subject,
      originals: sql<string>`coalesce(sum(${c.n}) FILTER (WHERE ${c.kind} IN ('orig', 'batch_item')), 0)`,
      packs: sql<string>`coalesce(sum(${c.n}) FILTER (WHERE ${c.kind} IN ('zip', 'batch')), 0)`,
    })
    .from(c)
    .where(and(inArray(c.subject, subjects), sql`${c.day} >= ${yesterday}`))
    .groupBy(c.subject)
  const flags = await db()
    .select({ subject: r.subject, bucket: r.bucket, n: sql<string>`sum(${r.n})` })
    .from(r)
    .where(and(inArray(r.subject, subjects), like(r.bucket, 'flag:%'), gt(r.windowStart, now)))
    .groupBy(r.subject, r.bucket)
  const userIds = subjects.filter((s) => s.startsWith('user:')).map((s) => s.slice(5))
  const names = userIds.length ? await db().select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : []

  const out = subjects.map((subject): SuspiciousSource => {
    const t = totals.find((x) => x.subject === subject)
    const f = (feature: 'burst' | 'noref' | 'throttled') => Number(flags.find((x) => x.subject === subject && x.bucket === flagBucket(feature))?.n ?? 0)
    const entry = listed.find((x) => x.subject === subject)
    const isUser = subject.startsWith('user:')
    const hash = subject.slice(3)
    const originals = Number(t?.originals ?? 0)
    const packs = Number(t?.packs ?? 0)
    return {
      subject,
      kind: isUser ? 'user' : 'ip',
      label: isUser ? (names.find((n) => `user:${n.id}` === subject)?.name ?? subject.slice(5)) : `IP 哈希 ${hash.slice(0, 4)}…${hash.slice(-2)}`,
      originals,
      packs,
      total: originals + packs,
      features: { burst: f('burst'), noReferer: f('noref'), throttled: f('throttled') },
      mode: entry?.mode ?? null,
      until: entry?.until?.toISOString() ?? null,
      reason: entry?.reason ?? null,
      active: !!entry && (entry.until === null || entry.until.getTime() > now.getTime()),
    }
  })
  const flagSum = (s: SuspiciousSource) => s.features.burst + s.features.noReferer + s.features.throttled
  return out.sort((a, b) => b.total - a.total || flagSum(b) - flagSum(a) || a.subject.localeCompare(b.subject))
}

export const sourceModeInput = z.object({
  subject: z.string().regex(SUBJECT_RE),
  mode: z.enum(['block', 'watch', 'none']),
  /** ISO timestamp; omitted or null = until lifted */
  until: z.iso
    .datetime({ offset: true })
    .nullable()
    .optional()
    .refine((v) => v == null || Date.parse(v) > Date.now(), { message: 'until must be in the future' }),
  reason: z.string().trim().max(200).nullable().optional(),
})

export type SourceModeInput = z.infer<typeof sourceModeInput>

export interface SourceEntryView {
  subject: string
  mode: 'block' | 'watch'
  until: string | null
  reason: string | null
}

/** Block, watch or release (mode none) a subject; audit logged with the entry before and after. */
export async function setSourceMode(actor: Actor, input: SourceModeInput): Promise<SourceEntryView | null> {
  const { blockedSources: b } = schema
  return db().transaction(async (tx) => {
    const [prev] = await tx.select().from(b).where(eq(b.subject, input.subject)).for('update')
    const view = (row: typeof prev | undefined): SourceEntryView | null =>
      row ? { subject: row.subject, mode: row.mode, until: row.until?.toISOString() ?? null, reason: row.reason } : null
    let next: typeof prev | undefined
    if (input.mode === 'none') {
      await tx.delete(b).where(eq(b.subject, input.subject))
    } else {
      const values = {
        mode: input.mode,
        until: input.until ? new Date(input.until) : null,
        reason: input.reason ?? null,
        createdBy: actor.id,
      }
      ;[next] = await tx
        .insert(b)
        .values({ subject: input.subject, ...values })
        .onConflictDoUpdate({ target: b.subject, set: values })
        .returning()
    }
    const before = view(prev)
    const after = view(next)
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      await audit(actor, 'downloads.source.set', { type: 'source', id: input.subject }, { before, after }, tx)
    }
    return after
  })
}
