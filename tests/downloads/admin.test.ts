import { signUp } from '../integration/setup'
import { beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import {
  downloadsPatch,
  readDownloadSettings,
  riskOverview,
  saveDownloadSettings,
  setSourceMode,
  sourceModeInput,
  suspiciousSources,
} from '#/server/downloads/risk'
import { pgPolicyDeps } from '#/server/downloads/store'
import { getSetting } from '#/server/settings'
import { can } from '#/shared/roles'
import { ready, RUN, useSettings } from './fixture'

// 下载与风控 data (src/server/downloads/risk.ts) against PostgreSQL. A fixed clock in November keeps
// these rows apart from the ones the route tests write for the real date.

const NOW = new Date('2026-11-15T04:00:00Z') // 12:00 Asia/Shanghai
const TODAY = '2026-11-15'
const YESTERDAY = '2026-11-14'
let actor: { id: string; role: 'admin'; impersonatedBy: null }

beforeAll(async () => {
  await ready()
  const u = await signUp('dl-admin')
  actor = { id: u.id, role: 'admin', impersonatedBy: null }
  await useSettings()
}, 120_000)

const auditRows = (action: string, targetId: string) =>
  db()
    .select()
    .from(schema.auditLogs)
    .where(and(eq(schema.auditLogs.action, action), eq(schema.auditLogs.targetId, targetId)))
    .orderBy(desc(schema.auditLogs.id))

describe('admin server functions', () => {
  test('every server function in admin-fns.ts requires the downloads permission (站长 only)', async () => {
    const src = await Bun.file(join(import.meta.dir, '..', '..', 'src', 'server', 'downloads', 'admin-fns.ts')).text()
    const fns = src.match(/createServerFn\(/g) ?? []
    const guarded = src.match(/\.middleware\(\[requirePerm\('downloads'\)\]\)/g) ?? []
    expect(fns.length).toBe(5)
    expect(guarded.length).toBe(fns.length)
    expect(can('admin', 'downloads')).toBe(true)
    expect(can('manager', 'downloads')).toBe(false)
    expect(can('user', 'downloads')).toBe(false)
  })
})

describe('risk settings', () => {
  test('a partial save merges, validates, invalidates the cache and writes one audit row with the diff', async () => {
    const before = (await auditRows('settings.downloads.update', 'downloads')).length
    const saved = await saveDownloadSettings(actor, { perIpOriginalsPerDay: 100, originalsRequireLogin: true })
    expect(saved).toMatchObject({ perIpOriginalsPerDay: 100, originalsRequireLogin: true, singleSignsPerMinute: 60, challengeSuspicious: true })
    expect(await readDownloadSettings()).toEqual(saved)
    expect(await getSetting('downloads')).toEqual(saved)
    const [row] = await db().select().from(schema.siteSettings).where(eq(schema.siteSettings.key, 'downloads'))
    expect(row!.updatedBy).toBe(actor.id)

    const rows = await auditRows('settings.downloads.update', 'downloads')
    expect(rows.length).toBe(before + 1)
    expect(rows[0]).toMatchObject({
      actorId: actor.id,
      actorRole: 'admin',
      targetType: 'setting',
      diff: { perIpOriginalsPerDay: [null, 100], originalsRequireLogin: [false, true] },
    })
  })

  test('null clears a limit (unlimited); saving the same values writes nothing', async () => {
    const cleared = await saveDownloadSettings(actor, { perIpOriginalsPerDay: null, originalsRequireLogin: false })
    expect(cleared.perIpOriginalsPerDay).toBeNull()
    const n = (await auditRows('settings.downloads.update', 'downloads')).length
    expect((await auditRows('settings.downloads.update', 'downloads'))[0]!.diff).toEqual({ perIpOriginalsPerDay: [100, null], originalsRequireLogin: [true, false] })
    await saveDownloadSettings(actor, { perIpOriginalsPerDay: null })
    await saveDownloadSettings(actor, {})
    expect((await auditRows('settings.downloads.update', 'downloads')).length).toBe(n)
  })

  test('the patch schema rejects unknown keys and invalid limits; omitted keys get no defaults', () => {
    expect(downloadsPatch.safeParse({ perIpOriginalsPerDay: 5 })).toEqual({ success: true, data: { perIpOriginalsPerDay: 5 } })
    expect(downloadsPatch.safeParse({ perIpOriginalsPerDay: null }).success).toBe(true)
    for (const bad of [{ perIpOriginalsPerDay: 0 }, { perIpOriginalsPerDay: -1 }, { perIpOriginalsPerDay: 1.5 }, { singleSignsPerMinute: '60' }, { pauseZipAndBatch: 'yes' }, { unknown: 1 }]) {
      expect(downloadsPatch.safeParse(bad).success).toBe(false)
    }
  })
})

describe('setSourceMode', () => {
  const subject = `ip:${'a'.repeat(24)}${RUN}`

  test('block with until and reason, then watch, then release: blocked_sources and audit follow', async () => {
    const until = new Date(Date.now() + 3600_000).toISOString()
    const blocked = await setSourceMode(actor, sourceModeInput.parse({ subject, mode: 'block', until, reason: '连续顺序抓取' }))
    expect(blocked).toEqual({ subject, mode: 'block', until, reason: '连续顺序抓取' })
    const [row] = await db().select().from(schema.blockedSources).where(eq(schema.blockedSources.subject, subject))
    expect(row).toMatchObject({ mode: 'block', reason: '连续顺序抓取', createdBy: actor.id })
    expect((await pgPolicyDeps.sources([subject]))[0]).toMatchObject({ mode: 'block' })

    await setSourceMode(actor, sourceModeInput.parse({ subject, mode: 'watch' }))
    expect((await db().select().from(schema.blockedSources).where(eq(schema.blockedSources.subject, subject)))[0]).toMatchObject({ mode: 'watch', until: null, reason: null })

    expect(await setSourceMode(actor, sourceModeInput.parse({ subject, mode: 'none' }))).toBeNull()
    expect(await db().$count(schema.blockedSources, eq(schema.blockedSources.subject, subject))).toBe(0)
    // releasing again changes nothing and is not logged
    await setSourceMode(actor, sourceModeInput.parse({ subject, mode: 'none' }))

    const rows = (await auditRows('downloads.source.set', subject)).reverse()
    expect(rows.map((r) => r.diff)).toEqual([
      { before: null, after: { subject, mode: 'block', until, reason: '连续顺序抓取' } },
      { before: { subject, mode: 'block', until, reason: '连续顺序抓取' }, after: { subject, mode: 'watch', until: null, reason: null } },
      { before: { subject, mode: 'watch', until: null, reason: null }, after: null },
    ])
    expect(rows.every((r) => r.actorId === actor.id && r.targetType === 'source')).toBe(true)
  })

  test('input validation: subject format, mode, until in the future', () => {
    const ok = sourceModeInput.safeParse({ subject: `user:${actor.id}`, mode: 'watch' })
    expect(ok.success).toBe(true)
    for (const bad of [
      { subject: 'ip:not-a-hash', mode: 'block' },
      { subject: 'someone', mode: 'block' },
      { subject, mode: 'ban' },
      { subject, mode: 'block', until: '2020-01-01T00:00:00Z' },
      { subject, mode: 'block', until: 'tomorrow' },
    ]) {
      expect(sourceModeInput.safeParse(bad).success).toBe(false)
    }
  })
})

describe('riskOverview', () => {
  const ipA = `ip:${'b'.repeat(24)}${RUN}`
  const ipB = `ip:${'c'.repeat(24)}${RUN}`

  beforeAll(async () => {
    const stats: (typeof schema.downloadStatsDaily.$inferInsert)[] = []
    for (let d = 1; d <= 13; d++) stats.push({ day: `2026-11-${String(d).padStart(2, '0')}`, kind: 'orig', subjectCount: 1, n: 10 })
    stats.push({ day: '2026-10-31', kind: 'orig', subjectCount: 1, n: 1000 }) // previous month: not included
    stats.push({ day: YESTERDAY, kind: 'orig', subjectCount: 1, n: 10 }) // the last rollup of yesterday missed some
    stats.push({ day: TODAY, kind: 'orig', subjectCount: 1, n: 3 }) // rolled up an hour ago
    stats.push({ day: TODAY, kind: 'zip', subjectCount: 1, n: 1 })
    await db().insert(schema.downloadStatsDaily).values(stats).onConflictDoNothing()
    const live = [
      { subject: ipA, day: YESTERDAY, kind: 'orig' as const, n: 12 },
      { subject: ipA, day: TODAY, kind: 'orig' as const, n: 5 },
      { subject: ipA, day: TODAY, kind: 'batch_item' as const, n: 7 },
      { subject: ipB, day: TODAY, kind: 'zip' as const, n: 2 },
      { subject: ipB, day: TODAY, kind: 'batch' as const, n: 1 },
    ]
    await db().insert(schema.downloadCounters).values(live)
    await pgPolicyDeps.flag([ipA], 'throttled', TODAY)
    await pgPolicyDeps.flag([ipA, `user:${actor.id}`], 'throttled', TODAY)
    await pgPolicyDeps.flag([ipB], 'throttled', TODAY)
    await pgPolicyDeps.flag([ipB], 'throttled', YESTERDAY) // not today
  })

  test('today from live counters, the month from rolled-up stats, the larger of the two per day', async () => {
    const o = await riskOverview(NOW)
    expect(o.day).toBe(TODAY)
    expect(o.todayOriginals).toBe(12)
    expect(o.yesterdayOriginals).toBe(12)
    expect(o.todayPacks).toBe(3)
    expect(o.monthToDate.from).toBe('2026-11-01')
    expect(o.monthToDate.to).toBe(TODAY)
    expect(o.monthToDate.byKind).toEqual({ orig: 13 * 10 + 12 + 5, batch_item: 7, batch: 1, zip: 2 })
    // R2 reads: originals and ZIPs (orig + batch_item + zip), as in the r2.alert job
    expect(o.monthToDate.r2Reads).toBe(147 + 7 + 2)
    expect(o.monthToDate.threshold).toBe(9_000_000)
    // throttle events are counted once per request (IP rows only)
    expect(o.throttled).toEqual({ events: 3, ips: 2 })
  })
})

describe('suspiciousSources', () => {
  const ipHot = `ip:${'d'.repeat(24)}${RUN}`
  const ipFlagged = `ip:${'e'.repeat(24)}${RUN}`
  const ipListed = `ip:${'f'.repeat(24)}${RUN}`
  let userSubject = ''

  beforeAll(async () => {
    userSubject = `user:${actor.id}`
    await db()
      .insert(schema.downloadCounters)
      .values([
        { subject: ipHot, day: TODAY, kind: 'orig', n: 9000 },
        { subject: ipHot, day: YESTERDAY, kind: 'batch_item', n: 120 },
        { subject: ipHot, day: '2026-11-13', kind: 'orig', n: 99_999 }, // older than a day: ignored
        { subject: userSubject, day: TODAY, kind: 'orig', n: 40 },
      ])
    for (let i = 0; i < 3; i++) await pgPolicyDeps.flag([ipHot], 'burst', TODAY)
    await pgPolicyDeps.flag([ipFlagged], 'noref', YESTERDAY)
    await db().insert(schema.blockedSources).values({ subject: ipListed, mode: 'block', reason: '人工封禁', until: null, createdBy: actor.id })
  })

  test('top subjects by counters of today and yesterday, with features and list state', async () => {
    const list = await suspiciousSources({ now: NOW, limit: 50 })
    const mine = list.filter((s) => [ipHot, ipFlagged, ipListed, userSubject].includes(s.subject))
    expect(mine.map((s) => s.subject)).toEqual([ipHot, userSubject, ipFlagged, ipListed])
    expect(mine[0]).toMatchObject({
      kind: 'ip',
      label: `IP 哈希 dddd…${RUN.slice(-2)}`,
      originals: 9120,
      packs: 0,
      total: 9120,
      features: { burst: 3, noReferer: 0 },
      mode: null,
      active: false,
    })
    expect(mine[1]).toMatchObject({ kind: 'user', label: 'dl-admin', originals: 40 })
    expect(mine[2]).toMatchObject({ total: 0, features: { noReferer: 1 } })
    expect(mine[3]).toMatchObject({ mode: 'block', reason: '人工封禁', active: true, total: 0 })
    // the most active subjects come first overall
    expect(list[0]!.total).toBeGreaterThanOrEqual(list[list.length - 1]!.total)
  })

  test('the limit caps the counter and flag candidates', async () => {
    const list = await suspiciousSources({ now: NOW, limit: 1 })
    expect(list.some((s) => s.subject === ipHot)).toBe(true)
    const listedAll = await db().select().from(schema.blockedSources)
    expect(list.length).toBeLessThanOrEqual(2 + listedAll.length)
    expect(await db().$count(schema.blockedSources, inArray(schema.blockedSources.subject, [ipListed]))).toBe(1)
  })
})
