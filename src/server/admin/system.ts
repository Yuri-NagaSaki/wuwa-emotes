import { and, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm'
import { audit } from '../audit'
import { db, schema } from '../db/client'
import { env } from '../env'
import { jobSender } from '../jobs/boss'
import { Q, SCHEDULES } from '../jobs/queues'
import { R2_READ_KINDS } from '../jobs/handlers/alerts'
import { mailConfigured } from '../mail'
import { formatCreditsDate } from '../media/credits'
import { getSetting, setSetting, siteIdentity } from '../settings'
import { type Actor, badRequest, likePattern, many, notFound, pageOf, toIso, toNum } from './common'
import type { AuditListInput } from './inputs'
import type { AuditEntry, JobRow, Json, JobsData, Paged, QueueRow, ScheduleRow, SettingsData, StorageData } from './types'

// 存储 · 任务队列 · 审计日志 · 系统设置 (站长 only).

// ---------- 存储 ----------

/** Month-to-date R2 read estimate: signed originals and ZIPs (download_stats_daily), like r2.alert. */
export async function r2ReadsThisMonth(now = new Date()) {
  const { downloadStatsDaily: s } = schema
  const today = formatCreditsDate(now)
  const rows = await db()
    .select({ kind: s.kind, n: sql<string>`sum(${s.n})` })
    .from(s)
    .where(and(gte(s.day, `${today.slice(0, 7)}-01`), lte(s.day, today), inArray(s.kind, [...R2_READ_KINDS])))
    .groupBy(s.kind)
  const byKind = rows.map((r) => ({ kind: r.kind, n: toNum(r.n) }))
  const { r2ReadAlertMonthly } = await getSetting('downloads')
  return { month: byKind.reduce((a, r) => a + r.n, 0), threshold: r2ReadAlertMonthly, byKind }
}

/**
 * Bucket overview from database aggregates only (no bucket listing): every object the app writes is
 * recorded in emojis, zip_artifacts or upload_items. Objects outside those tables (old derived
 * revisions, backups, v1 snapshots) are labelled as not counted.
 */
export async function getStorage(): Promise<StorageData> {
  const [e] = await many<{
    originals: number
    original_bytes: string
    p240: number
    p240_bytes: string
    a160: number
    a160_bytes: string
    full: number
    full_bytes: string
    review: number
    review_bytes: string
    old_revs: number
  }>(sql`
    SELECT count(*)::int AS originals, coalesce(sum(bytes), 0) AS original_bytes,
      count(*) FILTER (WHERE status <> 'pending' AND derived_ready)::int AS p240,
      coalesce(sum(p240_bytes) FILTER (WHERE status <> 'pending' AND derived_ready), 0) AS p240_bytes,
      count(*) FILTER (WHERE status <> 'pending' AND derived_ready AND a160_bytes IS NOT NULL)::int AS a160,
      coalesce(sum(a160_bytes) FILTER (WHERE status <> 'pending' AND derived_ready), 0) AS a160_bytes,
      count(*) FILTER (WHERE full_ready)::int AS full, coalesce(sum(full_bytes) FILTER (WHERE full_ready), 0) AS full_bytes,
      count(*) FILTER (WHERE status = 'pending' AND p240_bytes IS NOT NULL)::int AS review,
      coalesce(sum(coalesce(p240_bytes, 0) + coalesce(a160_bytes, 0)) FILTER (WHERE status = 'pending'), 0) AS review_bytes,
      coalesce(sum(variant_rev - 1), 0)::int AS old_revs
    FROM emojis`)
  const [z] = await many<{ n: number; bytes: string }>(sql`SELECT count(*)::int AS n, coalesce(sum(bytes), 0) AS bytes FROM zip_artifacts`)
  const [u] = await many<{ n: number; bytes: string }>(sql`
    SELECT count(*)::int AS n, coalesce(sum(bytes), 0) AS bytes FROM upload_items WHERE status IN ('signed', 'uploaded', 'processing')`)
  const top = await many<{ pack_key: string; title: string | null; n: number; bytes: string }>(sql`
    SELECT e.storage_pack_key AS pack_key, (SELECT p.title FROM packs p WHERE p.pack_key = e.storage_pack_key) AS title,
      count(*)::int AS n, sum(e.bytes) AS bytes
    FROM emojis e GROUP BY e.storage_pack_key ORDER BY sum(e.bytes) DESC LIMIT 8`)
  const ev = env()
  return {
    bucket: ev.S3_BUCKET,
    endpointHost: new URL(ev.S3_ENDPOINT).host,
    groups: [
      { key: 'originals', label: '原图', prefix: 'assets/v1/packs/', objects: toNum(e?.originals), bytes: toNum(e?.original_bytes), note: '每张表情一个对象，emojis.bytes 合计' },
      { key: 'p240', label: '海报 p240', prefix: 'derived/v1/p240/', objects: toNum(e?.p240), bytes: toNum(e?.p240_bytes), note: '当前版本；旧版本见下方说明' },
      { key: 'a160', label: '动图预览 a160', prefix: 'derived/v1/a160/', objects: toNum(e?.a160), bytes: toNum(e?.a160_bytes), note: '只有动图有' },
      { key: 'full', label: '弹窗动图 full', prefix: 'derived/v1/full/', objects: toNum(e?.full), bytes: toNum(e?.full_bytes), note: '首次查看时生成' },
      { key: 'review', label: '待审核预览', prefix: 'review/v1/', objects: toNum(e?.review), bytes: toNum(e?.review_bytes), note: '通过后复制到 derived/v1/ 并删除' },
      { key: 'zips', label: '整包 ZIP', prefix: 'zips/v1/packs/', objects: toNum(z?.n), bytes: toNum(z?.bytes), note: 'zip_artifacts 记录的当前版本' },
      { key: 'uploads', label: '上传暂存', prefix: 'uploads/tmp/', objects: toNum(u?.n), bytes: toNum(u?.bytes), note: '进行中的上传；生命周期规则 7 天后清理' },
      {
        key: 'old',
        label: '旧版本衍生图',
        prefix: 'derived/v1/…/*.r<旧版本>.webp',
        objects: toNum(e?.old_revs),
        bytes: null,
        note: '重新生成后留下的旧版本（每个旧版本最多 3 个档位），大小未记录；删除表情时一并清理',
      },
    ],
    topPacks: top.map((t) => ({ packKey: t.pack_key, title: t.title, objects: toNum(t.n), bytes: toNum(t.bytes) })),
    r2Reads: await r2ReadsThisMonth(),
  }
}

// ---------- 任务队列 ----------

const STATES = ['created', 'retry', 'active', 'completed', 'cancelled', 'failed'] as const

function jobRow(r: Record<string, unknown>): JobRow {
  return {
    id: String(r.id),
    name: String(r.name),
    state: String(r.state),
    data: (r.data ?? null) as Json,
    output: (r.output ?? null) as Json,
    retryCount: toNum(r.retry_count),
    retryLimit: toNum(r.retry_limit),
    singletonKey: (r.singleton_key as string | null) ?? null,
    createdOn: toIso(r.created_on),
    startedOn: toIso(r.started_on),
    completedOn: toIso(r.completed_on),
  }
}

/** Live counts per queue and state straight from pgboss.job (the queue table's counters lag behind). */
export async function getJobs(): Promise<JobsData> {
  const counts = await many<{ name: string; state: string; n: number }>(sql`SELECT name, state::text AS state, count(*)::int AS n FROM pgboss.job GROUP BY name, state`)
  const policies = await many<{ name: string; policy: string | null }>(sql`SELECT name, policy FROM pgboss.queue`)
  // pg-boss's own internal queues (__pgboss__…) are not app work
  const names = [...new Set([...Object.values(Q), ...policies.map((p) => p.name)])].filter((n) => !n.startsWith('__pgboss'))
  const queues: QueueRow[] = names.map((name) => {
    const c = Object.fromEntries(STATES.map((s) => [s, 0])) as QueueRow['counts']
    for (const r of counts) if (r.name === name && (STATES as readonly string[]).includes(r.state)) c[r.state as keyof QueueRow['counts']] = toNum(r.n)
    return { name, policy: policies.find((p) => p.name === name)?.policy ?? null, counts: c }
  })
  const cols = sql`id, name, state::text AS state, data, output, retry_count, retry_limit, singleton_key, created_on, started_on, completed_on`
  const failed = await many<Record<string, unknown>>(sql`SELECT ${cols} FROM pgboss.job WHERE state = 'failed' AND NOT starts_with(name, '__pgboss') ORDER BY completed_on DESC NULLS LAST LIMIT 30`)
  const active = await many<Record<string, unknown>>(sql`
    SELECT ${cols} FROM pgboss.job WHERE state IN ('active', 'retry', 'created') AND NOT starts_with(name, '__pgboss') ORDER BY state = 'active' DESC, created_on LIMIT 30`)
  const boss = await jobSender()
  const stored = await boss.getSchedules().catch(() => [])
  const declared = new Map(SCHEDULES.map((s) => [s.name as string, s.cron]))
  const schedules: ScheduleRow[] = []
  for (const s of stored) {
    const tz = s.timezone || 'UTC'
    let next: string[] = []
    try {
      next = boss.previewSchedule(s.cron, { tz, count: 2 }).map((d) => d.toISOString())
    } catch {
      next = []
    }
    schedules.push({ name: s.name, key: s.key, cron: s.cron, timezone: tz, nextRuns: next, lastJobId: (s as { lastJobId?: string | null }).lastJobId ?? null })
    declared.delete(s.name)
  }
  // declared in code but not (yet) registered by a worker
  for (const [name, cron] of declared) {
    let next: string[] = []
    try {
      next = boss.previewSchedule(cron, { tz: 'Asia/Shanghai', count: 2 }).map((d) => d.toISOString())
    } catch {
      next = []
    }
    schedules.push({ name, key: '', cron, timezone: 'Asia/Shanghai（未注册）', nextRuns: next, lastJobId: null })
  }
  return { queues, failed: failed.map(jobRow), active: active.map(jobRow), schedules, generatedAt: new Date().toISOString() }
}

export async function jobAction(actor: Actor, input: { name: string; id: string }, action: 'retry' | 'cancel') {
  const [job] = await many<{ name: string; state: string }>(sql`SELECT name, state::text AS state FROM pgboss.job WHERE name = ${input.name} AND id = ${input.id}::uuid`)
  if (!job) throw notFound('这个任务')
  if (action === 'retry' && job.state !== 'failed' && job.state !== 'cancelled') throw badRequest('只有失败或已取消的任务可以重试')
  if (action === 'cancel' && !['created', 'retry', 'active'].includes(job.state)) throw badRequest('只有排队中或运行中的任务可以取消')
  const boss = await jobSender()
  if (action === 'retry') await boss.retry(input.name, input.id)
  else await boss.cancel(input.name, input.id)
  await audit(actor, `job.${action}`, { type: 'job', id: input.id }, { queue: input.name, state: job.state })
  return { ok: true }
}

// ---------- 审计日志 ----------

export async function listAudit(input: AuditListInput, opts: { onlyActor?: string; pageSize?: number } = {}): Promise<Paged<AuditEntry>> {
  const parts: SQL[] = [sql`true`]
  if (opts.onlyActor) parts.push(sql`l.actor_id = ${opts.onlyActor}`)
  if (input.actor) parts.push(sql`(l.actor_id = ${input.actor} OR u.name ILIKE ${likePattern(input.actor)} OR u.email ILIKE ${likePattern(input.actor)})`)
  if (input.action) parts.push(sql`l.action LIKE ${input.action.replace(/[\\%_]/g, (c) => `\\${c}`) + '%'}`)
  if (input.targetType) parts.push(sql`l.target_type = ${input.targetType}`)
  if (input.targetId) parts.push(sql`l.target_id = ${input.targetId}`)
  // calendar days in Asia/Shanghai
  if (input.from) parts.push(sql`l.created_at >= (${input.from}::date)::timestamp AT TIME ZONE 'Asia/Shanghai'`)
  if (input.to) parts.push(sql`l.created_at < ((${input.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')`)
  const where = sql.join(parts, sql` AND `)
  const [{ n } = { n: 0 }] = await many<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id WHERE ${where}`)
  const pg = pageOf(input.page, toNum(n), opts.pageSize ?? 30)
  const rows = await many<Record<string, unknown>>(sql`
    SELECT l.id, l.created_at, l.actor_id, u.name AS actor_name, l.actor_role, l.impersonated_by, iu.name AS impersonator_name,
      l.action, l.target_type, l.target_id, l.diff,
      CASE l.target_type
        WHEN 'pack' THEN (SELECT p.title FROM packs p WHERE p.id::text = l.target_id)
        WHEN 'character' THEN (SELECT c.name FROM characters c WHERE c.id::text = l.target_id)
        WHEN 'artist' THEN (SELECT a.name FROM artists a WHERE a.id::text = l.target_id)
        WHEN 'tag' THEN (SELECT t.name FROM tags t WHERE t.id::text = l.target_id)
        WHEN 'user' THEN (SELECT x.name FROM users x WHERE x.id = l.target_id)
      END AS target_name
    FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id LEFT JOIN users iu ON iu.id = l.impersonated_by
    WHERE ${where} ORDER BY l.created_at DESC, l.id DESC LIMIT ${pg.size} OFFSET ${pg.offset}`)
  return {
    rows: rows.map((r) => ({
      id: toNum(r.id),
      at: toIso(r.created_at) ?? '',
      actorId: (r.actor_id as string | null) ?? null,
      actorName: (r.actor_name as string | null) ?? null,
      actorRole: (r.actor_role as string | null) ?? null,
      impersonatedBy: (r.impersonated_by as string | null) ?? null,
      impersonatorName: (r.impersonator_name as string | null) ?? null,
      action: String(r.action),
      targetType: (r.target_type as string | null) ?? null,
      targetId: (r.target_id as string | null) ?? null,
      targetName: (r.target_name as string | null) ?? null,
      diff: (r.diff ?? null) as Json,
    })),
    total: toNum(n),
    page: pg.page,
    pages: pg.pages,
    pageSize: pg.size,
  }
}

export async function auditActions(): Promise<string[]> {
  const rows = await many<{ action: string }>(sql`SELECT DISTINCT action FROM audit_logs ORDER BY action LIMIT 200`)
  return rows.map((r) => r.action)
}

// ---------- 系统设置 ----------

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/** Site identity and integration status. Secrets are reported as configured or not, never echoed. */
export async function getSettings(): Promise<SettingsData> {
  const e = env()
  const site = await getSetting('site')
  const [row] = await db()
    .select({ updatedAt: schema.siteSettings.updatedAt, updatedBy: schema.users.name })
    .from(schema.siteSettings)
    .leftJoin(schema.users, eq(schema.users.id, schema.siteSettings.updatedBy))
    .where(eq(schema.siteSettings.key, 'site'))
  return {
    site: { name: site.name, subtitle: site.subtitle, announcement: site.announcement },
    effective: await siteIdentity(),
    defaults: { name: e.SITE_NAME, subtitle: e.SITE_SUBTITLE },
    integrations: {
      cap: { endpoint: e.CAP_API_ENDPOINT, siteKey: e.CAP_SITE_KEY, secretConfigured: Boolean(e.CAP_SECRET_KEY), disabled: e.CAP_DISABLED },
      smtp: { configured: mailConfigured(), from: e.MAIL_FROM ? e.MAIL_FROM.replace(/^.*<([^>]+)>.*$/, '$1') : null },
      storage: { endpointHost: hostOf(e.S3_ENDPOINT), publicEndpointHost: e.S3_PUBLIC_ENDPOINT ? hostOf(e.S3_PUBLIC_ENDPOINT) : null, bucket: e.S3_BUCKET },
      purge: { configured: Boolean(e.CF_ZONE_ID && e.CF_PURGE_TOKEN) },
      siteUrl: e.SITE_URL,
    },
    updatedAt: toIso(row?.updatedAt),
    updatedBy: row?.updatedBy ?? null,
  }
}

/** 站点名称 / 副标题 / 顶部公告. Blank values fall back to SITE_NAME / SITE_SUBTITLE and no announcement. */
export async function saveSiteSettings(actor: Actor, input: { name: string | null; subtitle: string | null; announcement: string | null }) {
  const blank = (v: string | null) => (v == null || v.trim() === '' ? null : v.trim())
  const next = { name: blank(input.name), subtitle: blank(input.subtitle), announcement: blank(input.announcement) }
  const prev = await getSetting('site')
  const diff: Record<string, [unknown, unknown]> = {}
  for (const k of ['name', 'subtitle', 'announcement'] as const) if (prev[k] !== next[k]) diff[k] = [prev[k], next[k]]
  if (!Object.keys(diff).length) return { changed: false, effective: await siteIdentity() }
  await setSetting('site', next, actor.id)
  await audit(actor, 'settings.site', { type: 'setting', id: 'site' }, diff)
  return { changed: true, effective: await siteIdentity() }
}

