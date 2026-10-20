import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { env } from '../env'
import * as schema from './schema'

export type Db = ReturnType<typeof createDb>

export function createDb(url: string, max = 10) {
  const pool = new pg.Pool({ connectionString: url, max, idleTimeoutMillis: 30_000 })
  return Object.assign(drizzle(pool, { schema }), { $pool: pool })
}

let instance: Db | undefined

/** Shared pool for the current process (web or worker). */
export function db(): Db {
  instance ??= createDb(env().DATABASE_URL)
  return instance
}

export async function closeDb() {
  if (instance) {
    await instance.$pool.end()
    instance = undefined
  }
}

export { schema }
