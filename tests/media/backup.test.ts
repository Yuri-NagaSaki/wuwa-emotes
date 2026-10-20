import { beforeAll, describe, expect, test } from 'bun:test'
import { env } from '../../src/server/env'
import { BackupError, pgEnv, runDbBackup } from '../../src/server/jobs/handlers/backup'
import { backupKey } from '../../src/server/media/keys'
import { getObjectRange, headObject, listKeys } from '../../src/server/media/s3'
import { emptyBucket, setupTestEnv } from './helpers'

// Needs a pg_dump on PATH whose major version is >= the server's (PostgreSQL 18); skipped otherwise.
const hasPgDump = Bun.which('pg_dump') != null

beforeAll(async () => {
  await setupTestEnv()
  await emptyBucket('backups/')
})

describe('db.backup', () => {
  test('pgEnv keeps the password out of argv', () => {
    expect(pgEnv('postgres://chao%40chi:p%2Fss%20w@db.internal:6543/chaochi?sslmode=require')).toEqual({
      PGHOST: 'db.internal',
      PGPORT: '6543',
      PGUSER: 'chao@chi',
      PGPASSWORD: 'p/ss w',
      PGDATABASE: 'chaochi',
      PGSSLMODE: 'require',
    })
  })

  test.skipIf(!hasPgDump)('streams pg_dump -Fc to backups/postgres/<yyyy>/<mm>/<dd>/', async () => {
    const now = new Date('2026-10-20T19:00:00Z')
    const r = await runDbBackup({ now })
    expect(r.key).toBe(backupKey(now))
    expect(r.key).toStartWith('backups/postgres/2026/10/20/')
    expect(r.bytes).toBeGreaterThan(1000)
    expect((await headObject(r.key))?.ContentLength).toBe(r.bytes)
    // custom-format archives start with the magic "PGDMP"
    expect(new TextDecoder().decode(await getObjectRange(r.key, 0, 4))).toBe('PGDMP')
  })

  test.skipIf(!hasPgDump)('a failing pg_dump leaves no object behind', async () => {
    const now = new Date('2026-10-21T19:00:00Z')
    const url = new URL(env().DATABASE_URL)
    url.pathname = '/chaochi_lane_d_test_does_not_exist'
    await expect(runDbBackup({ now, databaseUrl: url.toString() })).rejects.toThrow(/pg_dump exited with/)
    expect(await listKeys('backups/postgres/2026/10/21/')).toEqual([])
  })

  test('a missing pg_dump fails with a clear error', async () => {
    const err = await runDbBackup({ pgDump: 'pg_dump-not-installed-here' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BackupError)
    expect((err as Error).message).toContain('pg_dump is not installed')
  })
})
