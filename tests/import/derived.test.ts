import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, inArray, sql } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { db, schema } from '../../src/server/db/client'
import { env } from '../../src/server/env'
import { BACKFILL_PRIORITY, backfillDerived, bossDeriveInserter, type InsertDeriveJobs } from '../../src/server/import/derived'
import { importV1 } from '../../src/server/import/v1'
import { ensureQueues } from '../../src/server/jobs/boss'
import { Q } from '../../src/server/jobs/queues'
import { emptyBucket, resetDb, setupTestEnv } from '../media/helpers'
import { type FixtureEmoji, PACK, uploadV1Fixture } from './fixture'

let boss: PgBoss
let insert: InsertDeriveJobs
let fixture: { emojis: FixtureEmoji[] }

async function queuedDeriveJobs() {
  const rows = await db().execute<{ singleton_key: string; priority: number; data: { emojiId: string; target: string } }>(
    sql`SELECT singleton_key, priority, data FROM pgboss.job WHERE name = ${Q.derive} AND state = 'created' ORDER BY created_on, id`,
  )
  return rows.rows
}

beforeAll(async () => {
  await setupTestEnv()
  await resetDb()
  await emptyBucket()
  fixture = await uploadV1Fixture()
  await importV1()
  boss = new PgBoss({ connectionString: env().DATABASE_URL, max: 2, schedule: false, supervise: false })
  boss.on('error', () => {})
  await boss.start()
  await ensureQueues(boss)
  await boss.deleteAllJobs(Q.derive)
  insert = bossDeriveInserter(boss)
})

afterAll(async () => {
  await boss?.stop({ graceful: false })
})

describe('backfill-derived', () => {
  test('queues one derive job per published emoji, keyed by emoji id', async () => {
    const r = await backfillDerived({}, insert)
    expect(r).toEqual({ candidates: 20, enqueued: 20 })
    const jobs = await queuedDeriveJobs()
    expect(jobs.length).toBe(20)
    for (const j of jobs) {
      expect(j.data.target).toBe('derived')
      expect(j.singleton_key).toBe(j.data.emojiId)
      // below fresh uploads' review previews (priority 0)
      expect(j.priority).toBe(BACKFILL_PRIORITY)
    }
    expect(new Set(jobs.map((j) => j.data.emojiId))).toEqual(new Set(fixture.emojis.map((e) => e.id)))
  })

  test('running again while jobs wait adds nothing', async () => {
    expect(await backfillDerived({}, insert)).toEqual({ candidates: 20, enqueued: 0 })
    expect((await queuedDeriveJobs()).length).toBe(20)
  })

  test('--pack and --limit narrow the selection; ready, hidden and pending rows are skipped', async () => {
    await boss.deleteAllJobs(Q.derive)
    const aimisi = fixture.emojis.filter((e) => e.packKey === PACK.aimisi).map((e) => e.id)
    expect(await backfillDerived({ packKey: PACK.aimisi }, insert)).toEqual({ candidates: 6, enqueued: 6 })
    expect(await backfillDerived({ limit: 3 }, insert)).toEqual({ candidates: 3, enqueued: 3 })

    await boss.deleteAllJobs(Q.derive)
    await db().update(schema.emojis).set({ derivedReady: true }).where(eq(schema.emojis.id, aimisi[0]!))
    await db().update(schema.emojis).set({ status: 'pending' }).where(eq(schema.emojis.id, aimisi[1]!))
    await db().update(schema.emojis).set({ status: 'hidden' }).where(eq(schema.emojis.id, aimisi[2]!))
    await db().update(schema.packs).set({ status: 'hidden' }).where(eq(schema.packs.packKey, PACK.official))
    const r = await backfillDerived({}, insert)
    expect(r).toEqual({ candidates: 20 - 3 - 3, enqueued: 14 })
    const ids = new Set((await queuedDeriveJobs()).map((j) => j.data.emojiId))
    expect(aimisi.slice(0, 3).some((id) => ids.has(id))).toBe(false)
    const official = fixture.emojis.filter((e) => e.packKey === PACK.official).map((e) => e.id)
    expect(official.some((id) => ids.has(id))).toBe(false)
    // restore for anything that runs later
    await db().update(schema.emojis).set({ derivedReady: false, status: 'published' }).where(inArray(schema.emojis.id, aimisi))
  })
})
