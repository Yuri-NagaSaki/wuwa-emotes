import { beforeAll, describe, expect, test } from 'bun:test'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { env } from '../../src/server/env'
import { BackupError, pgEnv, runDbBackup } from '../../src/server/jobs/handlers/backup'
import { BACKUP_MAGIC, backupKeyFor } from '../../src/server/media/backup-crypto'
import { decryptBackupFile, encryptExistingBackups } from '../../src/server/media/backup-tools'
import { backupKey } from '../../src/server/media/keys'
import { getObjectBytes, getObjectRange, headObject, listKeys, putObject } from '../../src/server/media/s3'
import { emptyBucket, setupTestEnv } from './helpers'

// Needs a pg_dump on PATH whose major version is >= the server's (PostgreSQL 18); skipped otherwise.
const hasPgDump = Bun.which('pg_dump') != null
const hasPgRestore = Bun.which('pg_restore') != null
const KEY = backupKeyFor(env())!
const dir = mkdtempSync(join(tmpdir(), 'chaochi-backup-test-'))
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

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

  test.skipIf(!hasPgDump)('streams an encrypted pg_dump -Fc to backups/postgres/<yyyy>/<mm>/<dd>/…dump.enc; it decrypts to a valid archive', async () => {
    const now = new Date('2026-10-20T19:00:00Z')
    const r = await runDbBackup({ now })
    expect(r.key).toBe(backupKey(now))
    expect(r.key).toStartWith('backups/postgres/2026/10/20/')
    expect(r.key).toEndWith('.dump.enc')
    expect(r.bytes).toBeGreaterThan(1000)
    expect((await headObject(r.key))?.ContentLength).toBe(r.bytes)
    // nothing readable in the bucket: the object starts with the format magic, not pg_dump's "PGDMP"
    const head = await getObjectRange(r.key, 0, BACKUP_MAGIC.length - 1)
    expect(Buffer.from(head).equals(BACKUP_MAGIC)).toBe(true)
    expect(Buffer.from(await getObjectBytes(r.key)).includes(Buffer.from('PGDMP'))).toBe(false)
    expect((await listKeys('backups/')).filter((k) => !k.endsWith('.dump.enc'))).toEqual([])

    // restore path 1: straight from the bucket key
    const out = join(dir, 'from-key.dump')
    const d = await decryptBackupFile(r.key, out, KEY)
    expect(d.bytes).toBe(r.bytes - BACKUP_MAGIC.length - 1 - 12 - 16)
    expect(new TextDecoder().decode(readFileSync(out).subarray(0, 5))).toBe('PGDMP')
    if (hasPgRestore) {
      const list = Bun.spawnSync(['pg_restore', '--list', out])
      expect(list.exitCode).toBe(0)
      expect(list.stdout.toString()).toContain('TABLE public emojis')
    }
    // restore path 2: a downloaded file
    const local = join(dir, 'downloaded.dump.enc')
    writeFileSync(local, await getObjectBytes(r.key))
    const out2 = join(dir, 'from-file.dump')
    expect((await decryptBackupFile(local, out2, KEY)).sha256).toBe(d.sha256)
  })

  test.skipIf(!hasPgDump)('a wrong key or a truncated file leaves no output behind', async () => {
    const now = new Date('2026-10-20T20:00:00Z')
    const r = await runDbBackup({ now })
    const out = join(dir, 'wrong-key.dump')
    await expect(decryptBackupFile(r.key, out, randomBytes(32))).rejects.toThrow(/authentication failed/)
    expect(existsSync(out)).toBe(false)
    expect(existsSync(`${out}.partial`)).toBe(false)

    const cut = join(dir, 'cut.dump.enc')
    const bytes = await getObjectBytes(r.key)
    writeFileSync(cut, bytes.subarray(0, bytes.length - 100))
    await expect(decryptBackupFile(cut, join(dir, 'cut.dump'), KEY)).rejects.toThrow(/authentication failed|truncated/)
    expect(existsSync(join(dir, 'cut.dump'))).toBe(false)
  })

  test('production without BACKUP_ENCRYPTION_KEY refuses before anything runs or uploads', async () => {
    const now = new Date('2026-10-22T19:00:00Z')
    const key = backupKeyFor({ NODE_ENV: 'production', BACKUP_ENCRYPTION_KEY: '' })
    expect(key).toBeNull()
    const err = await runDbBackup({ now, key }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BackupError)
    expect((err as Error).message).toContain('BACKUP_ENCRYPTION_KEY is not set')
    expect(await listKeys('backups/postgres/2026/10/22/')).toEqual([])
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

describe('backup encrypt-existing', () => {
  test('encrypts every plaintext .dump, verifies the SHA-256, deletes the plaintext; reuses a verified copy', async () => {
    await emptyBucket('backups/')
    const base = 'backups/postgres/2026/09/'
    const a = Buffer.concat([Buffer.from('PGDMP'), randomBytes(3 * 1024 * 1024 + 17)]) // spans several stream chunks
    const b = Buffer.concat([Buffer.from('PGDMP'), randomBytes(2048)])
    const c = Buffer.concat([Buffer.from('PGDMP'), randomBytes(512)])
    await putObject(`${base}01/a.dump`, a, 'application/octet-stream')
    await putObject(`${base}02/b.dump`, b, 'application/octet-stream')
    await putObject(`${base}03/c.dump`, c, 'application/octet-stream')
    // a first run converts all three
    expect(await encryptExistingBackups(KEY)).toMatchObject({ found: 3, encrypted: 3, verified: 3, deleted: 3, failed: [] })
    // b: as if a run had uploaded the encrypted copy and stopped before deleting the plaintext
    await putObject(`${base}02/b.dump`, b, 'application/octet-stream')
    // c: a damaged encrypted copy next to its plaintext must be replaced, not trusted
    await putObject(`${base}03/c.dump`, c, 'application/octet-stream')
    await putObject(`${base}03/c.dump.enc`, randomBytes(600), 'application/octet-stream')
    const before = (await listKeys('backups/')).length

    const dry = await encryptExistingBackups(KEY, { dryRun: true })
    expect(dry.found).toBe(2)
    expect(dry.encrypted + dry.deleted).toBe(0)
    expect(dry.lines.every((l) => l.startsWith('would encrypt'))).toBe(true)
    expect((await listKeys('backups/')).length).toBe(before)

    const r = await encryptExistingBackups(KEY)
    expect(r).toMatchObject({ found: 2, encrypted: 1, verified: 2, deleted: 2, failed: [] })
    const keys = await listKeys('backups/')
    expect(keys.sort()).toEqual([`${base}01/a.dump.enc`, `${base}02/b.dump.enc`, `${base}03/c.dump.enc`])
    for (const [name, plain] of [
      ['01/a', a],
      ['02/b', b],
      ['03/c', c],
    ] as const) {
      const out = join(dir, `${name.replace('/', '-')}.dump`)
      expect((await decryptBackupFile(`${base}${name}.dump.enc`, out, KEY)).sha256).toBe(sha(plain))
    }
    // nothing left to do
    expect(await encryptExistingBackups(KEY)).toMatchObject({ found: 0, encrypted: 0, deleted: 0 })
  })

  test('a plaintext object that cannot be verified is kept', async () => {
    await emptyBucket('backups/')
    const key = 'backups/postgres/2026/08/01/x.dump'
    await putObject(key, Buffer.from('PGDMP-small'), 'application/octet-stream')
    const r = await encryptExistingBackups(Buffer.alloc(31)).catch((e: unknown) => e)
    // a bad key never gets as far as deleting anything
    expect(r instanceof Error || (r as { failed: unknown[] }).failed.length === 1).toBe(true)
    expect(await listKeys('backups/postgres/2026/08/01/')).toContain(key)
  })
})
