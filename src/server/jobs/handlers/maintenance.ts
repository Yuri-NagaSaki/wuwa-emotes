import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { log } from '../../log'
import { pruneWindows } from '../../ratelimit'

/** Hourly: fold today's and yesterday's UNLOGGED counters into download_stats_daily (idempotent upsert). */
export async function rollupStats() {
  await db().execute(sql`
    INSERT INTO download_stats_daily (day, kind, subject_count, n)
    SELECT day, kind, count(DISTINCT subject), sum(n)
    FROM download_counters
    WHERE day >= (now() AT TIME ZONE 'Asia/Shanghai')::date - 1
    GROUP BY day, kind
    ON CONFLICT (day, kind) DO UPDATE
      SET subject_count = GREATEST(download_stats_daily.subject_count, EXCLUDED.subject_count),
          n = GREATEST(download_stats_daily.n, EXCLUDED.n)
  `)
  // counters older than two days are no longer needed for limits
  await db().execute(sql`DELETE FROM download_counters WHERE day < (now() AT TIME ZONE 'Asia/Shanghai')::date - 2`)
}

/** Daily housekeeping that needs no other module. Submission file cleanup is added by the submissions lane. */
export async function dailyCleanup() {
  await pruneWindows(3600)
  log().info('cleanup: rate windows pruned')
  await (await import('../../submissions/cleanup')).cleanupSubmissions()
}
