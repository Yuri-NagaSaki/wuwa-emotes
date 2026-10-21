import { auditRows, DATABASE_URL, inRequest, runServerFn, setupAdminTests, userWithRole, withClient, type RoleUser } from './harness'
import { authCall } from '../integration/setup'
import { beforeAll, describe, expect, test } from 'bun:test'
import { and, eq, ne } from 'drizzle-orm'
import { saveTag } from '#/server/admin/taxonomy'
import { setAvatar } from '#/server/account/avatar'
import { banUser, clearUserAvatar, impersonateUser, listUsers, revokeSessions, setSubmitMode, setUserRole, unbanUser } from '#/server/admin/users'
import { getViewer } from '#/server/auth/session'
import { db, schema } from '#/server/db/client'
import { avatarKey } from '#/server/media/keys'
import { headObject } from '#/server/media/s3'
import { makePng } from '../media/helpers'

// 用户与权限: Better Auth admin endpoints called with the caller's headers, the last-admin trigger,
// 投稿模式, bans, sessions and impersonation, each with its audit row.

let owner: RoleUser
let manager: RoleUser
let member: RoleUser

beforeAll(async () => {
  await setupAdminTests()
  owner = await userWithRole('admin', 'users-owner')
  manager = await userWithRole('manager', 'users-manager')
  member = await userWithRole('user', 'users-member')
}, 60_000)

/** The new session cookie of an impersonation response (it first clears the old one). */
function lastSessionCookie(res: Response): string {
  const pairs = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .filter((p) => /^better-auth\.session_token=./.test(p))
  return pairs.at(-1)!
}

async function userRow(id: string) {
  const [u] = await db().select().from(schema.users).where(eq(schema.users.id, id))
  return u!
}

describe('roles', () => {
  test('站长 sets a role through Better Auth; the change is audited', async () => {
    const target = await userWithRole('user', 'role-target')
    await inRequest(owner.cookie, (h) => setUserRole(owner.actor, h, { userId: target.id, role: 'manager' }))
    expect((await userRow(target.id)).role).toBe('manager')
    const [a] = await auditRows('user.role', target.id)
    expect(a!.diff).toMatchObject({ role: ['user', 'manager'] })
    expect(a!.actorRole).toBe('admin')
  })

  test('管理员 cannot set roles: requirePerm 403, the implementation 403, and Better Auth 403 on its own', async () => {
    const { adminSetRoleFn } = await import('#/server/admin/fns/system')
    const viaFn = await runServerFn(adminSetRoleFn, { userId: member.id, role: 'admin' }, manager.cookie)
    expect(viaFn.status).toBe(403)
    const viaImpl = await inRequest(manager.cookie, (h) => setUserRole(manager.actor, h, { userId: member.id, role: 'admin' })).catch((e) => e)
    expect(viaImpl.status).toBe(403)
    // even with a forged 站长 actor, the manager's own session is what Better Auth checks
    const forged = { ...manager.actor, role: 'admin' as const }
    const viaAuth = await inRequest(manager.cookie, (h) => setUserRole(forged, h, { userId: member.id, role: 'admin' })).catch((e) => e)
    expect(viaAuth.status).toBe(403)
    expect((await userRow(member.id)).role).toBe('user')
  })

  test('the last active 站长 cannot be demoted; the trigger error comes back as a readable 409', async () => {
    // make `owner` the only active 站长 (other files created admins too)
    await db().update(schema.users).set({ role: 'user' }).where(and(eq(schema.users.role, 'admin'), ne(schema.users.id, owner.id)))
    const err = await inRequest(owner.cookie, (h) => setUserRole(owner.actor, h, { userId: owner.id, role: 'manager' })).catch((e) => e)
    expect(err.status).toBe(409)
    expect(err.message).toContain('至少要保留一位站长')
    expect((await userRow(owner.id)).role).toBe('admin')
    expect(await auditRows('user.role', owner.id)).toHaveLength(0)
  })
})

describe('投稿模式, bans, sessions', () => {
  test('submit mode is 站长-only and audited', async () => {
    const t = await userWithRole('user', 'mode-target')
    const denied = await setSubmitMode(manager.actor, { userId: t.id, mode: 'trusted' }).catch((e) => e)
    expect(denied.status).toBe(403)
    await setSubmitMode(owner.actor, { userId: t.id, mode: 'trusted' })
    expect((await userRow(t.id)).submitMode).toBe('trusted')
    expect((await auditRows('user.submit_mode', t.id))[0]!.diff).toMatchObject({ submitMode: ['review', 'trusted'] })
  })

  test('ban and unban; banning yourself is refused', async () => {
    const t = await userWithRole('user', 'ban-target')
    await inRequest(owner.cookie, (h) => banUser(owner.actor, h, { userId: t.id, reason: '批量抓取', days: 7 }))
    const banned = await userRow(t.id)
    expect(banned.banned).toBe(true)
    expect(banned.banReason).toBe('批量抓取')
    expect(await getViewer(new Headers({ cookie: t.cookie }))).toBeNull()
    await inRequest(owner.cookie, (h) => unbanUser(owner.actor, h, { userId: t.id }))
    expect((await userRow(t.id)).banned).toBe(false)
    expect(await auditRows('user.ban', t.id)).toHaveLength(1)
    expect(await auditRows('user.unban', t.id)).toHaveLength(1)
    const self = await inRequest(owner.cookie, (h) => banUser(owner.actor, h, { userId: owner.id })).catch((e) => e)
    expect(self.status).toBe(400)
  })

  test('revoke sessions signs the user out everywhere', async () => {
    const t = await userWithRole('user', 'revoke-target')
    expect(await getViewer(new Headers({ cookie: t.cookie }))).not.toBeNull()
    await inRequest(owner.cookie, (h) => revokeSessions(owner.actor, h, { userId: t.id }))
    expect(await getViewer(new Headers({ cookie: t.cookie }))).toBeNull()
    expect(await auditRows('user.revoke_sessions', t.id)).toHaveLength(1)
  })

  test('list: search and role filter', async () => {
    const res = await listUsers({ q: 'users-member' })
    expect(res.rows.map((r) => r.id)).toContain(member.id)
    expect(res.rows.every((r) => r.role === 'user' || r.name.includes('users-member'))).toBe(true)
    const managers = await listUsers({ role: 'manager' })
    expect(managers.rows.every((r) => r.role === 'manager')).toBe(true)
  })
})

describe('impersonation', () => {
  test('模拟登录 creates an impersonation session and is audited', async () => {
    const t = await userWithRole('manager', 'imp-target')
    const res = await inRequest(owner.cookie, (h) => impersonateUser(owner.actor, h, { userId: t.id }))
    expect(res.ok).toBe(true)
    const sessions = await db().select().from(schema.sessions).where(and(eq(schema.sessions.userId, t.id), eq(schema.sessions.impersonatedBy, owner.id)))
    expect(sessions.length).toBe(1)
    expect(await auditRows('user.impersonate', t.id)).toHaveLength(1)
  })

  test('writes made while impersonating record impersonated_by', async () => {
    const t = await userWithRole('manager', 'imp-writer')
    const res = await authCall('/admin/impersonate-user', { body: { userId: t.id }, cookie: owner.cookie })
    expect(res.status).toBe(200)
    const viewer = await getViewer(new Headers({ cookie: lastSessionCookie(res) }))
    expect(viewer?.id).toBe(t.id)
    expect(viewer?.impersonatedBy).toBe(owner.id)
    const tag = await saveTag(viewer!, { dimension: 'custom', name: '模拟登录时创建', slug: `imp-${Date.now()}` })
    const [a] = await auditRows('tag.create', tag.id)
    expect(a!.actorId).toBe(t.id)
    expect(a!.impersonatedBy).toBe(owner.id)
  })
})

describe('清除头像', () => {
  test('站长 clears a user\'s avatar: files deleted, URLs purged, audited; 管理员 cannot', async () => {
    const t = await userWithRole('user', 'avatar-target')
    await setAvatar(t.actor, await makePng(80, 80, 7))
    const hash = (await userRow(t.id)).image!
    const listed = (await listUsers({ q: t.id })).rows[0]!
    expect(listed.avatarUrl).toBe(`/img/v1/avatar/${t.id}/${hash}-256.webp`)

    const denied = await clearUserAvatar(manager.actor, { userId: t.id }).catch((e) => e)
    expect(denied.status).toBe(403)
    expect((await userRow(t.id)).image).toBe(hash)

    const purged: string[][] = []
    const res = await clearUserAvatar(owner.actor, { userId: t.id }, { purge: async (urls) => (purged.push(urls), { purged: urls.length, skipped: false }) })
    expect(res).toEqual({ cleared: true })
    expect((await userRow(t.id)).image).toBeNull()
    expect(await headObject(avatarKey(t.id, hash, 256))).toBeNull()
    expect(await headObject(avatarKey(t.id, hash, 64))).toBeNull()
    expect(purged).toEqual([[`/img/v1/avatar/${t.id}/${hash}-256.webp`, `/img/v1/avatar/${t.id}/${hash}-64.webp`]])
    const [a] = await auditRows('user.avatar_clear', t.id)
    expect(a!.actorId).toBe(owner.id)
    expect(a!.diff).toMatchObject({ from: hash, purge: { urls: 2, purged: 2, error: null } })
    expect((await listUsers({ q: t.id })).rows[0]!.avatarUrl).toBeNull()
    // nothing left to clear
    expect(await clearUserAvatar(owner.actor, { userId: t.id })).toEqual({ cleared: false })
  })
})

test('DATABASE_URL is the lane test database', async () => {
  expect(DATABASE_URL).toMatch(/chaochi_(lane_[a-z0-9]+|test)/)
  await withClient(DATABASE_URL, (c) => c.query('select 1'))
})
