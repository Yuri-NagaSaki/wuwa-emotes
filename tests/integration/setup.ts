// Shared setup for integration tests. Import it FIRST in every integration test file: it fixes the
// process environment before anything calls env(), auth() or db() (all process-wide singletons).
//
// Everything is configured here, inline; no .env files. Overridable for other machines/lanes:
//   CHAOCHI_TEST_PG      postgres://chaochi:chaochi@127.0.0.1:5432   (server, no database)
//   CHAOCHI_TEST_DB      chaochi_lane_a                               (dropped and recreated per run)
//   CHAOCHI_TEST_S3      http://127.0.0.1:9000                        (RustFS / MinIO, path-style)
//   CHAOCHI_TEST_BUCKET  chaochi-lane-a

import { join } from 'node:path'
import pg from 'pg'

const PG_SERVER = (process.env.CHAOCHI_TEST_PG ?? 'postgres://chaochi:chaochi@127.0.0.1:5432').replace(/\/+$/, '')
export const DB_NAME = process.env.CHAOCHI_TEST_DB ?? 'chaochi_lane_a'
export const BUCKET = process.env.CHAOCHI_TEST_BUCKET ?? 'chaochi-lane-a'
export const SITE_URL = 'http://localhost:3101'
export const ROOT = join(import.meta.dir, '..', '..')

// These tests drop databases: only ever touch obviously disposable ones.
const SAFE_DB = /^chaochi_(lane_[a-z0-9]+|test)(_[a-z0-9_]+)?$/
export function assertSafeDbName(name: string) {
  if (!SAFE_DB.test(name)) throw new Error(`refusing to use database "${name}" for tests (must match ${SAFE_DB})`)
}
assertSafeDbName(DB_NAME)
if (BUCKET === 'wuwa') throw new Error('refusing to run tests against bucket "wuwa"')

export function dbUrl(name: string): string {
  return `${PG_SERVER}/${name}`
}
export const DATABASE_URL = dbUrl(DB_NAME)

// ---- fake Cap Standalone: "good-<n>" verifies once, anything else is invalid ----

export const CAP_SITE = 'testsite'
export const CAP_SECRET = 'sk-integration-test'
const usedTokens = new Set<string>()
export const capServer = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(req) {
    const url = new URL(req.url)
    if (req.method !== 'POST' || url.pathname !== `/${CAP_SITE}/siteverify`) return new Response('not found', { status: 404 })
    const body = (await req.json().catch(() => ({}))) as { secret?: string; response?: string }
    if (body.secret !== CAP_SECRET) return Response.json({ success: false, error: 'invalid secret' }, { status: 403 })
    const token = String(body.response ?? '')
    if (/^good-\d+$/.test(token) && !usedTokens.has(token)) {
      usedTokens.add(token)
      return Response.json({ success: true })
    }
    return Response.json({ success: false })
  },
})
capServer.unref()

let tokenSeq = 0
export function goodToken(): string {
  return `good-${++tokenSeq}`
}

let ipSeq = 0
/** A fresh client IP per request, so Better Auth's per-IP rate limits never interfere. */
export function nextIp(): string {
  ipSeq++
  return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`
}

// ---- environment (set explicitly so a developer's shell cannot redirect the tests) ----

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  SITE_URL,
  DATABASE_URL,
  AUTH_SECRET: 'integration-test-auth-secret-0123456789abcdef',
  IP_HASH_SALT: 'integration-test-salt',
  S3_ENDPOINT: process.env.CHAOCHI_TEST_S3 ?? 'http://127.0.0.1:9000',
  S3_PUBLIC_ENDPOINT: '',
  S3_REGION: 'auto',
  S3_BUCKET: BUCKET,
  S3_ACCESS_KEY_ID: 'devaccess',
  S3_SECRET_ACCESS_KEY: 'devsecret123',
  S3_FORCE_PATH_STYLE: 'true',
  ALLOW_PROD_BUCKET: '',
  CAP_API_ENDPOINT: `http://127.0.0.1:${capServer.port}/${CAP_SITE}/`,
  CAP_SITE_KEY: CAP_SITE,
  CAP_SECRET_KEY: CAP_SECRET,
  CAP_DISABLED: '',
  SMTP_URL: '',
  MAIL_FROM: '',
  CF_ZONE_ID: '',
  CF_PURGE_TOKEN: '',
  LOG_LEVEL: 'fatal',
}
Object.assign(process.env, TEST_ENV)

// Bare `bun test` runs every file in one process, in no fixed order, so a unit test may already have
// read env() (e.g. verifyCapToken). Unit tests only use fakes and never open connections, so the
// cached object can be refreshed in place. The pool check below makes sure nothing connected earlier.
const { env, parseEnv } = await import('#/server/env')
const cachedEnv = env()
if (cachedEnv.DATABASE_URL !== DATABASE_URL || cachedEnv.CAP_API_ENDPOINT !== TEST_ENV.CAP_API_ENDPOINT) {
  Object.assign(cachedEnv, parseEnv(process.env))
}
const { db } = await import('#/server/db/client')
if (db().$pool.options.connectionString !== DATABASE_URL) {
  throw new Error('the database pool was created before tests/integration/setup.ts; run integration tests on their own: bun run test:integration')
}

// ---- databases ----

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: dbUrl('postgres') })
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

export interface MigrateRun {
  exitCode: number
  output: string
}

/** Drop + create the database, then run the real migrate entry (SQL migrations + pg-boss schema). */
export async function freshDatabase(name: string): Promise<MigrateRun> {
  assertSafeDbName(name)
  await admin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await c.query(`CREATE DATABASE "${name}"`)
  })
  const proc = Bun.spawn(['bun', 'src/migrate.ts'], {
    cwd: ROOT,
    env: { ...process.env, ...TEST_ENV, DATABASE_URL: dbUrl(name), LOG_LEVEL: 'info' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { exitCode, output: stdout + stderr }
}

let mainDb: Promise<MigrateRun> | undefined
/** The shared test database, recreated once per process. */
export function mainDatabase(): Promise<MigrateRun> {
  mainDb ??= freshDatabase(DB_NAME)
  return mainDb
}

export async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

// ---- Better Auth through its HTTP handler ----

export interface AuthCall {
  body?: unknown
  cap?: string
  cookie?: string
  method?: 'GET' | 'POST'
}

export async function authCall(path: string, call: AuthCall = {}): Promise<Response> {
  const { auth } = await import('#/server/auth/auth')
  const headers = new Headers({ origin: SITE_URL, 'cf-connecting-ip': nextIp() })
  if (call.body !== undefined) headers.set('content-type', 'application/json')
  if (call.cap) headers.set('x-cap-token', call.cap)
  if (call.cookie) headers.set('cookie', call.cookie)
  const method = call.method ?? (call.body === undefined ? 'GET' : 'POST')
  return auth().handler(
    new Request(`${SITE_URL}/api/auth${path}`, { method, headers, body: call.body === undefined ? undefined : JSON.stringify(call.body) }),
  )
}

/** `name=value` of the session cookie set by a response, for the Cookie header of later calls. */
export function sessionCookie(res: Response): string {
  for (const c of res.headers.getSetCookie()) {
    const pair = c.split(';')[0]!
    if (/^(__Secure-)?better-auth\.session_token=/.test(pair)) return pair
  }
  throw new Error(`no session cookie in response (status ${res.status})`)
}

let userSeq = 0
export interface TestUser {
  id: string
  email: string
  password: string
  cookie: string
}

/** Sign up through Better Auth (with a valid Cap token) and return the session. */
export async function signUp(label = 'user'): Promise<TestUser> {
  const email = `${label}-${++userSeq}-${Date.now()}@test.chaochi`.toLowerCase()
  const password = 'correct horse battery staple'
  const res = await authCall('/sign-up/email', { body: { email, password, name: label }, cap: goodToken() })
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { user: { id: string } }
  return { id: body.user.id, email, password, cookie: sessionCookie(res) }
}
