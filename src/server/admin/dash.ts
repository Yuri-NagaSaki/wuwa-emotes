import { sql } from 'drizzle-orm'
import { formatCreditsDate } from '../media/credits'
import { type Actor, many, thumbFromRow, toIso, toNum } from './common'
import { listAudit, r2ReadsThisMonth } from './system'
import { needsCleanSlug } from './taxonomy'
import type { DashboardData } from './types'

// 仪表盘. Every figure comes from the database; there is no visitor data source, so no visitor KPI.

/** 原图 = single originals + the items of batch ZIPs (the same kinds the daily original limit counts). */
const ORIGINAL_KINDS = ['orig', 'batch_item']

export async function getDashboard(actor: Actor, now = new Date()): Promise<DashboardData> {
  const today = formatCreditsDate(now)
  const kinds = sql.join(ORIGINAL_KINDS.map((k) => sql`${k}`), sql`, `)
  // live counters for today; the hourly rollup may hold more if the UNLOGGED table was emptied by a crash
  const [live] = await many<{ orig: string; zip: string }>(sql`
    SELECT coalesce(sum(n) FILTER (WHERE kind IN (${kinds})), 0) AS orig, coalesce(sum(n) FILTER (WHERE kind = 'zip'), 0) AS zip
    FROM download_counters WHERE day = ${today}::date`)
  const [rolled] = await many<{ orig: string; zip: string }>(sql`
    SELECT coalesce(sum(n) FILTER (WHERE kind IN (${kinds})), 0) AS orig, coalesce(sum(n) FILTER (WHERE kind = 'zip'), 0) AS zip
    FROM download_stats_daily WHERE day = ${today}::date`)
  const days = await many<{ day: string; n: string }>(sql`
    SELECT d::date::text AS day, coalesce((SELECT sum(s.n) FROM download_stats_daily s WHERE s.day = d::date AND s.kind IN (${kinds}, 'zip')), 0) AS n
    FROM generate_series(${today}::date - 29, ${today}::date, interval '1 day') d ORDER BY d`)
  const [subs] = await many<{ n: number; who: number; oldest: Date | null }>(sql`
    SELECT count(*)::int AS n, count(DISTINCT submitter_id)::int AS who, min(submitted_at) AS oldest FROM submissions WHERE status = 'pending'`)
  const [cm] = await many<{ n: number; oldest: Date | null }>(sql`
    SELECT count(*)::int AS n, min(created_at) AS oldest FROM comments WHERE status = 'pending' AND deleted_at IS NULL`)
  const [rep] = await many<{ n: number }>(sql`SELECT count(DISTINCT comment_id)::int AS n FROM comment_reports WHERE resolved_at IS NULL`)
  const [reg] = await many<{ today: number; week: number }>(sql`
    SELECT count(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Shanghai')::date = ${today}::date)::int AS today,
           count(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Shanghai')::date > ${today}::date - 7)::int AS week
    FROM users`)
  const slugs = await many<{ kind: string; slug: string }>(sql`SELECT 'c' AS kind, slug FROM characters UNION ALL SELECT 'a', slug FROM artists`)
  const top = await many<{ id: number; title: string; download_count: string; cover: Parameters<typeof thumbFromRow>[0] | null }>(sql`
    SELECT p.id, p.title, p.download_count,
      (SELECT row_to_json(x) FROM (SELECT e.id, e.storage_pack_key, e.variant_rev, e.status, e.derived_ready, e.p240_bytes FROM emojis e
        WHERE e.pack_id = p.id AND e.status = 'published' ORDER BY (e.id = p.cover_emoji_id) IS TRUE DESC, e.sort_order, e.id LIMIT 1) x) AS cover
    FROM packs p WHERE p.status = 'published' AND p.download_count > 0 ORDER BY p.download_count DESC LIMIT 6`)
  const scope = actor.role === 'admin' ? 'all' : 'mine'
  const recent = await listAudit({ page: 1 }, { onlyActor: scope === 'mine' ? actor.id : undefined, pageSize: 8 })
  const r2 = await r2ReadsThisMonth(now)
  return {
    generatedAt: now.toISOString(),
    today,
    originalsToday: Math.max(toNum(live?.orig), toNum(rolled?.orig)),
    zipsToday: Math.max(toNum(live?.zip), toNum(rolled?.zip)),
    downloads30: days.map((d) => ({ day: d.day, n: toNum(d.n) })),
    pendingSubmissions: { count: toNum(subs?.n), submitters: toNum(subs?.who), oldest: toIso(subs?.oldest) },
    pendingComments: { count: toNum(cm?.n), oldest: toIso(cm?.oldest) },
    openReports: toNum(rep?.n),
    r2Reads: { month: r2.month, threshold: r2.threshold },
    registrations: { today: toNum(reg?.today), week: toNum(reg?.week) },
    hashSlugs: {
      characters: slugs.filter((s) => s.kind === 'c' && needsCleanSlug(s.slug)).length,
      artists: slugs.filter((s) => s.kind === 'a' && needsCleanSlug(s.slug)).length,
    },
    topPacks: top.map((t) => ({ id: toNum(t.id), title: t.title, downloads: toNum(t.download_count), thumb: t.cover ? thumbFromRow(t.cover) : null })),
    recent: recent.rows,
    recentScope: scope,
  }
}
