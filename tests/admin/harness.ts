// Shared setup for tests/admin. Import it FIRST: it pulls in tests/integration/setup.ts, which pins the
// process environment (test database, local RustFS bucket, fake Cap server) before anything reads env().
//
//   CHAOCHI_TEST_DB=chaochi_lane_h_test CHAOCHI_TEST_BUCKET=chaochi-lane-h-test bun test ./tests/admin
//
// Server functions are run the way the Start server runs them: inside a request scope (the event
// store behind getRequest()) and a start context, through fn.__executeServer. Without the Start
// compiler a handler is not attached on the server side, so __executeServer runs the real middleware
// chain (requirePerm, then the input validator) and stops before the handler: a permission matrix
// over every function without side effects. Behaviour is tested on the implementations in
// src/server/admin/*.ts, which take the actor and their dependencies explicitly.
import { BUCKET, DATABASE_URL, mainDatabase, signUp, SITE_URL, withClient, type TestUser } from '../integration/setup'
import { BucketAlreadyOwnedByYou, CreateBucketCommand } from '@aws-sdk/client-s3'
import { createServerEntry } from '@tanstack/react-start/server'
import { runWithStartContext } from '@tanstack/start-storage-context'
import type { Role } from '#/shared/roles'
import type { Actor } from '#/server/admin/common'
import type { MediaDeps } from '#/server/admin/maintain'
import { db, schema } from '#/server/db/client'
import { s3 } from '#/server/media/s3'

export { BUCKET, DATABASE_URL, SITE_URL, withClient }

let ready: Promise<void> | undefined

/** Fresh migrated database (once per process) and the scratch bucket. */
export function setupAdminTests(): Promise<void> {
  ready ??= (async () => {
    const run = await mainDatabase()
    if (run.exitCode !== 0) throw new Error(`migrate failed:\n${run.output}`)
    try {
      await s3().send(new CreateBucketCommand({ Bucket: BUCKET }))
    } catch (err) {
      if (!(err instanceof BucketAlreadyOwnedByYou) && (err as Error).name !== 'BucketAlreadyExists') throw err
    }
  })()
  return ready
}

export interface RoleUser extends TestUser {
  role: Role
  name: string
  actor: Actor
}

/** A signed-up user with a session cookie, promoted to `role` directly in the database. */
export async function userWithRole(role: Role, label: string = role): Promise<RoleUser> {
  const u = await signUp(label)
  if (role !== 'user') await withClient(DATABASE_URL, (c) => c.query(`update users set role = $2 where id = $1`, [u.id, role]))
  return { ...u, role, name: label, actor: { id: u.id, name: label, role, impersonatedBy: null } }
}

export interface FnOutcome {
  status: number | null
  error: Error | null
  result: unknown
}

type ServerFnLike = { __executeServer: (opts: { data: unknown; method: string; context: object }) => Promise<{ result?: unknown; error?: unknown }> }

export function isServerFn(v: unknown): v is ServerFnLike {
  return typeof v === 'function' && typeof (v as Partial<ServerFnLike>).__executeServer === 'function'
}

/** Run a server function's server-side chain as a request with this cookie. */
export async function runServerFn(fn: unknown, data: unknown, cookie?: string, method = 'POST'): Promise<FnOutcome> {
  if (!isServerFn(fn)) throw new Error('not a server function')
  const headers = new Headers({ origin: SITE_URL })
  if (cookie) headers.set('cookie', cookie)
  const request = new Request(`${SITE_URL}/_serverFn/test`, { method, headers })
  let out: { result?: unknown; error?: unknown } = {}
  await createServerEntry({
    fetch: async () => {
      out = await runWithStartContext(
        // the fields __executeServer and executeMiddleware read from the start context
        { request, startOptions: {}, contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() } as never,
        () => fn.__executeServer({ data, method, context: {} }),
      )
      return new Response(null, { status: 204 })
    },
  }).fetch(request)
  const error = (out.error as Error | undefined) ?? null
  const status = error && typeof (error as { status?: unknown }).status === 'number' ? (error as unknown as { status: number }).status : null
  return { status, error, result: out.result }
}

/** Run `fn` inside a Start request scope with these headers (Better Auth's tanstackStartCookies needs one). */
export async function inRequest<T>(cookie: string, fn: (headers: Headers) => Promise<T>): Promise<T> {
  const headers = new Headers({ origin: SITE_URL, cookie })
  const request = new Request(`${SITE_URL}/_serverFn/test`, { method: 'POST', headers })
  const out: { done: boolean; value?: T; err?: unknown } = { done: false, err: new Error('not run') }
  await createServerEntry({
    fetch: async () => {
      try {
        out.value = await fn(headers)
        out.done = true
      } catch (err) {
        out.err = err
      }
      return new Response(null, { status: 204 })
    },
  }).fetch(request)
  if (!out.done) throw out.err
  return out.value as T
}

/** Media side effects recorded instead of performed (no worker runs during tests). */
export function fakeDeps(overrides: Partial<MediaDeps> = {}) {
  const calls = { purge: [] as string[][], zip: [] as number[], derive: [] as { id: string; target: string }[], ingest: [] as string[] }
  const deps: MediaDeps = {
    async purge(urls) {
      calls.purge.push(urls)
      return { purged: urls.length, skipped: false }
    },
    async enqueueZip(packId) {
      calls.zip.push(packId)
    },
    async enqueueDerive(id, target) {
      calls.derive.push({ id, target })
      return true
    },
    async enqueueIngest(id) {
      calls.ingest.push(id)
    },
    ...overrides,
  }
  return { deps, calls }
}

export async function auditRows(action: string, targetId?: string | number) {
  const rows = await db().select().from(schema.auditLogs)
  return rows.filter((r) => r.action === action && (targetId === undefined || r.targetId === String(targetId)))
}

let seq = 0
export function uniq(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${++seq}`
}

export function emojiIdFor(n: number): string {
  return 'r-' + (Date.now().toString(16) + n.toString(16).padStart(8, '0')).slice(-20).padStart(20, '0')
}
