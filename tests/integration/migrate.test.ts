import { DATABASE_URL, DB_NAME, freshDatabase, mainDatabase, withClient } from './setup'
import { describe, expect, test } from 'bun:test'

describe('migrations', () => {
  test(
    'apply to a fresh database through src/migrate.ts',
    async () => {
      const run = await mainDatabase()
      expect(run.output).toContain('migrate: database schema up to date')
      expect(run.exitCode).toBe(0)
    },
    { timeout: 60_000 },
  )

  test('create the schema, the last-admin trigger and the pg-boss queues', async () => {
    await mainDatabase()
    await withClient(DATABASE_URL, async (c) => {
      const tables = (await c.query(`select table_name from information_schema.tables where table_schema = 'public'`)).rows.map((r) => r.table_name)
      for (const t of ['users', 'sessions', 'accounts', 'verifications', 'rate_limits', 'packs', 'emojis', 'submissions', 'audit_logs', 'site_settings']) {
        expect(tables).toContain(t)
      }
      const trg = await c.query(`select tgname from pg_trigger where tgrelid = 'users'::regclass and not tgisinternal`)
      expect(trg.rows.map((r) => r.tgname)).toContain('users_keep_last_admin')
      const ext = await c.query(`select extname from pg_extension where extname = 'pg_trgm'`)
      expect(ext.rowCount).toBe(1)
      const queues = (await c.query(`select name from pgboss.queue`)).rows.map((r) => r.name)
      expect(queues).toEqual(expect.arrayContaining(['media.full', 'media.derive', 'media.ingest']))
      const unlogged = await c.query(`select relname from pg_class where relpersistence = 'u' and relkind = 'r' order by relname`)
      expect(unlogged.rows.map((r) => r.relname)).toEqual(expect.arrayContaining(['download_counters', 'rate_windows']))
    })
  })

  test(
    'are idempotent (a second run is a no-op)',
    async () => {
      await mainDatabase()
      const proc = Bun.spawn(['bun', 'src/migrate.ts'], { cwd: `${import.meta.dir}/../..`, env: { ...process.env }, stdout: 'pipe', stderr: 'pipe' })
      expect(await proc.exited).toBe(0)
    },
    { timeout: 60_000 },
  )

  test('refuse to touch databases that are not disposable', async () => {
    await expect(freshDatabase('chaochi')).rejects.toThrow(/refusing/)
    await expect(freshDatabase('postgres')).rejects.toThrow(/refusing/)
    expect(DB_NAME).toMatch(/^chaochi_/)
  })
})
