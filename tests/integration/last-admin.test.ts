import { DB_NAME, dbUrl, freshDatabase, withClient } from './setup'
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import pg from 'pg'

// The users_keep_last_admin trigger (drizzle/0000_init.sql) on its own scratch database, so other
// test files creating admins cannot change what "the only admin" means here.

const TRIGGER_DB = dbUrl(`${DB_NAME}_trigger`)
const CHECK_VIOLATION = '23514'

async function sql(text: string, params: unknown[] = []) {
  return withClient(TRIGGER_DB, (c) => c.query(text, params))
}

async function errorCode(p: Promise<unknown>): Promise<string | null> {
  try {
    await p
    return null
  } catch (err) {
    return (err as { code?: string }).code ?? 'unknown'
  }
}

async function insertUser(id: string, role: string, banned = false) {
  await sql(`insert into users (id, name, email, role, banned) values ($1, $1, $1 || '@test.chaochi', $2, $3)`, [id, role, banned])
}

async function activeAdmins(): Promise<string[]> {
  return (await sql(`select id from users where role = 'admin' and not banned order by id`)).rows.map((r) => r.id)
}

beforeAll(async () => {
  const run = await freshDatabase(`${DB_NAME}_trigger`)
  if (run.exitCode !== 0) throw new Error(`migrate failed:\n${run.output}`)
}, 60_000)

beforeEach(async () => {
  // reset: the trigger only guards UPDATE/DELETE of admins, so clear it out with the trigger disabled
  await sql(`alter table users disable trigger users_keep_last_admin`)
  await sql(`delete from users`)
  await sql(`alter table users enable trigger users_keep_last_admin`)
})

describe('only one active admin', () => {
  beforeEach(async () => {
    await insertUser('admin-1', 'admin')
    await insertUser('user-1', 'user')
    await insertUser('banned-admin', 'admin', true) // banned admins do not count
  })

  test.each([
    ['demote to manager', `update users set role = 'manager' where id = 'admin-1'`],
    ['demote to user', `update users set role = 'user' where id = 'admin-1'`],
    ['ban', `update users set banned = true where id = 'admin-1'`],
    ['delete', `delete from users where id = 'admin-1'`],
  ])('%s fails with check_violation', async (_name, statement) => {
    expect(await errorCode(sql(statement))).toBe(CHECK_VIOLATION)
    expect(await activeAdmins()).toEqual(['admin-1'])
  })

  test('other users and the banned admin can still change', async () => {
    await sql(`update users set role = 'manager' where id = 'user-1'`)
    await sql(`update users set role = 'user' where id = 'banned-admin'`)
    await sql(`delete from users where id = 'user-1'`)
    await sql(`update users set name = 'renamed' where id = 'admin-1'`)
    expect(await activeAdmins()).toEqual(['admin-1'])
  })
})

describe('two active admins', () => {
  beforeEach(async () => {
    await insertUser('admin-a', 'admin')
    await insertUser('admin-b', 'admin')
  })

  test('one can be demoted, then the other cannot', async () => {
    await sql(`update users set role = 'manager' where id = 'admin-a'`)
    expect(await activeAdmins()).toEqual(['admin-b'])
    expect(await errorCode(sql(`update users set role = 'user' where id = 'admin-b'`))).toBe(CHECK_VIOLATION)
  })

  test('one can be banned or deleted', async () => {
    await sql(`update users set banned = true where id = 'admin-a'`)
    expect(await activeAdmins()).toEqual(['admin-b'])
    await sql(`update users set banned = false where id = 'admin-a'`)
    await sql(`delete from users where id = 'admin-b'`)
    expect(await activeAdmins()).toEqual(['admin-a'])
  })

  test(
    'two concurrent transactions demoting different admins: exactly one succeeds',
    async () => {
      const t1 = new pg.Client({ connectionString: TRIGGER_DB })
      const t2 = new pg.Client({ connectionString: TRIGGER_DB })
      const observer = new pg.Client({ connectionString: TRIGGER_DB })
      await Promise.all([t1.connect(), t2.connect(), observer.connect()])
      try {
        for (const c of [t1, t2]) await c.query(`set lock_timeout = '5s'`)
        const pid2 = (await t2.query('select pg_backend_pid() as pid')).rows[0].pid as number

        await t1.query('begin')
        await t1.query(`update users set role = 'user' where id = 'admin-a'`) // locks every admin row
        await t2.query('begin')
        const second = t2.query(`update users set role = 'user' where id = 'admin-b'`).then(
          () => null,
          (err: { code?: string }) => err.code ?? 'unknown',
        )

        // wait until T2 is actually blocked on T1's locks, then let T1 commit
        let blocked = false
        for (let i = 0; i < 200 && !blocked; i++) {
          const r = await observer.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid2])
          blocked = r.rows[0]?.wait_event_type === 'Lock'
          if (!blocked) await Bun.sleep(10)
        }
        expect(blocked).toBe(true)
        await t1.query('commit')

        expect(await second).toBe(CHECK_VIOLATION)
        await t2.query('rollback')
        expect(await activeAdmins()).toEqual(['admin-b'])
      } finally {
        await Promise.all([t1.end(), t2.end(), observer.end()])
      }
    },
    { timeout: 20_000 },
  )

  test(
    'racing without coordination never leaves zero admins',
    async () => {
      const a = new pg.Client({ connectionString: TRIGGER_DB })
      const b = new pg.Client({ connectionString: TRIGGER_DB })
      await Promise.all([a.connect(), b.connect()])
      try {
        for (const c of [a, b]) await c.query(`set lock_timeout = '5s'`)
        const run = (c: pg.Client, id: string) =>
          (async () => {
            await c.query('begin')
            try {
              await c.query(`update users set role = 'user' where id = $1`, [id])
              await c.query('commit')
              return null
            } catch (err) {
              await c.query('rollback')
              return (err as { code?: string }).code ?? 'unknown'
            }
          })()
        const results = await Promise.all([run(a, 'admin-a'), run(b, 'admin-b')])
        // exactly one demotion wins; the loser sees the trigger (or, rarely, a deadlock abort)
        expect(results.filter((r) => r === null)).toHaveLength(1)
        expect(['23514', '40P01']).toContain(results.find((r) => r !== null)!)
        expect(await activeAdmins()).toHaveLength(1)
      } finally {
        await Promise.all([a.end(), b.end()])
      }
    },
    { timeout: 20_000 },
  )
})
