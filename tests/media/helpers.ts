// Shared setup for tests/media and tests/import. Tests run against a throwaway PostgreSQL database and a
// local S3 bucket (RustFS/MinIO), never R2:
//   DATABASE_URL=postgres://chaochi:chaochi@127.0.0.1:5432/chaochi_lane_d_test S3_BUCKET=chaochi-lane-d \
//     bun test tests/media tests/import
// The database is created and migrated on first use. Test files run one after another in one process
// (bun test without --parallel) and share env(), db() and s3(), so each file resets tables in beforeAll.
import { fileURLToPath } from 'node:url'
import { CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import sharp from 'sharp'
import { db, schema } from '../../src/server/db/client'
import { env } from '../../src/server/env'
import { bucket, deleteObjects, listKeys, s3 } from '../../src/server/media/s3'

export function assertTestTargets() {
  const e = env()
  const dbName = decodeURIComponent(new URL(e.DATABASE_URL).pathname.slice(1))
  if (!/test/.test(dbName)) throw new Error(`refusing to run: DATABASE_URL must name a test database (got "${dbName}")`)
  const host = new URL(e.S3_ENDPOINT).hostname
  if (e.S3_BUCKET === 'wuwa' || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new Error(`refusing to run: tests need a local S3 endpoint and a scratch bucket (got ${host}/${e.S3_BUCKET})`)
  }
}

let ready: Promise<void> | undefined

/** Create (if needed) and migrate the test database, and create the bucket. Once per process. */
export function setupTestEnv(): Promise<void> {
  ready ??= (async () => {
    assertTestTargets()
    const url = new URL(env().DATABASE_URL)
    const dbName = decodeURIComponent(url.pathname.slice(1))
    const admin = new URL(url)
    admin.pathname = '/postgres'
    const client = new pg.Client({ connectionString: admin.toString() })
    await client.connect()
    try {
      const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
      if (!rowCount) await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`)
    } finally {
      await client.end()
    }
    await migrate(db(), { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) })
    try {
      await s3().send(new HeadBucketCommand({ Bucket: bucket() }))
    } catch {
      await s3().send(new CreateBucketCommand({ Bucket: bucket() }))
    }
  })()
  return ready
}

/** Empty every application table (TRUNCATE: the users trigger only guards row deletes). */
export async function resetDb() {
  const rows = await db().execute<{ tablename: string }>(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)
  const names = rows.rows.map((r) => `"public"."${r.tablename}"`)
  if (names.length) await db().execute(sql.raw(`TRUNCATE ${names.join(', ')} RESTART IDENTITY CASCADE`))
}

export async function emptyBucket(prefix = '') {
  await deleteObjects(await listKeys(prefix))
}

// ---------- images ----------

function rgba(w: number, h: number, seed: number, frame: number): Buffer {
  const buf = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      buf[i] = (seed * 37 + x * 3 + frame * 50) & 255
      buf[i + 1] = (seed * 91 + y * 5 + frame * 20) & 255
      buf[i + 2] = (seed * 13 + (x ^ y) + frame * 80) & 255
      buf[i + 3] = 255
    }
  }
  return buf
}

/** Small animated GIF with distinct pixels per seed. */
export async function makeGif(w: number, h: number, frames: number, seed: number): Promise<Buffer> {
  const strip = Buffer.concat(Array.from({ length: frames }, (_, f) => rgba(w, h, seed, f)))
  return sharp(strip, { raw: { width: w, height: h * frames, channels: 4, pageHeight: h } })
    .gif({ delay: Array(frames).fill(100), loop: 0 })
    .toBuffer()
}

export async function makePng(w: number, h: number, seed: number): Promise<Buffer> {
  return sharp(rgba(w, h, seed, 0), { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer()
}

export async function makeWebp(w: number, h: number, seed: number): Promise<Buffer> {
  return sharp(rgba(w, h, seed, 0), { raw: { width: w, height: h, channels: 4 } })
    .webp({ quality: 80 })
    .toBuffer()
}

export async function makeJpeg(w: number, h: number, seed: number): Promise<Buffer> {
  return sharp(rgba(w, h, seed, 0), { raw: { width: w, height: h, channels: 4 } })
    .jpeg({ quality: 80 })
    .toBuffer()
}

// ---------- rows ----------

let userSeq = 0

export async function insertUser(opts: { role?: 'admin' | 'manager' | 'user'; email?: string; banned?: boolean } = {}) {
  const n = ++userSeq
  const [row] = await db()
    .insert(schema.users)
    .values({
      id: `u-test-${n}-${crypto.randomUUID().slice(0, 8)}`,
      name: `测试用户${n}`,
      email: opts.email ?? `user${n}-${crypto.randomUUID().slice(0, 6)}@example.test`,
      role: opts.role ?? 'user',
      banned: opts.banned ?? false,
    })
    .returning()
  return row!
}

export async function insertPack(opts: Partial<typeof schema.packs.$inferInsert> & { packKey: string }) {
  const [row] = await db()
    .insert(schema.packs)
    .values({ slug: opts.packKey, title: opts.packKey, ...opts })
    .returning()
  return row!
}
