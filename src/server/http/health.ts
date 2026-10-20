import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { log } from '../log'

const DB_TIMEOUT_MS = 2000

/** `select 1` against the pool, bounded so a hung database fails the probe instead of hanging it. */
export async function checkHealth(): Promise<{ ok: boolean; db: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      db().execute(sql`select 1`),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`database did not answer within ${DB_TIMEOUT_MS} ms`)), DB_TIMEOUT_MS)
      }),
    ])
    return { ok: true, db: true }
  } catch (err) {
    log().warn({ err: (err as Error).message }, 'health: database check failed')
    return { ok: false, db: false }
  } finally {
    clearTimeout(timer)
  }
}
