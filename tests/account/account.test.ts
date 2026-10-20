import { deps, makePng, person, rejects, setup, sqlRows, upload, type Person } from '../submissions/helpers'
import { authCall, goodToken, sessionCookie } from '../integration/setup'
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { listNotifications, markRead, notify, unreadCount } from '#/server/account/notifications'
import { deleteAccount, meSummary } from '#/server/account/service'
import { db, schema } from '#/server/db/client'
import {
  createFolder,
  deleteFolder,
  favoriteStatus,
  listFavorites,
  listFolders,
  moveFavorite,
  removeFavorite,
  renameFolder,
  toggleFavorite,
} from '#/server/favorites/service'
import { headObject } from '#/server/media/s3'
import { approveSubmission, createSubmission, submitSubmission } from '#/server/submissions/service'

// 个人中心: favorites and folders, notifications, settings through Better Auth's own endpoints,
// and 注销账号.

let fan: Person
let packId = 0
let emojiId = ''
let draftPackId = 0

const declaration = { identity: 'artist' as const, license: 'cc-by-4.0', note: '本人作品', downloadable: true }

beforeAll(async () => {
  await setup()
  fan = await person('fan')
  // one published pack with one emoji (through the real submission path) and one invisible draft pack
  const author = await person('author')
  const reviewer = await person('reviewer', 'manager')
  const sub = await createSubmission(author.actor, { kind: 'new_pack', payload: { title: '收藏测试包', artistNames: ['某某'] }, declaration })
  const { outcomes } = await upload(author.actor, sub.id, [{ name: 'fav.png', body: await makePng(60, 60, 31), type: 'image/png' }])
  emojiId = (outcomes[0] as { emojiId: string }).emojiId
  await submitSubmission(author.actor, sub.id, deps)
  await approveSubmission(reviewer.actor, sub.id, { downloadable: true }, deps)
  packId = sub.packId
  draftPackId = (await createSubmission(author.actor, { kind: 'new_pack', payload: { title: '草稿包' } })).packId
}, 120_000)

const packRow = async () => (await db().select().from(schema.packs).where(eq(schema.packs.id, packId)))[0]!

describe('favorites', () => {
  test('toggle a pack: counted once per user, packs.updated_at untouched', async () => {
    const before = await packRow()
    expect(await toggleFavorite(fan.id, { type: 'pack', id: String(packId) })).toEqual({ favorited: true })
    const after = await packRow()
    expect(after.favoriteCount).toBe(before.favoriteCount + 1)
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
    expect(await favoriteStatus(fan.id, [{ type: 'pack', id: String(packId) }, { type: 'emoji', id: emojiId }])).toEqual([`pack:${packId}`])
    expect(await toggleFavorite(fan.id, { type: 'pack', id: String(packId) })).toEqual({ favorited: false })
    expect((await packRow()).favoriteCount).toBe(before.favoriteCount)
    expect(await favoriteStatus(null, [{ type: 'pack', id: String(packId) }])).toEqual([])
  })

  test('only published targets', async () => {
    await rejects(toggleFavorite(fan.id, { type: 'pack', id: String(draftPackId) }), 404)
    await rejects(toggleFavorite(fan.id, { type: 'emoji', id: 'r-00000000000000000000' }), 404)
    await rejects(toggleFavorite(fan.id, { type: 'emoji', id: 'not-an-id' }), 400)
  })

  test('folders: default folder, create, move, rename, delete (items move to the default)', async () => {
    await toggleFavorite(fan.id, { type: 'emoji', id: emojiId })
    await toggleFavorite(fan.id, { type: 'pack', id: String(packId) })
    let folders = await listFolders(fan.id)
    expect(folders.map((f) => [f.name, f.isDefault, f.count])).toEqual([['默认收藏夹', true, 2]])
    const def = folders[0]!
    expect(def.previews.length).toBe(2)
    expect(def.previews[0]).toMatch(/^\/img\/v1\/p240\//)

    const { id: chat } = await createFolder(fan.id, '  聊天常用  ')
    await rejects(createFolder(fan.id, '   '), 400)
    const items = (await listFavorites(fan.id, def.id)).items
    expect(items.map((i) => i.type).sort()).toEqual(['emoji', 'pack'])
    const emojiFav = items.find((i) => i.type === 'emoji')!
    expect(emojiFav).toMatchObject({ href: `/e/${emojiId}`, title: '收藏测试包', format: 'png' })
    expect(items.find((i) => i.type === 'pack')).toMatchObject({ emojiCount: 1 })
    await moveFavorite(fan.id, emojiFav.id, chat)
    folders = await listFolders(fan.id)
    expect(folders.map((f) => [f.name, f.count])).toEqual([
      ['默认收藏夹', 1],
      ['聊天常用', 1],
    ])
    await renameFolder(fan.id, chat, '摸鱼专用')
    // another user's folder is invisible
    const stranger = await person('stranger-fav')
    await rejects(listFavorites(stranger.id, chat), 404)
    await rejects(moveFavorite(stranger.id, emojiFav.id, chat), 404)
    await rejects(deleteFolder(fan.id, def.id), 400, '默认收藏夹')
    expect(await deleteFolder(fan.id, chat)).toEqual({ moved: 1 })
    folders = await listFolders(fan.id)
    expect(folders.map((f) => [f.name, f.count])).toEqual([['默认收藏夹', 2]])
    // toggling the emoji off removes it everywhere
    expect(await toggleFavorite(fan.id, { type: 'emoji', id: emojiId })).toEqual({ favorited: false })
  })

  test('remove: the pack counter drops when the last copy goes', async () => {
    const start = (await packRow()).favoriteCount
    const [fav] = (await listFavorites(fan.id, (await listFolders(fan.id))[0]!.id)).items
    await removeFavorite(fan.id, fav!.id)
    expect((await packRow()).favoriteCount).toBe(start - 1)
    await rejects(removeFavorite(fan.id, fav!.id), 404)
  })
})

describe('notifications', () => {
  test('list, unread count, mark one and mark all', async () => {
    const u = await person('notes')
    for (const n of [1, 2, 3]) await notify(u.id, 'submission.returned', { submissionId: `s${n}`, packId, slug: 'x', title: `包${n}`, reason: '缺少画师授权说明' })
    const list = await listNotifications(u.id)
    expect(list.unread).toBe(3)
    expect(list.items.map((i) => i.payload.title)).toEqual(['包3', '包2', '包1'])
    expect(await markRead(u.id, [list.items[0]!.id])).toBe(2)
    // another user's ids are ignored
    expect(await markRead(fan.id, [list.items[1]!.id])).toBe(await unreadCount(fan.id))
    expect(await unreadCount(u.id)).toBe(2)
    expect(await markRead(u.id)).toBe(0)
    expect((await listNotifications(u.id)).items.every((i) => i.read)).toBe(true)
  })
})

describe('settings through Better Auth', () => {
  let u: Person

  beforeAll(async () => {
    u = await person('settings')
  })

  test('display name', async () => {
    const res = await authCall('/update-user', { body: { name: '今州打工人' }, cookie: u.cookie })
    expect(res.status).toBe(200)
    expect((await meSummary(u.actor)).name).toBe('今州打工人')
  })

  test('change password (other sessions revoked), then sign in with the new one', async () => {
    const second = sessionCookie(await authCall('/sign-in/email', { body: { email: u.email, password: u.password }, cap: goodToken() }))
    const res = await authCall('/change-password', {
      body: { currentPassword: u.password, newPassword: 'a brand new passphrase', revokeOtherSessions: true },
      cookie: u.cookie,
    })
    expect(res.status).toBe(200)
    u.cookie = sessionCookie(res) // the current session is renewed
    expect((await authCall('/get-session', { cookie: second })).status).toBe(200)
    expect(await (await authCall('/get-session', { cookie: second })).json()).toBeNull()
    const old = await authCall('/sign-in/email', { body: { email: u.email, password: u.password }, cap: goodToken() })
    expect(old.status).toBe(401)
    expect(((await old.json()) as { code: string }).code).toBe('INVALID_EMAIL_OR_PASSWORD')
    u.password = 'a brand new passphrase'
    const ok = await authCall('/sign-in/email', { body: { email: u.email, password: u.password }, cap: goodToken() })
    expect(ok.status).toBe(200)
  })

  test('list and revoke sessions', async () => {
    const other = sessionCookie(await authCall('/sign-in/email', { body: { email: u.email, password: u.password }, cap: goodToken() }))
    const list = (await (await authCall('/list-sessions', { cookie: u.cookie })).json()) as { token: string; createdAt: string }[]
    expect(list.length).toBeGreaterThanOrEqual(2)
    const otherToken = decodeURIComponent(other.split('=')[1]!).split('.')[0]!
    const res = await authCall('/revoke-session', { body: { token: otherToken }, cookie: u.cookie })
    expect(res.status).toBe(200)
    expect(await (await authCall('/get-session', { cookie: other })).json()).toBeNull()
    expect(await (await authCall('/get-session', { cookie: u.cookie })).json()).not.toBeNull()
  })

  test('summary counts', async () => {
    await createSubmission(u.actor, { kind: 'new_pack', payload: { title: '我的草稿' } })
    const s = await meSummary(u.actor)
    expect(s.submissions).toEqual({ approved: 0, pending: 0, returned: 0, draft: 1 })
    expect(s.email).toBe(u.email)
  })
})

describe('注销账号', () => {
  test('needs the password; purges unapproved submissions and their files', async () => {
    const u = await person('leaver')
    const sub = await createSubmission(u.actor, { kind: 'new_pack', payload: { title: '要删掉的' } })
    const { outcomes } = await upload(u.actor, sub.id, [{ name: 'bye.png', body: await makePng(30, 30, 77), type: 'image/png' }])
    const id = (outcomes[0] as { emojiId: string }).emojiId
    const [e] = await db().select().from(schema.emojis).where(eq(schema.emojis.id, id))
    await rejects(deleteAccount(u.actor, 'wrong password'), 400, '密码不正确')
    await rejects(deleteAccount({ ...u.actor, impersonatedBy: 'someone' }, u.password), 403)
    await deleteAccount(u.actor, u.password)
    expect(await sqlRows(`select 1 from users where id = $1`, [u.id])).toEqual([])
    expect(await sqlRows(`select 1 from packs where id = $1`, [sub.packId])).toEqual([])
    expect(await headObject(e!.originalKey)).toBeNull()
    expect(await (await authCall('/get-session', { cookie: u.cookie })).json()).toBeNull()
    const rows = await sqlRows<{ action: string }>(`select action from audit_logs where target_id = $1`, [u.id])
    expect(rows.map((r) => r.action)).toContain('account.delete')
  })

  test('favorite counters of the packs follow the deleted favorites', async () => {
    const u = await person('fav-leaver')
    await toggleFavorite(u.id, { type: 'pack', id: String(packId) })
    const before = (await packRow()).favoriteCount
    await deleteAccount(u.actor, u.password)
    expect((await packRow()).favoriteCount).toBe(before - 1)
  })

  test('the last 站长 cannot leave', async () => {
    // nobody else in this database is 站长
    const boss = await person('boss', 'admin')
    await rejects(deleteAccount(boss.actor, boss.password), 400, '最后一位站长')
    expect(await sqlRows(`select 1 from users where id = $1`, [boss.id])).toEqual([{ '?column?': 1 }])
  })
})
