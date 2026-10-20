// Shared helpers for the download integration tests. Import tests/integration/setup FIRST in each test
// file (it fixes the environment), then this module. Run with a lane database and bucket, e.g.
//   CHAOCHI_TEST_DB=chaochi_lane_f CHAOCHI_TEST_BUCKET=chaochi-lane-f bun test ./tests/downloads
import { BucketAlreadyOwnedByYou, CreateBucketCommand } from '@aws-sdk/client-s3'
import { eq, sql } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import { downloadDeps } from '#/server/downloads/deps'
import type { DownloadDeps } from '#/server/downloads/handlers'
import type { DownloadSettings, PolicyDeps } from '#/server/downloads/policy'
import { pgPolicyDeps } from '#/server/downloads/store'
import { hashValue } from '#/server/http/client'
import { originalKey } from '#/server/media/keys'
import { putObject, s3 } from '#/server/media/s3'
import { setSetting, settingSchemas } from '#/server/settings'
import { BUCKET, mainDatabase, nextIp, SITE_URL } from '../integration/setup'

export const RUN = Date.now().toString(16).slice(-8)
let hexSeq = 0
export const newId = () => `r-${RUN}${(++hexSeq).toString(16).padStart(12, '0')}`

export async function ready() {
  const run = await mainDatabase()
  if (run.exitCode !== 0) throw new Error(`migrate failed:\n${run.output}`)
  try {
    await s3().send(new CreateBucketCommand({ Bucket: BUCKET }))
  } catch (err) {
    if (!(err instanceof BucketAlreadyOwnedByYou) && (err as Error).name !== 'BucketAlreadyExists') throw err
  }
}

export const DEFAULT_SETTINGS: DownloadSettings = settingSchemas.downloads.parse(undefined)

/** Replace the downloads settings (defaults + patch); setSetting drops this process's cache. */
export async function useSettings(patch: Partial<DownloadSettings> = {}) {
  await setSetting('downloads', { ...DEFAULT_SETTINGS, ...patch }, null)
}

export function deps(policy: Partial<PolicyDeps> = {}, over: Partial<DownloadDeps> = {}): DownloadDeps {
  return { ...downloadDeps, ...over, policy: { ...pgPolicyDeps, ...policy } }
}

/** A client: its own IP (so counters and rates never collide between tests) and optional session. */
export class Client {
  readonly ip: string
  readonly subject: string
  constructor(
    readonly cookie?: string,
    ip?: string,
  ) {
    this.ip = ip ?? nextIp()
    this.subject = `ip:${hashValue(this.ip)}`
  }

  request(path: string, opts: { method?: string; referer?: string | null; accept?: string; cap?: string; origin?: string | null; body?: unknown } = {}) {
    const headers = new Headers({ 'cf-connecting-ip': this.ip })
    const referer = opts.referer === undefined ? `${SITE_URL}/packs/some-pack` : opts.referer
    if (referer) headers.set('referer', referer)
    if (opts.origin) headers.set('origin', opts.origin)
    if (opts.accept) headers.set('accept', opts.accept)
    if (opts.cap) headers.set('x-cap-token', opts.cap)
    if (this.cookie) headers.set('cookie', this.cookie)
    if (opts.body !== undefined) headers.set('content-type', 'application/json')
    return new Request(`${SITE_URL}${path}`, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers,
      body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
    })
  }
}

export interface Emoji {
  id: string
  key: string
  body: Uint8Array
  ext: string
  sortOrder: number
}

export async function insertPack(values: Partial<typeof schema.packs.$inferInsert> & { packKey: string }) {
  const [row] = await db()
    .insert(schema.packs)
    .values({ slug: values.packKey, title: values.packKey, ...values })
    .returning()
  return row!
}

export async function insertEmoji(pack: { id: number; packKey: string }, opts: { sortOrder: number; status?: 'published' | 'pending' | 'hidden'; ext?: string }) {
  const id = newId()
  const ext = opts.ext ?? 'gif'
  const key = originalKey(pack.packKey, id, ext)
  const body = new TextEncoder().encode(`original ${id} ${ext}`)
  await putObject(key, body, ext === 'gif' ? 'image/gif' : 'image/png')
  await db()
    .insert(schema.emojis)
    .values({
      id,
      packId: pack.id,
      storagePackKey: pack.packKey,
      status: opts.status ?? 'published',
      sortOrder: opts.sortOrder,
      originalKey: key,
      format: ext,
      mime: ext === 'gif' ? 'image/gif' : 'image/png',
      bytes: body.byteLength,
      sha256: null,
    })
  return { id, key, body, ext, sortOrder: opts.sortOrder } satisfies Emoji
}

export async function counter(subject: string, kind: string, day?: string): Promise<number> {
  const rows = await db().execute<{ n: number }>(
    day
      ? sql`SELECT coalesce(sum(n), 0)::int AS n FROM download_counters WHERE subject = ${subject} AND kind = ${kind} AND day = ${day}`
      : sql`SELECT coalesce(sum(n), 0)::int AS n FROM download_counters WHERE subject = ${subject} AND kind = ${kind}`,
  )
  return Number(rows.rows[0]?.n ?? 0)
}

export async function countersOf(subject: string): Promise<number> {
  const rows = await db().execute<{ n: number }>(sql`SELECT coalesce(sum(n), 0)::int AS n FROM download_counters WHERE subject = ${subject}`)
  return Number(rows.rows[0]?.n ?? 0)
}

export async function packRow(id: number) {
  const [row] = await db().select().from(schema.packs).where(eq(schema.packs.id, id))
  return row!
}

/** Avoid crossing a minute boundary in the middle of a minute-rate test. */
export async function freshMinute() {
  const s = new Date().getSeconds()
  if (s >= 50) await Bun.sleep((61 - s) * 1000)
}

export async function body<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T
}
