import { nextIp } from '../integration/setup'
import { beforeAll, describe, expect, test } from 'bun:test'
import { blocklistMatch, compileBlocklist } from '#/server/comments/moderation'
import { editComment, reportComment } from '#/server/comments/write'
import { auditRows, commentRow, ctxOf, findInQueue, freshThread, insertComments, makeUser, post, ready, rejects, testDeps, type TestActor } from './fixture'

// Moderation on create and edit, the report threshold, and the reasons shown in the queue.

let mod: TestActor
let owner: TestActor

beforeAll(async () => {
  await ready()
  mod = await makeUser('mod', 'manager')
  owner = await makeUser('owner', 'admin')
}, 120_000)

describe('first comment review', () => {
  test("a member's first comment is held; after approval the next one is published", async () => {
    const { moderateComments } = await import('#/server/comments/admin')
    const deps = testDeps()
    const u = await makeUser('newbie')
    const thread = await freshThread()
    const first = await post(deps, u, thread, '第一次发言')
    expect(first.status).toBe('pending')
    expect(first.comment.state).toBe('pending')
    // still the first published one is missing: the second is held too
    expect((await post(deps, u, thread, '第二条')).status).toBe('pending')
    await moderateComments(mod, { ids: [first.comment.id], action: 'approve' }, deps)
    expect((await post(deps, u, thread, '第三条')).status).toBe('published')
  })

  test('guests are matched by IP hash', async () => {
    const deps = testDeps()
    const { moderateComments } = await import('#/server/comments/admin')
    const ip = nextIp()
    const thread = await freshThread()
    const a = await post(deps, null, thread, '游客首评', { ip })
    expect(a.status).toBe('pending')
    await moderateComments(mod, { ids: [a.comment.id], action: 'approve' }, deps)
    expect((await post(deps, null, thread, '同一 IP', { ip })).status).toBe('published')
    expect((await post(deps, null, thread, '换了 IP', { ip: nextIp() })).status).toBe('pending')
  })

  test('the setting turns it off', async () => {
    const deps = testDeps({ settings: { firstCommentReview: false } })
    expect((await post(deps, await makeUser('free'), await freshThread(), '直接公开')).status).toBe('published')
  })
})

describe('content rules', () => {
  const deps = () => testDeps({ settings: { firstCommentReview: false, blocklist: ['代练', '加群*领', 'v信'] } })

  test('one link is fine, two or more are held', async () => {
    const u = await makeUser('linker')
    const thread = await freshThread()
    expect((await post(deps(), u, thread, '来源 https://a.example')).status).toBe('published')
    expect((await post(deps(), u, thread, 'https://a.example 和 https://b.example')).status).toBe('pending')
    expect((await post(deps(), u, thread, '[一](https://a.example) 加 spam.example.com')).status).toBe('pending')
  })

  test('blocklist hits are held: case, width, whitespace and wildcards', async () => {
    const u = await makeUser('blocked-words')
    const thread = await freshThread()
    expect((await post(deps(), u, thread, '专业代练')).status).toBe('pending')
    expect((await post(deps(), u, thread, '加群 123 领福利')).status).toBe('pending')
    expect((await post(deps(), u, thread, '加 V 信')).status).toBe('pending')
    expect((await post(deps(), u, thread, '加Ｖ信')).status).toBe('pending')
    expect((await post(deps(), u, thread, '正常评论')).status).toBe('published')
    // guest names are checked too
    expect((await post(deps(), null, thread, '你好', { guestName: '代练小王' })).status).toBe('pending')
  })

  test('blocklist matching is literal apart from *', () => {
    expect(blocklistMatch(['a.b'], 'axb')).toBeNull()
    expect(blocklistMatch(['(x'], 'y(x')).toBe('(x')
    expect(compileBlocklist(['*', '  '])).toBeNull()
  })

  test('new authors in a hot thread are held; older accounts are not', async () => {
    const thread = await freshThread()
    await insertComments(thread, 20, { createdAt: (i) => new Date(Date.now() - (i + 1) * 60_000) })
    const fresh = await makeUser('fresh', 'user', { ageMs: 3600_000 })
    const veteran = await makeUser('veteran')
    const d = testDeps({ settings: { firstCommentReview: false } })
    expect((await post(d, fresh, thread, '新号进热帖')).status).toBe('pending')
    expect((await post(d, veteran, thread, '老号进热帖')).status).toBe('published')
    expect((await post(d, null, thread, '游客进热帖')).status).toBe('pending')
    // a quiet thread does not hold the new account
    expect((await post(d, fresh, await freshThread(), '新号进冷帖')).status).toBe('published')
  })

  test('staff are never held', async () => {
    const d = testDeps({ settings: { blocklist: ['代练'] } })
    const res = await post(d, mod, await freshThread(), '代练 https://a.example https://b.example')
    expect(res.status).toBe('published')
    expect(res.comment.badge).toBe('manager')
    expect((await post(d, owner, await freshThread(), '站长')).comment.badge).toBe('admin')
  })

  test('an edit that adds links sends a published comment back to review', async () => {
    const d = deps()
    const u = await makeUser('editor')
    const res = await post(d, u, await freshThread(), '原文')
    expect(res.status).toBe('published')
    const edited = await editComment(ctxOf(u), { id: res.comment.id, body: '改成 https://a.example https://b.example' }, d)
    expect(edited.status).toBe('pending')
    expect((await commentRow(res.comment.id)).status).toBe('pending')
  })
})

describe('reports', () => {
  test('once per account; the third open report moves the comment back to pending (audited)', async () => {
    const d = testDeps({ settings: { firstCommentReview: false } })
    const author = await makeUser('reported-author')
    const res = await post(d, author, await freshThread(), '有争议的评论')
    const [r1, r2, r3] = await Promise.all([makeUser('rep1'), makeUser('rep2'), makeUser('rep3')])
    expect(await reportComment(ctxOf(r1), { id: res.comment.id, reason: '广告' }, d)).toEqual({ already: false, hidden: false })
    expect(await reportComment(ctxOf(r1), { id: res.comment.id }, d)).toEqual({ already: true, hidden: false })
    expect(await reportComment(ctxOf(r2), { id: res.comment.id }, d)).toEqual({ already: false, hidden: false })
    expect((await commentRow(res.comment.id)).status).toBe('published')
    expect(await reportComment(ctxOf(r3), { id: res.comment.id, reason: '引战' }, d)).toEqual({ already: false, hidden: true })
    expect((await commentRow(res.comment.id)).status).toBe('pending')
    const [row] = await auditRows('comment.autohide', res.comment.id)
    expect(row).toMatchObject({ actorId: null, diff: { status: ['published', 'pending'], openReports: 3 } })

    const item = (await findInQueue(mod, 'reported', res.comment.id, d))!
    expect(item.reports).toMatchObject({ open: 3, total: 3 })
    expect(item.reports.reasons.sort()).toEqual(['广告', '引战'].sort())
    expect(item.reasons).toContain('reported')
  })

  test('the threshold is a setting; own comments and guests cannot report', async () => {
    const d = testDeps({ settings: { firstCommentReview: false, reportThreshold: 1 } })
    const author = await makeUser('thr-author')
    const res = await post(d, author, await freshThread(), '一次就隐藏')
    await rejects(reportComment(ctxOf(author), { id: res.comment.id }, d), 400, '自己')
    await rejects(reportComment(ctxOf(null), { id: res.comment.id }, d), 401)
    expect((await reportComment(ctxOf(await makeUser('thr-rep')), { id: res.comment.id }, d)).hidden).toBe(true)
  })
})

describe('queue reasons are recomputed when read', () => {
  test('first comment, links and blocklist', async () => {
    const d = testDeps({ settings: { blocklist: ['代练'] } })
    const u = await makeUser('reasons')
    const res = await post(d, u, await freshThread(), '代练 https://a.example https://b.example')
    expect(res.status).toBe('pending')
    const item = (await findInQueue(mod, 'pending', res.comment.id, d))!
    expect(item.reasons.sort()).toEqual(['blocklist', 'first', 'links'])
    expect(item.author).toMatchObject({ name: 'reasons', guest: false, userId: u.id, banned: false })
    expect(item.ipHash).toMatch(/^[0-9a-f]{4}…[0-9a-f]{2}$/)
    expect(item.html).toContain('rel="nofollow ugc noopener"')
  })
})
