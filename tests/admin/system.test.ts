import { auditRows, setupAdminTests, uniq, userWithRole, type RoleUser } from './harness'
import { TEST_ENV } from '../integration/setup'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { getDashboard } from '#/server/admin/dash'
import { getJobs, getSettings, getStorage, jobAction, listAudit, saveSiteSettings } from '#/server/admin/system'
import { audit } from '#/server/audit'
import { db, schema } from '#/server/db/client'
import { jobSender, stopJobSender } from '#/server/jobs/boss'
import { formatCreditsDate } from '#/server/media/credits'
import { siteIdentity } from '#/server/settings'
import { seedEmoji, seedPack, seedZip } from './seed'

let owner: RoleUser
let manager: RoleUser

beforeAll(async () => {
  await setupAdminTests()
  owner = await userWithRole('admin', 'sys-owner')
  manager = await userWithRole('manager', 'sys-manager')
}, 60_000)

afterAll(async () => {
  await stopJobSender()
})

describe('系统设置', () => {
  test('saving the site name changes siteIdentity at once; blank falls back to SITE_NAME; audited', async () => {
    const res = await saveSiteSettings(owner.actor, { name: '潮汐池', subtitle: '测试副标题', announcement: '公告' })
    expect(res.changed).toBe(true)
    expect(await siteIdentity()).toEqual({ name: '潮汐池', subtitle: '测试副标题' })
    const [a] = await auditRows('settings.site')
    expect(a!.diff).toMatchObject({ name: [null, '潮汐池'] })
    await saveSiteSettings(owner.actor, { name: '  ', subtitle: null, announcement: null })
    expect((await siteIdentity()).name).toBe('潮池')
  })

  test('integration status never contains secret values', async () => {
    const data = await getSettings()
    const text = JSON.stringify(data)
    for (const k of ['AUTH_SECRET', 'IP_HASH_SALT', 'S3_SECRET_ACCESS_KEY', 'CAP_SECRET_KEY', 'S3_ACCESS_KEY_ID']) {
      expect(text).not.toContain(TEST_ENV[k]!)
    }
    expect(data.integrations.cap.secretConfigured).toBe(true)
    expect(data.integrations.purge.configured).toBe(false)
    expect(data.integrations.storage.endpointHost).toBe('127.0.0.1:9000')
  })
})

describe('存储', () => {
  test('aggregates come from emojis and zip_artifacts', async () => {
    const before = await getStorage()
    const pack = await seedPack({ packKey: uniq('storage') })
    await seedEmoji(pack, { bytes: 1000, p240Bytes: 10, a160Bytes: 20 })
    await seedZip(pack)
    const after = await getStorage()
    const g = (d: typeof after, k: string) => d.groups.find((x) => x.key === k)!
    expect(g(after, 'originals').objects - g(before, 'originals').objects).toBe(1)
    expect(g(after, 'originals').bytes! - g(before, 'originals').bytes!).toBe(1000)
    expect(g(after, 'zips').objects - g(before, 'zips').objects).toBe(1)
    expect(g(after, 'a160').bytes! - g(before, 'a160').bytes!).toBe(20)
  })
})

describe('任务队列', () => {
  test('live counts per queue, failed jobs with their error, retry and cancel', async () => {
    const boss = await jobSender()
    const failedId = await boss.send('zip.build', { packId: -1 })
    await db().execute(sql`UPDATE pgboss.job SET state = 'failed', completed_on = now(), output = '{"message":"boom"}'::jsonb WHERE id = ${failedId}::uuid`)
    const queuedId = await boss.send('media.ingest', { uploadItemId: crypto.randomUUID() })
    const data = await getJobs()
    const zipQ = data.queues.find((q) => q.name === 'zip.build')!
    expect(zipQ.counts.failed).toBeGreaterThanOrEqual(1)
    const f = data.failed.find((j) => j.id === failedId)!
    expect(f.output).toEqual({ message: 'boom' })
    expect(data.active.some((j) => j.id === queuedId)).toBe(true)
    expect(data.schedules.map((s) => s.name)).toContain('db.backup')
    expect(data.schedules.find((s) => s.name === 'db.backup')!.nextRuns.length).toBeGreaterThan(0)

    await jobAction(owner.actor, { name: 'zip.build', id: failedId! }, 'retry')
    const [st] = (await db().execute(sql`SELECT state::text AS s FROM pgboss.job WHERE id = ${failedId}::uuid`)).rows as { s: string }[]
    expect(st!.s).toBe('retry')
    await jobAction(owner.actor, { name: 'media.ingest', id: queuedId! }, 'cancel')
    const [st2] = (await db().execute(sql`SELECT state::text AS s FROM pgboss.job WHERE id = ${queuedId}::uuid`)).rows as { s: string }[]
    expect(st2!.s).toBe('cancelled')
    expect(await auditRows('job.retry', failedId!)).toHaveLength(1)
    expect(await auditRows('job.cancel', queuedId!)).toHaveLength(1)
    const bad = await jobAction(owner.actor, { name: 'media.ingest', id: queuedId! }, 'cancel').catch((e) => e)
    expect(bad.status).toBe(400)
  })
})

describe('审计日志 and 仪表盘', () => {
  test('audit filters: actor, action prefix, target, date', async () => {
    await audit(manager.actor, 'test.audit.one', { type: 'pack', id: 42 }, { title: ['a', 'b'] })
    await audit(owner.actor, 'test.audit.two', { type: 'user', id: 'x' })
    const byActor = await listAudit({ actor: manager.id, action: 'test.audit' })
    expect(byActor.rows.map((r) => r.action)).toEqual(['test.audit.one'])
    expect(byActor.rows[0]!.actorName).toBe('sys-manager')
    expect((await listAudit({ action: 'test.audit', targetType: 'user' })).rows.map((r) => r.action)).toEqual(['test.audit.two'])
    const today = formatCreditsDate(new Date())
    expect((await listAudit({ action: 'test.audit', from: today, to: today })).total).toBe(2)
    expect((await listAudit({ action: 'test.audit', to: '2020-01-01' })).total).toBe(0)
  })

  test('dashboard figures come from the database; managers only see their own activity', async () => {
    const today = formatCreditsDate(new Date())
    await db().insert(schema.downloadCounters).values([
      { subject: `ip:${uniq('a')}`, day: today, kind: 'orig', n: 5 },
      { subject: `ip:${uniq('b')}`, day: today, kind: 'batch_item', n: 7 },
      { subject: `ip:${uniq('c')}`, day: today, kind: 'zip', n: 2 },
    ])
    await db().insert(schema.downloadStatsDaily).values({ day: today, kind: 'orig', subjectCount: 1, n: 3 }).onConflictDoNothing()
    const d = await getDashboard(owner.actor)
    expect(d.originalsToday).toBeGreaterThanOrEqual(12)
    expect(d.zipsToday).toBeGreaterThanOrEqual(2)
    expect(d.downloads30).toHaveLength(30)
    expect(d.downloads30.at(-1)!.day).toBe(today)
    expect(d.recentScope).toBe('all')
    const m = await getDashboard(manager.actor)
    expect(m.recentScope).toBe('mine')
    expect(m.recent.every((r) => r.actorId === manager.id)).toBe(true)
  })
})
