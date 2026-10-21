import { spawn, spawnSync } from 'node:child_process'
import { env } from '../../env'
import { log } from '../../log'
import { backupKeyFor, encryptStream } from '../../media/backup-crypto'
import { backupKey } from '../../media/keys'
import { createUpload, deleteObjects, headObject } from '../../media/s3'

// db.backup (daily 03:00 Asia/Shanghai): `pg_dump -Fc` of DATABASE_URL, encrypted with AES-256-GCM on the
// way (src/server/media/backup-crypto.ts) and streamed to backups/postgres/<yyyy>/<mm>/<dd>/<timestamp>.dump.enc
// as a multipart upload (R2 lifecycle keeps 30 days). Plaintext never leaves the process: without a key
// in production the job fails before pg_dump starts. The connection settings go to pg_dump through PG*
// environment variables, never argv, so the password does not show up in the process list. A failed dump
// never leaves an object behind.

export class BackupError extends Error {}

/** libpq environment variables for a postgres:// URL. */
export function pgEnv(url: string): Record<string, string> {
  const u = new URL(url)
  const out: Record<string, string> = {}
  if (u.hostname) out.PGHOST = u.hostname.replace(/^\[|\]$/g, '')
  if (u.port) out.PGPORT = u.port
  if (u.username) out.PGUSER = decodeURIComponent(u.username)
  if (u.password) out.PGPASSWORD = decodeURIComponent(u.password)
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''))
  if (database) out.PGDATABASE = database
  const host = u.searchParams.get('host')
  if (host) out.PGHOST = host
  const sslmode = u.searchParams.get('sslmode')
  if (sslmode) out.PGSSLMODE = sslmode
  return out
}

export interface BackupOptions {
  now?: Date
  databaseUrl?: string
  pgDump?: string
  /** Encryption key; default backupKeyFor(env()). null refuses (production without BACKUP_ENCRYPTION_KEY). */
  key?: Buffer | null
}

export async function runDbBackup(opts: BackupOptions = {}): Promise<{ key: string; bytes: number }> {
  let encKey: Buffer | null
  try {
    encKey = opts.key === undefined ? backupKeyFor(env()) : opts.key
  } catch (err) {
    throw new BackupError(`database backup refused: ${(err as Error).message}`)
  }
  if (!encKey) {
    throw new BackupError('database backup refused: BACKUP_ENCRYPTION_KEY is not set, and backups are never uploaded unencrypted')
  }
  const pgDump = opts.pgDump ?? 'pg_dump'
  const childEnv: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    ...pgEnv(opts.databaseUrl ?? env().DATABASE_URL),
  }
  const probe = spawnSync(pgDump, ['--version'], { env: childEnv, encoding: 'utf8' })
  if (probe.error) {
    if ((probe.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new BackupError(`pg_dump is not installed ("${pgDump}" not found on PATH); the worker image needs postgresql-client-18`)
    }
    throw probe.error
  }

  const key = backupKey(opts.now ?? new Date())
  const started = Date.now()
  const child = spawn(pgDump, ['--format=custom', '--no-password'], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-4000)
  })
  const exited = new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve(code ?? (signal ? 128 : 1)))
  })
  const encrypted = encryptStream(encKey)
  child.stdout.pipe(encrypted)
  const upload = createUpload(key, encrypted, { contentType: 'application/octet-stream' })
  // if the upload dies, stop pg_dump too, or it blocks forever on a full pipe
  const uploaded = upload.done().catch((err: unknown) => {
    child.kill('SIGTERM')
    throw err
  })
  const [exit, up] = await Promise.allSettled([exited, uploaded])

  const code = exit.status === 'fulfilled' ? exit.value : null
  if (code !== 0 || up.status === 'rejected') {
    if (up.status === 'fulfilled') await deleteObjects([key]).catch(() => {})
    const reason =
      exit.status === 'rejected'
        ? String(exit.reason)
        : code !== 0
          ? `pg_dump exited with ${code}: ${stderr.trim() || '(no output)'}`
          : `upload failed: ${up.status === 'rejected' ? String(up.reason) : ''}`
    throw new BackupError(`database backup failed: ${reason}`)
  }
  const bytes = (await headObject(key))?.ContentLength ?? 0
  log().info({ key, bytes, ms: Date.now() - started, pgDump: probe.stdout.trim() }, 'backup: database dumped')
  return { key, bytes }
}

export async function dbBackupJob() {
  try {
    await runDbBackup()
  } catch (err) {
    // the worker loop only logs finished jobs; a backup that did not happen must be visible
    log().error({ err: (err as Error).message }, 'backup: database backup FAILED')
    throw err
  }
}
