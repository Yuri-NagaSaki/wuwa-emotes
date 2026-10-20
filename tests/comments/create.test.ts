import { goodToken, nextIp } from '../integration/setup'
import { beforeAll, describe, expect, test } from 'bun:test'
import { ZodError } from 'zod'
import { issueFormToken } from '#/server/comments/form-token'
import { hashValue } from '#/server/http/client'
import {
  commentCount,
  commentRow,
  freshThread,
  makeUser,
  notificationsOf,
  oldFormToken,
  packThread,
  post,
  ready,
  rejects,
  seedFixture,
  testDeps,
  type Fixture,
  type TestActor,
} from './fixture'

// Creating comments: guests and Cap, the form traps, settings gates, replies and notifications.

let f: Fixture
let alice: TestActor
let bob: TestActor

beforeAll(async () => {
  await ready()
  f = await seedFixture()
  alice = await makeUser('alice')
  bob = await makeUser('bob')
}, 120_000)

const open = () => testDeps({ settings: { firstCommentReview: false } })

describe('guests need a valid Cap token, verified before anything is written', () => {
  test('without a token: 400, nothing stored', async () => {
    const deps = open()
    const thread = await freshThread()
    await rejects(post(deps, null, thread, '没有令牌', { cap: null }), 400, '请先完成人机验证')
    expect(await commentCount(thread.threadId)).toBe(0)
  })

  test('with an invalid token: 400, nothing stored', async () => {
    const deps = open()
    const thread = await freshThread()
    await rejects(post(deps, null, thread, '伪造令牌', { cap: 'forged-token' }), 400, '人机验证已过期或无效')
    expect(await commentCount(thread.threadId)).toBe(0)
  })

  test('with a valid token: stored as a guest comment; the email is kept only as a salted hash', async () => {
    const deps = open()
    const thread = await freshThread()
    const res = await post(deps, null, thread, '游客你好', { guestName: '  游客  小鱼 ', guestEmail: 'Fish@Example.com' })
    expect(res.status).toBe('published')
    expect(res.comment.author).toMatchObject({ name: '游客 小鱼', guest: true })
    const row = await commentRow(res.comment.id)
    expect(row.authorId).toBeNull()
    expect(row.guestName).toBe('游客 小鱼')
    expect(row.guestEmailHash).toBe(hashValue('fish@example.com'))
    expect(row.ipHash).toMatch(/^[0-9a-f]{32}$/)
    expect(JSON.stringify(row)).not.toContain('Fish@Example.com')
  })

  test('a token works once: reusing it is rejected', async () => {
    const deps = open()
    const thread = await freshThread()
    const token = goodToken()
    await post(deps, null, thread, '第一次', { cap: token })
    await rejects(post(deps, null, thread, '第二次', { cap: token }), 400)
    expect(await commentCount(thread.threadId)).toBe(1)
  })

  test('validation errors happen before Cap, so they do not burn the token', async () => {
    const deps = open()
    const thread = await freshThread()
    const token = goodToken()
    await rejects(post(deps, null, thread, `坏贴纸 :s[${f.hiddenEmoji}]`, { cap: token }), 400, '贴纸')
    await rejects(post(deps, null, thread, '没名字', { cap: token, guestName: '   ' }), 400, '昵称')
    expect(deps.capCalls).toBe(0)
    const ok = await post(deps, null, thread, '令牌还能用', { cap: token })
    expect(ok.status).toBe('published')
    expect(deps.capCalls).toBe(1)
  })

  test('a malformed guest email is rejected with a readable message, before Cap', async () => {
    const deps = open()
    const err = await post(deps, null, await freshThread(), '邮箱写错', { guestEmail: 'not-an-email' }).catch((e) => e)
    expect(err).toBeInstanceOf(ZodError)
    expect((err as ZodError).issues[0]?.message).toBe('邮箱格式不对')
    expect(deps.capCalls).toBe(0)
  })

  test('Cap unavailable fails closed (503)', async () => {
    const deps = open()
    deps.verifyCap = async () => ({ ok: false, reason: 'unavailable' })
    const thread = await freshThread()
    await rejects(post(deps, null, thread, '服务挂了'), 503)
    expect(await commentCount(thread.threadId)).toBe(0)
  })

  test('signed-in users do not need Cap', async () => {
    const deps = open()
    const res = await post(deps, alice, await freshThread(), '登录用户', { cap: null })
    expect(res.status).toBe('published')
    expect(deps.capCalls).toBe(0)
  })

  test('guest comments switched off: 403 for guests, members still post', async () => {
    const deps = testDeps({ settings: { firstCommentReview: false, guestsAllowed: false } })
    const thread = await freshThread()
    await rejects(post(deps, null, thread, '游客'), 403, '请登录')
    expect((await post(deps, alice, thread, '会员')).status).toBe('published')
  })
})

describe('form traps', () => {
  test('a filled honeypot field is rejected', async () => {
    const deps = open()
    const thread = await freshThread()
    await rejects(post(deps, alice, thread, '机器人', { website: 'https://spam.example' }), 400)
    expect(await commentCount(thread.threadId)).toBe(0)
  })

  test('posting within 3 s of getting the form is rejected', async () => {
    const deps = open()
    const thread = await freshThread()
    await rejects(post(deps, alice, thread, '太快', { formToken: issueFormToken(deps.clock.t - 1000) }), 400, '太快')
    expect((await post(deps, alice, thread, '刚好', { formToken: issueFormToken(deps.clock.t - 3000) })).status).toBe('published')
  })

  test('forged, malformed or stale form tokens are rejected', async () => {
    const deps = open()
    const thread = await freshThread()
    const real = oldFormToken(deps)
    const forged = real.replace(/\.(.)/, (_, c: string) => '.' + (c === 'A' ? 'B' : 'A'))
    await rejects(post(deps, alice, thread, 'x', { formToken: forged }), 400, '刷新')
    await rejects(post(deps, alice, thread, 'x', { formToken: 'nope' }), 400, '刷新')
    await rejects(post(deps, alice, thread, 'x', { formToken: issueFormToken(deps.clock.t - 25 * 3600_000) }), 400, '停留太久')
  })
})

describe('targets and content', () => {
  test('threads must exist and be public', async () => {
    const deps = open()
    await rejects(post(deps, alice, { threadType: 'pack', threadId: String(f.hiddenPack.id) }, '隐藏包'), 404)
    await rejects(post(deps, alice, { threadType: 'pack', threadId: '999999999' }, '不存在'), 404)
    await rejects(post(deps, alice, { threadType: 'pack', threadId: 'aimisi-01' }, 'slug 不是 id'), 404)
    await rejects(post(deps, alice, { threadType: 'emoji', threadId: f.pendingEmoji }, '待审表情'), 404)
    const e = await post(deps, alice, { threadType: 'emoji', threadId: f.emojiThread }, '单张表情评论')
    expect(e.comment.threadType).toBe('emoji')
  })

  test('an empty body is rejected; a sticker alone is fine', async () => {
    const deps = open()
    const thread = await freshThread()
    await rejects(post(deps, alice, thread, '   \n '), 400)
    expect((await post(deps, alice, thread, `:s[${f.stickers[0]}]`)).status).toBe('published')
  })

  test('banned commenters get 403', async () => {
    const carol = await makeUser('carol')
    const deps = testDeps({ settings: { firstCommentReview: false, bannedUserIds: [carol.id] } })
    await rejects(post(deps, carol, await freshThread(), '我被禁言了'), 403, '禁止评论')
  })
})

describe('replies (楼中楼, one level)', () => {
  test('a reply to a reply stays under the root and names the parent author', async () => {
    const deps = open()
    const thread = await freshThread()
    const root = await post(deps, alice, thread, '楼主')
    const r1 = await post(deps, bob, thread, '一楼回复', { parentId: root.comment.id })
    const r2 = await post(deps, alice, thread, '回复 bob', { parentId: r1.comment.id })
    expect(r1.comment).toMatchObject({ rootId: root.comment.id, parentId: root.comment.id, replyTo: null })
    expect(r2.comment).toMatchObject({ rootId: root.comment.id, parentId: r1.comment.id, replyTo: 'bob' })
  })

  test('replying across threads or to a hidden comment is rejected', async () => {
    const deps = open()
    const a = await freshThread()
    const b = await freshThread()
    const root = await post(deps, alice, a, 'A 串')
    await rejects(post(deps, bob, b, '串门', { parentId: root.comment.id }), 404)
    const held = await post(testDeps({ settings: { firstCommentReview: false, blocklist: ['禁词'] } }), bob, a, '带禁词')
    expect(held.status).toBe('pending')
    await rejects(post(deps, alice, a, '回复待审', { parentId: held.comment.id }), 404)
  })
})

describe('notifications on reply', () => {
  test('the parent author gets comment.reply; not for self-replies; not for guest parents', async () => {
    const deps = open()
    const thread = await freshThread()
    const dave = await makeUser('dave')
    const erin = await makeUser('erin')
    const root = await post(deps, dave, thread, '我的楼')
    const before = (await notificationsOf(dave.id)).length
    const reply = await post(deps, erin, thread, '回复 dave :s[' + f.stickers[1] + ']', { parentId: root.comment.id })
    const after = await notificationsOf(dave.id)
    expect(after.length).toBe(before + 1)
    expect(after[0]).toMatchObject({ kind: 'comment.reply', readAt: null })
    expect(after[0]!.payload).toMatchObject({
      commentId: reply.comment.id,
      parentId: root.comment.id,
      rootId: root.comment.id,
      threadType: 'pack',
      threadId: thread.threadId,
      by: 'erin',
      excerpt: '回复 dave [贴纸]',
    })
    // the payload is plain text, never HTML
    expect(JSON.stringify(after[0]!.payload)).not.toContain('<')

    await post(deps, dave, thread, '自己回复自己', { parentId: root.comment.id })
    expect((await notificationsOf(dave.id)).length).toBe(before + 1)

    const guestRoot = await post(deps, null, thread, '游客的楼')
    await post(deps, erin, thread, '回复游客', { parentId: guestRoot.comment.id })
    expect((await notificationsOf(erin.id)).length).toBe(0)
  })

  test('a held reply notifies only once it is approved', async () => {
    const { moderateComments } = await import('#/server/comments/admin')
    const deps = open()
    const thread = await freshThread()
    const frank = await makeUser('frank')
    const mod = await makeUser('mod-n', 'manager')
    const root = await post(deps, frank, thread, 'frank 的楼')
    const held = await post(testDeps({ settings: { firstCommentReview: false, blocklist: ['加群'] } }), bob, thread, '加群领福利', {
      parentId: root.comment.id,
      ip: nextIp(),
    })
    expect(held.status).toBe('pending')
    expect((await notificationsOf(frank.id)).length).toBe(0)
    await moderateComments(mod, { ids: [held.comment.id], action: 'approve' }, deps)
    expect((await notificationsOf(frank.id)).length).toBe(1)
    // approving again (or spam → approve) never duplicates it
    await moderateComments(mod, { ids: [held.comment.id], action: 'spam' }, deps)
    await moderateComments(mod, { ids: [held.comment.id], action: 'approve' }, deps)
    expect((await notificationsOf(frank.id)).length).toBe(1)
  })
})

test('the pack fixture thread accepts comments', async () => {
  const res = await post(open(), alice, packThread(f), '包页评论')
  expect(res.comment.threadId).toBe(String(f.pack.id))
})
