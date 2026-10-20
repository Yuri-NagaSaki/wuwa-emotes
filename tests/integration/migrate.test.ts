import { DATABASE_URL, DB_NAME, dbUrl, freshDatabase, mainDatabase, ROOT, TEST_ENV, withClient } from './setup'
import { describe, expect, test } from 'bun:test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

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

const COMMENT_INDEXES = ['comments_author_idx', 'comments_ip_hash_idx', 'comments_parent_idx']
const JOURNAL_LENGTH = (JSON.parse(readFileSync(join(ROOT, 'drizzle', 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] }).entries.length

/** A fresh database migrated through the migrations whose tags are listed (an earlier release). */
async function databaseAt(name: string, tags: string[]): Promise<string> {
  const url = dbUrl(name)
  await withClient(dbUrl('postgres'), async (c) => {
    await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await c.query(`CREATE DATABASE "${name}"`)
  })
  const dir = mkdtempSync(join(tmpdir(), 'chaochi-mig-'))
  try {
    mkdirSync(join(dir, 'meta'))
    const journal = JSON.parse(readFileSync(join(ROOT, 'drizzle', 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string; idx: number }[] }
    journal.entries = journal.entries.filter((e) => tags.includes(e.tag))
    for (const e of journal.entries) {
      copyFileSync(join(ROOT, 'drizzle', `${e.tag}.sql`), join(dir, `${e.tag}.sql`))
      const snap = `${String(e.idx).padStart(4, '0')}_snapshot.json`
      copyFileSync(join(ROOT, 'drizzle', 'meta', snap), join(dir, 'meta', snap))
    }
    writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal))
    const pool = new pg.Pool({ connectionString: url })
    try {
      await migrate(drizzle(pool), { migrationsFolder: dir })
    } finally {
      await pool.end()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return url
}

async function migrateToLatest(url: string): Promise<void> {
  const proc = Bun.spawn(['bun', 'src/migrate.ts'], { cwd: ROOT, env: { ...process.env, ...TEST_ENV, DATABASE_URL: url, LOG_LEVEL: 'info' }, stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  expect(code, out + err).toBe(0)
}

async function commentIndexes(url: string): Promise<string[]> {
  return withClient(url, async (c) => {
    const r = await c.query(`select indexname from pg_indexes where tablename = 'comments' and indexname = any($1) order by indexname`, [COMMENT_INDEXES])
    return r.rows.map((x) => x.indexname as string)
  })
}

describe('0001_comment_indexes', () => {
  test('a fresh database gets the comment indexes', async () => {
    await mainDatabase()
    expect(await commentIndexes(DATABASE_URL)).toEqual(COMMENT_INDEXES)
  })

  test(
    'upgrades a database migrated to 0000 that already has comments (expand only)',
    async () => {
      const name = `${DB_NAME}_upgrade`
      const url = dbUrl(name)
      await withClient(dbUrl('postgres'), async (c) => {
        await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
        await c.query(`CREATE DATABASE "${name}"`)
      })
      // the release before this one: only 0000 in the journal
      const dir = mkdtempSync(join(tmpdir(), 'chaochi-0000-'))
      try {
        mkdirSync(join(dir, 'meta'))
        copyFileSync(join(ROOT, 'drizzle', '0000_init.sql'), join(dir, '0000_init.sql'))
        copyFileSync(join(ROOT, 'drizzle', 'meta', '0000_snapshot.json'), join(dir, 'meta', '0000_snapshot.json'))
        const journal = JSON.parse(readFileSync(join(ROOT, 'drizzle', 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
        journal.entries = journal.entries.filter((e) => e.tag === '0000_init')
        writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal))
        const pool = new pg.Pool({ connectionString: url })
        try {
          await migrate(drizzle(pool), { migrationsFolder: dir })
        } finally {
          await pool.end()
        }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
      expect(await commentIndexes(url)).toEqual([])
      await withClient(url, async (c) => {
        await c.query(`insert into users (id, name, email) values ('u-upgrade', 'upgrade', 'upgrade@test.chaochi')`)
        const root = await c.query(
          `insert into comments (thread_type, thread_id, author_id, body_src, status, ip_hash) values ('pack', '1', 'u-upgrade', 'first', 'published', 'h1') returning id`,
        )
        await c.query(
          `insert into comments (thread_type, thread_id, parent_id, root_id, guest_name, body_src, status, ip_hash)
           values ('pack', '1', $1, $1, 'guest', 'reply', 'pending', 'h2'), ('emoji', 'r-00000000000000000001', null, null, 'guest', 'other', 'published', 'h2')`,
          [root.rows[0].id],
        )
      })

      const proc = Bun.spawn(['bun', 'src/migrate.ts'], { cwd: ROOT, env: { ...process.env, ...TEST_ENV, DATABASE_URL: url, LOG_LEVEL: 'info' }, stdout: 'pipe', stderr: 'pipe' })
      const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
      expect(code, out + err).toBe(0)
      expect(await commentIndexes(url)).toEqual(COMMENT_INDEXES)
      await withClient(url, async (c) => {
        expect((await c.query(`select count(*)::int as n from comments`)).rows[0].n).toBe(3)
        expect((await c.query(`select count(*)::int as n from drizzle.__drizzle_migrations`)).rows[0].n).toBe(JOURNAL_LENGTH)
      })
      await withClient(dbUrl('postgres'), (c) => c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`))
    },
    { timeout: 60_000 },
  )
})

describe('0002_character_portraits', () => {
  test(
    'adds a nullable characters.portrait_key to a database at 0001 that has characters (expand only)',
    async () => {
      const name = `${DB_NAME}_upgrade2`
      const url = await databaseAt(name, ['0000_init', '0001_comment_indexes'])
      await withClient(url, (c) => c.query(`insert into characters (slug, name, theme_color) values ('aimisi', '爱弥斯', 'pink')`))
      await migrateToLatest(url)
      await withClient(url, async (c) => {
        const col = await c.query(
          `select is_nullable, data_type, column_default from information_schema.columns where table_name = 'characters' and column_name = 'portrait_key'`,
        )
        expect(col.rows).toEqual([{ is_nullable: 'YES', data_type: 'text', column_default: null }])
        expect((await c.query(`select slug, name, theme_color, portrait_key from characters`)).rows).toEqual([
          { slug: 'aimisi', name: '爱弥斯', theme_color: 'pink', portrait_key: null },
        ])
        expect((await c.query(`select count(*)::int as n from drizzle.__drizzle_migrations`)).rows[0].n).toBe(JOURNAL_LENGTH)
      })
      await withClient(dbUrl('postgres'), (c) => c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`))
    },
    { timeout: 60_000 },
  )

  test('the migration only adds the column', () => {
    const sqlText = readFileSync(join(ROOT, 'drizzle', '0002_character_portraits.sql'), 'utf8').trim()
    expect(sqlText).toBe('ALTER TABLE "characters" ADD COLUMN "portrait_key" text;')
  })
})
