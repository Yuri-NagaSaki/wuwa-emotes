import { nextIp } from '../integration/setup'
import { beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { banCommenter, commentQueue, moderateComments, readCommentSettings, saveCommentSettings, setBadge, setPinned } from '#/server/comments/admin'
import { RATE } from '#/server/comments/constants'
import { listThread } from '#/server/comments/read'
import { getSetting } from '#/server/settings'
import { can } from '#/shared/roles'
import {
  auditRows,
  commentRow,
  ctxOf,
  DEFAULTS,
  findInQueue,
  freshThread,
  makeUser,
  post,
  ready,
  rejects,
  seedFixture,
  testDeps,
  type Fixture,
  type TestActor,
} from './fixture'

// 评论审核: the permission matrix, queue tabs and actions, settings, comment bans, rate limits.

let f: Fixture
let owner: TestActor
let mod: TestActor
let user: TestActor

beforeAll(async () => {
  await ready()
  f = await seedFixture()
  owner = await makeUser('owner', 'admin')
  mod = await makeUser('mod', 'manager')
  user = await makeUser('plain')
}, 120_000)

const open = () => testDeps({ settings: { firstCommentReview: false } })

describe('permission matrix', () => {
  const src = (file: string) => Bun.file(join(import.meta.dir, '..', '..', 'src', 'server', 'comments', file)).text()

  test('every admin server function requires the comments permission', async () => {
    const text = await src('admin-fns.ts')
    const fns = text.match(/createServerFn\(/g) ?? []
    const guarded = text.match(/\.middleware\(\[requirePerm\('comments'\)\]\)/g) ?? []
    expect(fns.length).toBe(7)
    expect(guarded.length).toBe(fns.length)
  })

  test('public functions: reading and posting are public; account actions need a user', async () => {
    const text = await src('fns.ts')
    const chains = [...text.matchAll(/export const (\w+) = createServerFn\([^)]*\)\s*\.middleware\(\[(\w+)\]\)/g)].map((m) => [m[1], m[2]])
    expect(Object.fromEntries(chains)).toEqual({
      listCommentsFn: 'publicFn',
      listRepliesFn: 'publicFn',
      commentFormTokenFn: 'publicFn',
      createCommentFn: 'publicFn',
      previewCommentFn: 'publicFn',
      stickerSourceFn: 'publicFn',
      editCommentFn: 'requireUser',
      deleteCommentFn: 'requireUser',
      reactCommentFn: 'requireUser',
      reportCommentFn: 'requireUser',
      myCommentsFn: 'requireUser',
    })
  })

  test('roles: 站长 and 管理员 hold comments, 用户 does not', () => {
    expect(can('admin', 'comments')).toBe(true)
    expect(can('manager', 'comments')).toBe(true)
    expect(can('user', 'comments')).toBe(false)
  })

  test('the service functions check again: 用户 403, nobody 401, staff allowed', async () => {
    const deps = open()
    const res = await post(deps, user, await freshThread(), '矩阵')
    const calls: [string, (a: TestActor | null) => Promise<unknown>][] = [
      ['queue', (a) => commentQueue(a, { tab: 'pending' }, deps)],
      ['moderate', (a) => moderateComments(a, { ids: [res.comment.id], action: 'approve' }, deps)],
      ['pin', (a) => setPinned(a, { id: res.comment.id, pinned: false })],
      ['badge', (a) => setBadge(a, { id: res.comment.id, badge: null })],
      ['settings', (a) => readCommentSettings(a, deps)],
      ['save', (a) => saveCommentSettings(a, {}, deps)],
      ['ban', (a) => banCommenter(a, { userId: user.id, banned: false }, deps)],
    ]
    for (const [, call] of calls) {
      await rejects(call(user), 403)
      await rejects(call(null), 401)
      await call(mod)
      await call(owner)
    }
  })

  test('only 站长 may use the 站长 badge', async () => {
    const res = await post(open(), user, await freshThread(), '徽章')
    await rejects(setBadge(mod, { id: res.comment.id, badge: 'admin' }), 403)
    expect(await setBadge(mod, { id: res.comment.id, badge: 'artist' })).toEqual({ id: res.comment.id, badge: 'artist' })
    expect(await setBadge(owner, { id: res.comment.id, badge: 'admin' })).toEqual({ id: res.comment.id, badge: 'admin' })
    const [row] = await auditRows('comment.badge', res.comment.id)
    expect(row).toMatchObject({ actorId: owner.id, actorRole: 'admin', diff: { badge: ['artist', 'admin'] } })
  })
})

describe('queue and actions', () => {
  test('approve / spam / delete / restore move between tabs, each audited, reports resolved', async () => {
    const deps = testDeps({ settings: { firstCommentReview: false, blocklist: ['广告词'] } })
    const thread = await freshThread()
    const held = await post(deps, user, thread, '广告词一条')
    expect(held.status).toBe('pending')
    const id = held.comment.id
    const before = (await commentQueue(mod, { tab: 'pending' }, deps)).counts

    expect(await findInQueue(mod, 'pending', id, deps)).toBeDefined()
    expect(await moderateComments(mod, { ids: [id], action: 'approve' }, deps)).toEqual({ done: [id], skipped: [] })
    expect((await commentRow(id)).status).toBe('published')
    expect(await findInQueue(mod, 'published', id, deps)).toBeDefined()
    const after = (await commentQueue(mod, { tab: 'pending' }, deps)).counts
    expect(after.pending).toBe(before.pending - 1)
    expect(after.published).toBe(before.published + 1)

    expect(await moderateComments(mod, { ids: [id], action: 'spam' }, deps)).toEqual({ done: [id], skipped: [] })
    expect(await findInQueue(mod, 'spam', id, deps)).toBeDefined()
    expect(await moderateComments(owner, { ids: [id], action: 'delete' }, deps)).toEqual({ done: [id], skipped: [] })
    const deleted = await commentRow(id)
    expect([deleted.status, deleted.deletedAt != null]).toEqual(['deleted', true])
    expect((await findInQueue(mod, 'deleted', id, deps))?.authorDeleted).toBe(false)
    expect(await moderateComments(mod, { ids: [id], action: 'restore' }, deps)).toEqual({ done: [id], skipped: [] })
    const restored = await commentRow(id)
    expect([restored.status, restored.deletedAt]).toEqual(['published', null])

    for (const [action, actor, from, to] of [
      ['approve', mod, 'pending', 'published'],
      ['spam', mod, 'published', 'spam'],
      ['delete', owner, 'spam', 'deleted'],
      ['restore', mod, 'deleted', 'published'],
    ] as const) {
      const [row] = await auditRows(`comment.${action}`, id)
      expect(row).toMatchObject({ actorId: actor.id, actorRole: actor.role, targetType: 'comment', diff: { status: [from, to] } })
    }
  })

  test('bulk actions; inapplicable rows are skipped; author deletes cannot be restored', async () => {
    const { deleteOwnComment } = await import('#/server/comments/write')
    const deps = testDeps()
    const thread = await freshThread()
    const a = await post(deps, await makeUser('bulk-a'), thread, '待审 A')
    const b = await post(deps, await makeUser('bulk-b'), thread, '待审 B')
    const c = await post(open(), user, thread, '已公开 C')
    const res = await moderateComments(mod, { ids: [a.comment.id, b.comment.id, c.comment.id, 999_999_999], action: 'approve' }, deps)
    expect(res.done.sort()).toEqual([a.comment.id, b.comment.id].sort())
    expect(res.skipped.sort()).toEqual([c.comment.id, 999_999_999].sort())
    expect((await auditRows('comment.approve', a.comment.id))[0]!.diff).toMatchObject({ bulk: 4 })

    await deleteOwnComment(ctxOf(user), { id: c.comment.id }, deps)
    expect((await findInQueue(mod, 'deleted', c.comment.id, deps))?.authorDeleted).toBe(true)
    expect(await moderateComments(mod, { ids: [c.comment.id], action: 'restore' }, deps)).toEqual({ done: [], skipped: [c.comment.id] })
    expect(await moderateComments(mod, { ids: [c.comment.id], action: 'delete' }, deps)).toEqual({ done: [], skipped: [c.comment.id] })
  })

  test('approving a reported comment resolves its reports and empties 被举报', async () => {
    const { reportComment } = await import('#/server/comments/write')
    const deps = testDeps({ settings: { firstCommentReview: false, reportThreshold: 2 } })
    const res = await post(deps, user, await freshThread(), '被举报两次')
    await reportComment(ctxOf(await makeUser('r1')), { id: res.comment.id }, deps)
    await reportComment(ctxOf(await makeUser('r2')), { id: res.comment.id }, deps)
    expect((await commentRow(res.comment.id)).status).toBe('pending')
    expect(await findInQueue(mod, 'reported', res.comment.id, deps)).toBeDefined()
    await moderateComments(mod, { ids: [res.comment.id], action: 'approve' }, deps)
    expect(await findInQueue(mod, 'reported', res.comment.id, deps)).toBeUndefined()
    expect((await auditRows('comment.approve', res.comment.id))[0]!.diff).toMatchObject({ reportsResolved: 2 })
  })
})

describe('审核规则 settings', () => {
  test('partial save merges, validates, writes one audit row with the diff; the real setting is read back', async () => {
    const view = await saveCommentSettings(mod, { blocklist: ['出号', '代练', '出号'], editWindowMinutes: 15, reactionStickers: { like: f.stickers[0]! } })
    expect(view.settings.blocklist).toEqual(['出号', '代练'])
    expect(view.settings.editWindowMinutes).toBe(15)
    expect(view.reactionStickers.like?.id).toBe(f.stickers[0]!)
    expect(view.reactionStickers.lol).toBeNull()
    const stored = await getSetting('comments')
    expect(stored).toMatchObject({ blocklist: ['出号', '代练'], editWindowMinutes: 15, guestsAllowed: true })
    const [row] = await auditRows('settings.comments.update', 'comments')
    expect(row).toMatchObject({ actorId: mod.id, actorRole: 'manager', targetType: 'setting' })
    expect(row!.diff).toMatchObject({ blocklist: [[], ['出号', '代练']], editWindowMinutes: [10, 15] })
    // the live thread config follows (default deps read the real setting)
    const page = await listThread(ctxOf(null), { threadType: 'pack', threadId: String(f.pack.id) })
    expect(page.config.editWindowMinutes).toBe(15)
    expect(page.config.reactionStickers.like?.poster).toContain(f.stickers[0]!)
  })

  test('unknown keys, bad values and unusable reaction stickers are rejected', async () => {
    await expect(saveCommentSettings(mod, { bannedUserIds: ['x'] })).rejects.toThrow()
    await expect(saveCommentSettings(mod, { editWindowMinutes: -1 })).rejects.toThrow()
    await rejects(saveCommentSettings(mod, { reactionStickers: { wow: f.hiddenEmoji } }), 400, '回应贴纸')
  })

  test('saving the same values writes nothing', async () => {
    const n = (await auditRows('settings.comments.update', 'comments')).length
    await saveCommentSettings(mod, { editWindowMinutes: 15 })
    expect((await auditRows('settings.comments.update', 'comments')).length).toBe(n)
    // back to the defaults for the other files
    const { bannedUserIds: _banned, ...defaults } = DEFAULTS
    await saveCommentSettings(owner, defaults)
    expect((await getSetting('comments')).editWindowMinutes).toBe(DEFAULTS.editWindowMinutes)
  })
})

describe('禁止评论', () => {
  test('ban and unban (audited); a banned account cannot comment', async () => {
    const target = await makeUser('ban-target')
    expect(await banCommenter(mod, { userId: target.id, banned: true })).toEqual({ userId: target.id, banned: true })
    expect((await getSetting('comments')).bannedUserIds).toContain(target.id)
    const live = testDeps()
    live.settings = () => getSetting('comments')
    await rejects(post(live, target, await freshThread(), '我被禁了'), 403)
    const view = await readCommentSettings(mod)
    expect(view.banned).toContainEqual({ id: target.id, name: 'ban-target' })
    await banCommenter(mod, { userId: target.id, banned: false })
    expect((await getSetting('comments')).bannedUserIds).not.toContain(target.id)
    expect((await auditRows('comment.ban_user', target.id))[0]).toMatchObject({ actorId: mod.id, targetType: 'user' })
    expect((await auditRows('comment.unban_user', target.id)).length).toBe(1)
  })

  test('管理员 cannot ban 站长 or other 管理员; nobody bans themselves', async () => {
    const otherMod = await makeUser('mod2', 'manager')
    await rejects(banCommenter(mod, { userId: owner.id, banned: true }), 403)
    await rejects(banCommenter(mod, { userId: otherMod.id, banned: true }), 403)
    await rejects(banCommenter(mod, { userId: mod.id, banned: true }), 400)
    expect((await banCommenter(owner, { userId: otherMod.id, banned: true })).banned).toBe(true)
    await banCommenter(owner, { userId: otherMod.id, banned: false })
  })
})

describe('rate limits (per IP hash and per account)', () => {
  test(`${RATE.perMinute} per minute per IP for guests`, async () => {
    const deps = testDeps({ settings: { firstCommentReview: false }, realRateLimits: true })
    const thread = await freshThread()
    const ip = nextIp()
    await freshMinute()
    for (let i = 0; i < RATE.perMinute; i++) await post(deps, null, thread, `游客 ${i}`, { ip })
    await rejects(post(deps, null, thread, '超了', { ip }), 429)
    // another IP is not affected
    expect((await post(deps, null, thread, '换个 IP', { ip: nextIp() })).status).toBe('published')
  })

  test(`${RATE.perMinute} per minute per account, across IPs`, async () => {
    const deps = testDeps({ settings: { firstCommentReview: false }, realRateLimits: true })
    const thread = await freshThread()
    const spammer = await makeUser('fast-typer')
    await freshMinute()
    for (let i = 0; i < RATE.perMinute; i++) await post(deps, spammer, thread, `第 ${i} 条`)
    await rejects(post(deps, spammer, thread, '换 IP 也不行'), 429)
  })

  test(`${RATE.perDay} per day`, async () => {
    const counts = new Map<string, number>()
    const deps = testDeps({
      settings: { firstCommentReview: false },
      hit: async (subject, bucket) => {
        const key = `${subject}|${bucket}`
        const next = (counts.get(key) ?? (bucket.endsWith(':1d') ? RATE.perDay - 1 : 0)) + 1
        counts.set(key, next)
        return next
      },
    })
    const thread = await freshThread()
    const u = await makeUser('daily')
    expect((await post(deps, u, thread, '第 50 条')).status).toBe('published')
    await rejects(post(deps, u, thread, '第 51 条'), 429, '明天')
  })

  test('counter rows are keyed by the window end, so the hourly-stale prune never resets a day window', async () => {
    const { hitWindowByEnd } = await import('#/server/comments/common')
    const { db, schema } = await import('#/server/db/client')
    const { and, eq } = await import('drizzle-orm')
    const subject = `test:${nextIp()}`
    expect(await hitWindowByEnd(subject, 'cm:1d', 86_400)).toBe(1)
    expect(await hitWindowByEnd(subject, 'cm:1d', 86_400)).toBe(2)
    const [row] = await db()
      .select()
      .from(schema.rateWindows)
      .where(and(eq(schema.rateWindows.subject, subject), eq(schema.rateWindows.bucket, 'cm:1d')))
    expect(row!.windowStart.getTime()).toBeGreaterThan(Date.now())
    expect(row!.windowStart.getTime() % 86_400_000).toBe(0)
    const { pruneWindows } = await import('#/server/ratelimit')
    await pruneWindows(3600)
    expect(await hitWindowByEnd(subject, 'cm:1d', 86_400)).toBe(3)
  })

  test('the Cap token is verified before the rate counters are touched', async () => {
    const touched: string[] = []
    const deps = testDeps({ settings: { firstCommentReview: false }, hit: async (s, b) => (touched.push(`${s}|${b}`), 1) })
    await rejects(post(deps, null, await freshThread(), '无令牌', { cap: null }), 400)
    expect(touched).toEqual([])
  })
})

async function freshMinute() {
  const s = new Date().getSeconds()
  if (s >= 50) await Bun.sleep((61 - s) * 1000)
}
