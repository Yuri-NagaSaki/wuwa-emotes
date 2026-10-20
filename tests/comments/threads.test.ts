import { beforeAll, describe, expect, test } from 'bun:test'
import { moderateComments, setPinned } from '#/server/comments/admin'
import { MAX_STICKERS, REPLY_PREVIEW, ROOTS_PER_PAGE } from '#/server/comments/constants'
import { listReplies, listThread, myComments, stickerSource } from '#/server/comments/read'
import type { ThreadPage, ThreadRoot } from '#/server/comments/types'
import { deleteOwnComment, editComment, toggleReaction } from '#/server/comments/write'
import { auditRows, commentRow, ctxOf, freshThread, insertComments, makeUser, post, ready, rejects, seedFixture, testDeps, type Fixture, type TestActor } from './fixture'

// Reading threads (sorts, cursors, replies, tombstones), the edit window, reactions, pins, stickers.

let f: Fixture
let alice: TestActor
let bob: TestActor
let mod: TestActor

beforeAll(async () => {
  await ready()
  f = await seedFixture()
  alice = await makeUser('alice')
  bob = await makeUser('bob')
  mod = await makeUser('mod', 'manager')
}, 120_000)

const open = () => testDeps({ settings: { firstCommentReview: false } })

async function allRoots(viewer: TestActor | null, thread: { threadType: 'pack' | 'emoji'; threadId: string }, sort: 'hot' | 'new' | 'old', deps = open()) {
  const pages: ThreadPage[] = []
  let cursor: string | undefined
  for (let i = 0; i < 20; i++) {
    const page = await listThread(ctxOf(viewer), { ...thread, sort, cursor }, deps)
    pages.push(page)
    if (!page.nextCursor) break
    cursor = page.nextCursor
  }
  return { pages, roots: pages.flatMap((p) => p.items) }
}

describe('sorting and pagination', () => {
  test('new / old / hot, pinned first, cursors without duplicates', async () => {
    const thread = await freshThread()
    const base = Date.now() - 3 * 3600_000
    const ids = await insertComments(thread, ROOTS_PER_PAGE + 5, { createdAt: (i) => new Date(base + i * 1000) })
    const deps = open()
    // a few reactions and replies make one comment the hottest
    const hot = ids[3]!
    await toggleReaction(ctxOf(alice), { id: hot, key: 'like' }, deps)
    await post(deps, bob, thread, '回复热评', { parentId: hot })
    await setPinned(mod, { id: ids[10]!, pinned: true })

    const byNew = await allRoots(null, thread, 'new')
    expect(byNew.pages.length).toBe(2)
    expect(byNew.roots.length).toBe(ids.length)
    expect(new Set(byNew.roots.map((r) => r.id)).size).toBe(ids.length)
    expect(byNew.roots[0]!.id).toBe(ids[10]!)
    expect(byNew.roots[0]!.pinned).toBe(true)
    expect(byNew.roots[1]!.id).toBe(ids[ids.length - 1]!)

    const byOld = await allRoots(null, thread, 'old')
    expect(byOld.roots.map((r) => r.id)).toEqual([ids[10]!, ...ids.filter((id) => id !== ids[10])])

    const byHot = await allRoots(null, thread, 'hot')
    expect(byHot.roots.length).toBe(ids.length)
    expect(new Set(byHot.roots.map((r) => r.id)).size).toBe(ids.length)
    expect(byHot.roots[0]!.id).toBe(ids[10]!)
    expect(byHot.roots[1]!.id).toBe(hot)

    expect(byNew.pages[0]!.total).toBe(ids.length + 1)
  })

  test('a cursor from another thread or sort is rejected (400)', async () => {
    const thread = await freshThread()
    await insertComments(thread, ROOTS_PER_PAGE + 1)
    const page = await listThread(ctxOf(null), { ...thread, sort: 'new' }, open())
    expect(page.nextCursor).not.toBeNull()
    await rejects(listThread(ctxOf(null), { ...thread, sort: 'old', cursor: page.nextCursor! }, open()), 400)
    await rejects(listThread(ctxOf(null), { ...(await freshThread()), sort: 'new', cursor: page.nextCursor! }, open()), 400)
    await rejects(listThread(ctxOf(null), { ...thread, sort: 'new', cursor: 'bm90LWEtY3Vyc29y' }, open()), 400)
  })

  test('malformed thread ids are a 404', async () => {
    await rejects(listThread(ctxOf(null), { threadType: 'pack', threadId: 'abc' }, open()), 404)
    await rejects(listThread(ctxOf(null), { threadType: 'emoji', threadId: 'r-zz' }, open()), 404)
  })
})

describe('replies', () => {
  test(`the first ${REPLY_PREVIEW} replies come with the root; the rest page through listReplies`, async () => {
    const deps = open()
    const thread = await freshThread()
    const root = await post(deps, alice, thread, '楼主')
    const replyIds: number[] = []
    for (let i = 0; i < REPLY_PREVIEW + 4; i++) {
      deps.clock.advance(1000)
      replyIds.push((await post(deps, i % 2 ? alice : bob, thread, `回复 ${i}`, { parentId: root.comment.id })).comment.id)
    }
    const page = await listThread(ctxOf(null), { ...thread, sort: 'new' }, deps)
    const r = page.items[0]!
    expect(r.replyCount).toBe(replyIds.length)
    expect(r.replies.map((x) => x.id)).toEqual(replyIds.slice(0, REPLY_PREVIEW))
    expect(r.repliesCursor).not.toBeNull()
    const rest = await listReplies(ctxOf(null), { rootId: root.comment.id, cursor: r.repliesCursor! }, deps)
    expect(rest.items.map((x) => x.id)).toEqual(replyIds.slice(REPLY_PREVIEW))
    expect(rest.nextCursor).toBeNull()
    expect(page.total).toBe(1 + replyIds.length)
  })
})

describe('visibility', () => {
  test('own pending comments are visible to their author only', async () => {
    const deps = testDeps()
    const thread = await freshThread()
    const newbie = await makeUser('pending-author')
    const held = await post(deps, newbie, thread, '待审核的评论')
    expect(held.status).toBe('pending')
    const mine = await listThread(ctxOf(newbie), { ...thread, sort: 'new' }, deps)
    expect(mine.items.map((i) => [i.id, i.state])).toEqual([[held.comment.id, 'pending']])
    expect(mine.items[0]!.html).toContain('待审核的评论')
    expect(mine.total).toBe(0)
    const other = await listThread(ctxOf(bob), { ...thread, sort: 'new' }, deps)
    expect(other.items).toEqual([])
    const anon = await listThread(ctxOf(null), { ...thread, sort: 'new' }, deps)
    expect(anon.items).toEqual([])
  })

  test('viewer and config in the page', async () => {
    const deps = testDeps({ settings: { firstCommentReview: false, bannedUserIds: [bob.id], editWindowMinutes: 5 } })
    const thread = await freshThread()
    const page = await listThread(ctxOf(bob), { ...thread }, deps)
    expect(page.viewer).toEqual({ id: bob.id, name: 'bob', staff: false, banned: true })
    expect(page.config).toMatchObject({ guestsAllowed: true, stickersAllowed: true, editWindowMinutes: 5, maxStickers: MAX_STICKERS })
    expect(page.formToken).toMatch(/^\d{13}\.[A-Za-z0-9_-]{32}$/)
    expect((await listThread(ctxOf(mod), { ...thread }, deps)).viewer?.staff).toBe(true)
    expect((await listThread(ctxOf(null), { ...thread }, deps)).viewer).toBeNull()
  })
})

describe('edit window', () => {
  test('authors edit within the window (edited_at set); later or others are refused', async () => {
    const deps = open()
    const thread = await freshThread()
    const res = await post(deps, alice, thread, '有错别字')
    expect(res.comment.editableUntil).not.toBeNull()
    expect(res.comment.bodySrc).toBe('有错别字')
    deps.clock.advance(9 * 60_000)
    const edited = await editComment(ctxOf(alice), { id: res.comment.id, body: '改好了' }, deps)
    expect(edited.comment.html).toContain('改好了')
    expect(edited.comment.editedAt).not.toBeNull()
    expect((await commentRow(res.comment.id)).editedAt).not.toBeNull()
    const [a] = await auditRows('comment.edit', res.comment.id)
    expect(a).toMatchObject({ actorId: alice.id, diff: { body: ['有错别字', '改好了'] } })

    await rejects(editComment(ctxOf(bob), { id: res.comment.id, body: '别人改' }, deps), 404)
    await rejects(editComment(ctxOf(null), { id: res.comment.id, body: '游客改' }, deps), 401)
    deps.clock.advance(2 * 60_000)
    await rejects(editComment(ctxOf(alice), { id: res.comment.id, body: '超时' }, deps), 403, '分钟')
    const page = await listThread(ctxOf(alice), { ...thread, sort: 'new' }, deps)
    expect(page.items[0]!.editableUntil).toBeNull()
    expect(page.items[0]!.bodySrc).toBeNull()
  })

  test('the window is a setting', async () => {
    const deps = testDeps({ settings: { firstCommentReview: false, editWindowMinutes: 1 } })
    const res = await post(deps, alice, await freshThread(), '一分钟')
    deps.clock.advance(61_000)
    await rejects(editComment(ctxOf(alice), { id: res.comment.id, body: '晚了' }, deps), 403)
  })

  test('other readers never get body_src', async () => {
    const deps = open()
    const thread = await freshThread()
    await post(deps, alice, thread, '源文 **粗**')
    const page = await listThread(ctxOf(bob), { ...thread }, deps)
    expect(page.items[0]!.bodySrc).toBeNull()
    expect(page.items[0]!.html).toContain('<strong>粗</strong>')
  })
})

describe('delete keeps a tombstone while replies exist', () => {
  test('author delete: root becomes 已删除 with its replies; without replies it disappears', async () => {
    const deps = open()
    const thread = await freshThread()
    const root = await post(deps, alice, thread, '会被删除')
    const reply = await post(deps, bob, thread, '我还在', { parentId: root.comment.id })
    const lonely = await post(deps, alice, thread, '没人回复')
    const gone = await deleteOwnComment(ctxOf(alice), { id: root.comment.id }, deps)
    expect(gone.state).toBe('deleted')
    expect(gone.html).toBeNull()
    await deleteOwnComment(ctxOf(alice), { id: lonely.comment.id }, deps)
    await rejects(deleteOwnComment(ctxOf(bob), { id: lonely.comment.id }, deps), 404)

    const page = await listThread(ctxOf(null), { ...thread, sort: 'old' }, deps)
    expect(page.items.length).toBe(1)
    const t: ThreadRoot = page.items[0]!
    expect(t).toMatchObject({ id: root.comment.id, state: 'deleted', html: null, author: null, reactions: [] })
    expect(t.replies.map((r) => [r.id, r.state])).toEqual([[reply.comment.id, 'visible']])
    expect(page.total).toBe(1)
    const row = await commentRow(root.comment.id)
    expect(row.deletedAt).not.toBeNull()
    expect(row.status).toBe('published')
    expect((await auditRows('comment.delete_own', root.comment.id)).length).toBe(1)
  })

  test('a moderator-held root with replies shows as 已隐藏', async () => {
    const deps = open()
    const thread = await freshThread()
    const root = await post(deps, alice, thread, '后来被判垃圾')
    await post(deps, bob, thread, '回复', { parentId: root.comment.id })
    await moderateComments(mod, { ids: [root.comment.id], action: 'spam' }, deps)
    const page = await listThread(ctxOf(null), { ...thread }, deps)
    expect(page.items[0]).toMatchObject({ id: root.comment.id, state: 'hidden', html: null })
    expect(page.items[0]!.replies.length).toBe(1)
  })
})

describe('reactions', () => {
  test('toggle on and off, counted per key, mine flag', async () => {
    const deps = open()
    const res = await post(deps, alice, await freshThread(), '回应我')
    const id = res.comment.id
    expect(await toggleReaction(ctxOf(bob), { id, key: 'lol' }, deps)).toEqual([{ key: 'lol', n: 1, mine: true }])
    expect(await toggleReaction(ctxOf(alice), { id, key: 'lol' }, deps)).toEqual([{ key: 'lol', n: 2, mine: true }])
    expect(await toggleReaction(ctxOf(alice), { id, key: 'like' }, deps)).toEqual([
      { key: 'like', n: 1, mine: true },
      { key: 'lol', n: 2, mine: true },
    ])
    expect(await toggleReaction(ctxOf(bob), { id, key: 'lol' }, deps)).toEqual([
      { key: 'like', n: 1, mine: false },
      { key: 'lol', n: 1, mine: false },
    ])
  })

  test('guests, unknown keys and deleted comments are refused', async () => {
    const deps = open()
    const res = await post(deps, alice, await freshThread(), '回应规则')
    await rejects(toggleReaction(ctxOf(null), { id: res.comment.id, key: 'like' }, deps), 401)
    await expect(toggleReaction(ctxOf(bob), { id: res.comment.id, key: 'heart' }, deps)).rejects.toThrow()
    await deleteOwnComment(ctxOf(alice), { id: res.comment.id }, deps)
    await rejects(toggleReaction(ctxOf(bob), { id: res.comment.id, key: 'like' }, deps), 404)
  })
})

describe('pin', () => {
  test('roots only; audited', async () => {
    const deps = open()
    const thread = await freshThread()
    const root = await post(deps, alice, thread, '置顶我')
    const reply = await post(deps, bob, thread, '回复不能置顶', { parentId: root.comment.id })
    expect(await setPinned(mod, { id: root.comment.id, pinned: true })).toEqual({ id: root.comment.id, pinned: true })
    await rejects(setPinned(mod, { id: reply.comment.id, pinned: true }), 400)
    const [row] = await auditRows('comment.pin', root.comment.id)
    expect(row).toMatchObject({ actorId: mod.id, actorRole: 'manager', diff: { pinned: [false, true] } })
    await setPinned(mod, { id: root.comment.id, pinned: false })
    expect((await auditRows('comment.unpin', root.comment.id)).length).toBe(1)
  })
})

describe('stickers', () => {
  test('published, derived stickers in a published pack are accepted and stored once each', async () => {
    const deps = open()
    const [a, b] = f.stickers
    const res = await post(deps, alice, await freshThread(), `:s[${a}] 和 :s[${b}] 再来 :s[${a}]`)
    const row = await commentRow(res.comment.id)
    expect(row.stickerIds).toEqual([a!, b!])
    expect(res.comment.html).toContain(`src="/img/v1/p240/${f.pack.key}/${a}.r1.webp" width="240" height="160" alt=""`)
  })

  test('pending, hidden, not-derived, hidden-pack and unknown ids are rejected; so are bad formats', async () => {
    const deps = open()
    const thread = await freshThread()
    for (const id of [f.pendingEmoji, f.hiddenEmoji, f.notReadyEmoji, f.inHiddenPack, 'r-ffffffffffffffffffff']) {
      await rejects(post(deps, alice, thread, `贴纸 :s[${id}]`), 400, '贴纸不存在或尚未发布')
    }
    for (const bad of [':s[r-123]', ':s[R-0A7BF47F0EC26D3843BF]', ':s[../../etc]']) {
      await rejects(post(deps, alice, thread, `坏标记 ${bad}`), 400, '格式')
    }
  })

  test(`at most ${MAX_STICKERS} per comment (repeats count)`, async () => {
    const deps = open()
    const thread = await freshThread()
    const six = f.stickers.slice(0, 6).map((id) => `:s[${id}]`).join(' ')
    expect((await post(deps, alice, thread, six)).status).toBe('published')
    await rejects(post(deps, alice, thread, `${six} :s[${f.stickers[6]}]`), 400, `${MAX_STICKERS}`)
    const repeat = Array.from({ length: 7 }, () => `:s[${f.stickers[0]}]`).join('')
    await rejects(post(deps, alice, thread, repeat), 400)
  })

  test('stickers switched off: rejected, plain text still fine', async () => {
    const deps = testDeps({ settings: { firstCommentReview: false, stickersAllowed: false } })
    const thread = await freshThread()
    await rejects(post(deps, alice, thread, `:s[${f.stickers[0]}]`), 400, '关闭')
    expect((await post(deps, alice, thread, '纯文字')).status).toBe('published')
  })

  test('a sticker hidden after posting disappears from the rendered comment', async () => {
    const { db, schema } = await import('#/server/db/client')
    const { eq } = await import('drizzle-orm')
    const deps = open()
    const thread = await freshThread()
    const id = f.stickers[7]!
    await post(deps, alice, thread, `会消失 :s[${id}]`)
    expect((await listThread(ctxOf(null), thread, deps)).items[0]!.html).toContain(id)
    await db().update(schema.emojis).set({ status: 'hidden' }).where(eq(schema.emojis.id, id))
    expect((await listThread(ctxOf(null), thread, deps)).items[0]!.html).not.toContain(id)
    await db().update(schema.emojis).set({ status: 'published' }).where(eq(schema.emojis.id, id))
  })

  test('picker sources use the same filter', async () => {
    const byId = await stickerSource({ kind: 'pack', packId: f.pack.id })
    expect(byId.map((s) => s.id)).toEqual(f.stickers)
    expect((await stickerSource({ kind: 'pack', slug: f.pack.slug })).length).toBe(8)
    expect(await stickerSource({ kind: 'pack', packId: f.hiddenPack.id })).toEqual([])
    const recent = await stickerSource({ kind: 'ids', ids: [f.stickers[2]!, f.hiddenEmoji, f.stickers[1]!] })
    expect(recent.map((s) => s.id)).toEqual([f.stickers[2]!, f.stickers[1]!])
  })
})

describe('我的评论', () => {
  test('lists the viewer’s comments with status and thread link', async () => {
    const deps = testDeps()
    const me = await makeUser('me-page')
    const thread = await freshThread()
    const first = await post(deps, me, thread, '首评待审')
    const d2 = open()
    const second = await post(d2, me, thread, '第二条')
    await deleteOwnComment(ctxOf(me), { id: second.comment.id }, d2)
    const page = await myComments(me, {})
    expect(page.items.map((i) => [i.id, i.status, i.deleted])).toEqual([
      [second.comment.id, 'published', true],
      [first.comment.id, 'pending', false],
    ])
    expect(page.items[1]!.html).toContain('首评待审')
    expect(page.items[0]!.html).toBeNull()
    expect(page.items[0]!.thread.href).toMatch(/^\/packs\/cm-thread-/)
    expect(page.counts).toEqual({ published: 0, pending: 1, spam: 0, deleted: 1 })
  })
})
