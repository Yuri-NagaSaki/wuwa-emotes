// Shared helpers for the comment integration tests. Import ../integration/setup FIRST in each test
// file (it fixes the environment), then this module. Run with a lane database:
//   CHAOCHI_TEST_DB=chaochi_lane_k CHAOCHI_TEST_BUCKET=chaochi-lane-k bun test ./tests/comments
import { and, desc, eq, sql } from 'drizzle-orm'
import { withDeps, type Actor, type CommentDeps, type CommentSettings, type RequestCtx } from '#/server/comments/common'
import { issueFormToken } from '#/server/comments/form-token'
import { commentQueue } from '#/server/comments/admin'
import { CommentError } from '#/server/comments/moderation'
import type { QueueItem, QueueTab } from '#/server/comments/types'
import { createComment } from '#/server/comments/write'
import { db, schema } from '#/server/db/client'
import { settingSchemas } from '#/server/settings'
import type { Role } from '#/shared/roles'
import { goodToken, mainDatabase, nextIp, signUp } from '../integration/setup'

export const RUN = Date.now().toString(16).slice(-8)
let hexSeq = 0
export const newEmojiId = () => `r-${RUN}${(++hexSeq).toString(16).padStart(12, '0')}`

export async function ready() {
  const run = await mainDatabase()
  if (run.exitCode !== 0) throw new Error(`migrate failed:\n${run.output}`)
}

export const DEFAULTS: CommentSettings = settingSchemas.comments.parse(undefined)

/** A movable clock starting at real time (DB defaults such as users.created_at use real time too). */
export class Clock {
  t = Date.now()
  now = () => new Date(this.t)
  advance(ms: number) {
    this.t += ms
  }
}

export interface TestDeps extends CommentDeps {
  clock: Clock
  setSettings: (patch: Partial<CommentSettings>) => void
  settingsValue: () => CommentSettings
  capCalls: number
}

/**
 * Dependencies for one test: own clock, settings held in memory (no cache to wait for), rate limits
 * off unless `realRateLimits`, Cap against the fake Cap server from setup.ts (counted).
 */
export function testDeps(opts: { settings?: Partial<CommentSettings>; realRateLimits?: boolean; hit?: CommentDeps['hit'] } = {}): TestDeps {
  const clock = new Clock()
  let settings: CommentSettings = { ...DEFAULTS, ...opts.settings }
  const base = withDeps()
  const deps: TestDeps = {
    ...base,
    clock,
    capCalls: 0,
    now: clock.now,
    settings: async () => settings,
    setSettings: (patch) => {
      settings = { ...settings, ...patch }
    },
    settingsValue: () => settings,
    hit: opts.hit ?? (opts.realRateLimits ? base.hit : async () => 1),
    verifyCap: async (token) => {
      deps.capCalls++
      return base.verifyCap(token)
    },
  }
  return deps
}

/** A form token issued long enough ago to pass the minimum fill time. */
export function oldFormToken(deps: TestDeps, ageMs = 10_000): string {
  return issueFormToken(deps.clock.t - ageMs)
}

// ---- users ----

export interface TestActor extends Actor {
  email: string
  cookie: string
}

export async function makeUser(label: string, role: Role = 'user', opts: { ageMs?: number } = {}): Promise<TestActor> {
  const u = await signUp(label)
  if (role !== 'user') await db().update(schema.users).set({ role }).where(eq(schema.users.id, u.id))
  // accounts are 2 days old unless asked otherwise, so the hot-thread rule only fires on purpose
  const age = opts.ageMs ?? 2 * 86_400_000
  await db()
    .update(schema.users)
    .set({ createdAt: new Date(Date.now() - age) })
    .where(eq(schema.users.id, u.id))
  return { id: u.id, name: label, role, impersonatedBy: null, email: u.email, cookie: u.cookie }
}

export function ctxOf(viewer: Actor | null, opts: { ip?: string; cap?: string | null } = {}): RequestCtx {
  return { viewer, ip: opts.ip ?? nextIp(), capToken: opts.cap === undefined ? (viewer ? null : goodToken()) : opts.cap }
}

// ---- catalog fixture ----

export interface Fixture {
  pack: { id: number; slug: string; key: string }
  hiddenPack: { id: number; slug: string; key: string }
  /** published, derived_ready, in the published pack (8 of them) */
  stickers: string[]
  pendingEmoji: string
  hiddenEmoji: string
  notReadyEmoji: string
  inHiddenPack: string
  /** a published emoji (its own emoji thread) */
  emojiThread: string
}

async function insertPack(key: string, status: 'published' | 'hidden') {
  const [row] = await db()
    .insert(schema.packs)
    .values({ packKey: key, slug: key, title: `测试包 ${key}`, status, publishedAt: new Date(), kind: 'static' })
    .returning({ id: schema.packs.id })
  return { id: row!.id, slug: key, key }
}

async function insertEmoji(pack: { id: number; key: string }, opts: { status?: 'published' | 'pending' | 'hidden'; derivedReady?: boolean; sort?: number } = {}) {
  const id = newEmojiId()
  await db()
    .insert(schema.emojis)
    .values({
      id,
      packId: pack.id,
      storagePackKey: pack.key,
      status: opts.status ?? 'published',
      sortOrder: opts.sort ?? 0,
      originalKey: `assets/v1/packs/${pack.key}/emojis/${id}.png`,
      format: 'png',
      mime: 'image/png',
      bytes: 1000,
      width: 300,
      height: 200,
      derivedReady: opts.derivedReady ?? true,
      fullReady: true,
    })
  return id
}

let fixtureCount = 0
export async function seedFixture(): Promise<Fixture> {
  const tag = `${RUN}-${++fixtureCount}`
  const pack = await insertPack(`cm-pack-${tag}`, 'published')
  const hiddenPack = await insertPack(`cm-hidden-${tag}`, 'hidden')
  const stickers: string[] = []
  for (let i = 0; i < 8; i++) stickers.push(await insertEmoji(pack, { sort: i }))
  return {
    pack,
    hiddenPack,
    stickers,
    pendingEmoji: await insertEmoji(pack, { status: 'pending', sort: 20 }),
    hiddenEmoji: await insertEmoji(pack, { status: 'hidden', sort: 21 }),
    notReadyEmoji: await insertEmoji(pack, { derivedReady: false, sort: 22 }),
    inHiddenPack: await insertEmoji(hiddenPack),
    emojiThread: stickers[0]!,
  }
}

export function packThread(f: Fixture) {
  return { threadType: 'pack' as const, threadId: String(f.pack.id) }
}

/** A fresh published pack with no comments yet (thread isolation between tests). */
export async function freshThread(): Promise<{ threadType: 'pack'; threadId: string }> {
  const p = await insertPack(`cm-thread-${RUN}-${++fixtureCount}`, 'published')
  return { threadType: 'pack', threadId: String(p.id) }
}

// ---- reads ----

export async function commentRow(id: number) {
  const [row] = await db().select().from(schema.comments).where(eq(schema.comments.id, id))
  return row!
}

export async function auditRows(action: string, targetId: string | number) {
  return db()
    .select()
    .from(schema.auditLogs)
    .where(and(eq(schema.auditLogs.action, action), eq(schema.auditLogs.targetId, String(targetId))))
    .orderBy(desc(schema.auditLogs.id))
}

export async function notificationsOf(userId: string) {
  return db().select().from(schema.notifications).where(eq(schema.notifications.userId, userId)).orderBy(desc(schema.notifications.id))
}

export async function commentCount(threadId: string): Promise<number> {
  const res = await db().execute<{ n: number }>(sql`select count(*)::int as n from comments where thread_id = ${threadId}`)
  return Number(res.rows[0]?.n ?? 0)
}

// ---- writes ----

export interface PostOpts {
  parentId?: number
  guestName?: string
  guestEmail?: string
  formToken?: string
  website?: string
  ip?: string
  cap?: string | null
}

/** createComment with a valid form token (and, for guests, a name and a fresh Cap token). */
export async function post(deps: TestDeps, viewer: Actor | null, thread: { threadType: 'pack' | 'emoji'; threadId: string }, body: string, o: PostOpts = {}) {
  return createComment(
    ctxOf(viewer, { ip: o.ip, cap: o.cap }),
    {
      ...thread,
      body,
      parentId: o.parentId,
      guestName: viewer ? undefined : (o.guestName ?? '路过的游客'),
      guestEmail: o.guestEmail,
      formToken: o.formToken ?? oldFormToken(deps),
      website: o.website,
    },
    deps,
  )
}

/** Expect a CommentError with this status (and optionally a message fragment). */
export async function rejects(p: Promise<unknown>, status: number, message?: string | RegExp) {
  try {
    await p
  } catch (err) {
    if (!(err instanceof CommentError)) throw err
    if (err.status !== status) throw new Error(`expected status ${status}, got ${err.status}: ${err.message}`)
    if (message && !(typeof message === 'string' ? err.message.includes(message) : message.test(err.message))) {
      throw new Error(`unexpected message: ${err.message}`)
    }
    return err
  }
  throw new Error(`expected a ${status} rejection, but the call succeeded`)
}

/** A comment in a queue tab, following the cursor (other test files leave comments in the queue too). */
export async function findInQueue(actor: Actor, tab: QueueTab, id: number, deps: CommentDeps): Promise<QueueItem | undefined> {
  let cursor: string | undefined
  for (let i = 0; i < 50; i++) {
    const page = await commentQueue(actor, { tab, cursor }, deps)
    const hit = page.items.find((it) => it.id === id)
    if (hit) return hit
    if (!page.nextCursor) return undefined
    cursor = page.nextCursor
  }
  throw new Error('queue pagination did not terminate')
}

/** Insert comments directly (bulk background for hot-thread and pagination tests). */
export async function insertComments(thread: { threadType: 'pack' | 'emoji'; threadId: string }, count: number, opts: { createdAt?: (i: number) => Date; authorId?: string } = {}) {
  const ids: number[] = []
  for (let i = 0; i < count; i++) {
    const [row] = await db()
      .insert(schema.comments)
      .values({
        ...thread,
        authorId: opts.authorId ?? null,
        guestName: opts.authorId ? null : `背景${i}`,
        bodySrc: `背景评论 ${i}`,
        status: 'published',
        createdAt: opts.createdAt ? opts.createdAt(i) : new Date(),
      })
      .returning({ id: schema.comments.id })
    ids.push(row!.id)
  }
  return ids
}
