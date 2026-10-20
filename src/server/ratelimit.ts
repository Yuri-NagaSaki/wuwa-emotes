import { sql } from 'drizzle-orm'
import { db, schema } from './db/client'

/**
 * Fixed-window counter in the UNLOGGED rate_windows table. Returns the count after this hit;
 * the caller compares with its limit (so a blank/unlimited setting can skip the call entirely).
 */
export async function hitWindow(subject: string, bucket: string, windowSeconds: number, amount = 1): Promise<number> {
  const windowStartMs = Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000
  const rows = await db()
    .insert(schema.rateWindows)
    .values({ subject, bucket, windowStart: new Date(windowStartMs), n: amount })
    .onConflictDoUpdate({
      target: [schema.rateWindows.subject, schema.rateWindows.bucket, schema.rateWindows.windowStart],
      set: { n: sql`${schema.rateWindows.n} + ${amount}` },
    })
    .returning({ n: schema.rateWindows.n })
  return rows[0]?.n ?? amount
}

export async function pruneWindows(olderThanSeconds = 3600) {
  await db().execute(sql`DELETE FROM rate_windows WHERE window_start < now() - make_interval(secs => ${olderThanSeconds})`)
}
