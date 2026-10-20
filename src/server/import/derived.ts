import { and, asc, desc, eq } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import { db, schema } from '../db/client'
import { type JobData, Q } from '../jobs/queues'

// Queue p240/a160 generation (media.derive, target 'derived') for published emojis of published packs
// that have no web derivatives yet. The queue is `exclusive` with singletonKey = emoji id, so running
// this again while jobs are still waiting adds nothing. Jobs go in 500 at a time, most downloaded packs
// first (order holds between batches; pg-boss picks randomly inside one). Priority -1 lets review
// previews for fresh uploads (priority 0) overtake a backfill that runs for hours.

export const BACKFILL_PRIORITY = -1

export type DeriveJob = { data: JobData['media.derive']; singletonKey: string; priority: number }

/** Inserts jobs and returns how many were actually added (duplicates of queued jobs are dropped). */
export type InsertDeriveJobs = (jobs: DeriveJob[]) => Promise<number>

export function bossDeriveInserter(boss: Pick<PgBoss, 'insert'>): InsertDeriveJobs {
  // returnId: ids of the rows actually inserted (insert ends in ON CONFLICT DO NOTHING)
  return async (jobs) => (await boss.insert(Q.derive, jobs, { returnId: true }))?.length ?? 0
}

export async function backfillDerived(
  opts: { packKey?: string; limit?: number },
  insert: InsertDeriveJobs,
): Promise<{ candidates: number; enqueued: number }> {
  const { emojis, packs } = schema
  const conditions = [eq(emojis.status, 'published'), eq(packs.status, 'published'), eq(emojis.derivedReady, false)]
  if (opts.packKey) conditions.push(eq(packs.packKey, opts.packKey))
  const query = db()
    .select({ id: emojis.id })
    .from(emojis)
    .innerJoin(packs, eq(packs.id, emojis.packId))
    .where(and(...conditions))
    .orderBy(desc(packs.downloadCount), asc(packs.id), asc(emojis.sortOrder), asc(emojis.id))
  const rows = opts.limit != null ? await query.limit(opts.limit) : await query
  let enqueued = 0
  for (let i = 0; i < rows.length; i += 500) {
    const jobs = rows
      .slice(i, i + 500)
      .map((r) => ({ data: { emojiId: r.id, target: 'derived' as const }, singletonKey: r.id, priority: BACKFILL_PRIORITY }))
    enqueued += await insert(jobs)
  }
  return { candidates: rows.length, enqueued }
}
