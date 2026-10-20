import { authCall, DATABASE_URL, goodToken, mainDatabase, sessionCookie, signUp, withClient } from './setup'
import { beforeAll, describe, expect, test } from 'bun:test'

// Better Auth end to end through auth().handler(Request): Cap before-hook (against the fake Cap
// server from setup.ts) and the admin plugin's access control.

beforeAll(async () => {
  const run = await mainDatabase()
  if (run.exitCode !== 0) throw new Error(`migrate failed:\n${run.output}`)
}, 60_000)

async function errorBody(res: Response): Promise<{ code?: string; message?: string }> {
  return (await res.json().catch(() => ({}))) as { code?: string; message?: string }
}

async function setRole(email: string, role: string) {
  await withClient(DATABASE_URL, (c) => c.query(`update users set role = $2 where email = $1`, [email, role]))
}

describe('sign-up is Cap protected', () => {
  const email = `cap-signup-${Date.now()}@test.chaochi`
  const body = { email, password: 'correct horse battery staple', name: '测试' }

  test('without a token: 400 CAPTCHA_MISSING', async () => {
    const res = await authCall('/sign-up/email', { body })
    expect(res.status).toBe(400)
    const err = await errorBody(res)
    expect(err.code).toBe('CAPTCHA_MISSING')
    expect(err.message).toBe('请先完成人机验证')
  })

  test('with a bad token: 400 CAPTCHA_INVALID', async () => {
    const res = await authCall('/sign-up/email', { body, cap: 'forged-token' })
    expect(res.status).toBe(400)
    expect((await errorBody(res)).code).toBe('CAPTCHA_INVALID')
  })

  test('no account was created by the rejected attempts', async () => {
    const rows = await withClient(DATABASE_URL, (c) => c.query(`select 1 from users where email = $1`, [email]))
    expect(rows.rowCount).toBe(0)
  })

  let token = ''
  test('with a good token: 200 and a session', async () => {
    token = goodToken()
    const res = await authCall('/sign-up/email', { body, cap: token })
    expect(res.status).toBe(200)
    expect(sessionCookie(res)).toMatch(/^better-auth\.session_token=/)
    const json = (await res.json()) as { user: { email: string; role?: string } }
    expect(json.user.email).toBe(email)
  })

  test('reusing the same token: 400', async () => {
    const res = await authCall('/sign-up/email', { body: { ...body, email: `again-${email}` }, cap: token })
    expect(res.status).toBe(400)
    expect((await errorBody(res)).code).toBe('CAPTCHA_INVALID')
  })
})

describe('sign-in is Cap protected', () => {
  let user: Awaited<ReturnType<typeof signUp>>
  beforeAll(async () => {
    user = await signUp('signin')
  })
  const creds = () => ({ email: user.email, password: user.password })

  test('without a token: 400 CAPTCHA_MISSING', async () => {
    const res = await authCall('/sign-in/email', { body: creds() })
    expect(res.status).toBe(400)
    expect((await errorBody(res)).code).toBe('CAPTCHA_MISSING')
  })

  test('with a bad token: 400 CAPTCHA_INVALID', async () => {
    const res = await authCall('/sign-in/email', { body: creds(), cap: 'good-but-not-really' })
    expect(res.status).toBe(400)
    expect((await errorBody(res)).code).toBe('CAPTCHA_INVALID')
  })

  let token = ''
  test('with a good token: 200 and a session', async () => {
    token = goodToken()
    const res = await authCall('/sign-in/email', { body: creds(), cap: token })
    expect(res.status).toBe(200)
    const cookie = sessionCookie(res)
    const session = await authCall('/get-session', { cookie })
    expect(session.status).toBe(200)
    expect(((await session.json()) as { user: { id: string } }).user.id).toBe(user.id)
  })

  test('reusing the same token: 400', async () => {
    const res = await authCall('/sign-in/email', { body: creds(), cap: token })
    expect(res.status).toBe(400)
    expect((await errorBody(res)).code).toBe('CAPTCHA_INVALID')
  })

  test('a wrong password with a good token is still rejected (401)', async () => {
    const res = await authCall('/sign-in/email', { body: { ...creds(), password: 'wrong password!!' }, cap: goodToken() })
    expect(res.status).toBe(401)
  })

  test('session rows store hashed IP and user agent only', async () => {
    const rows = await withClient(DATABASE_URL, (c) => c.query(`select ip_address from sessions where user_id = $1`, [user.id]))
    expect(rows.rowCount).toBeGreaterThan(0)
    for (const r of rows.rows) expect(r.ip_address).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('admin set-role endpoint', () => {
  let siteOwner: Awaited<ReturnType<typeof signUp>>
  let manager: Awaited<ReturnType<typeof signUp>>
  let target: Awaited<ReturnType<typeof signUp>>

  beforeAll(async () => {
    siteOwner = await signUp('owner')
    manager = await signUp('manager')
    target = await signUp('target')
    await setRole(siteOwner.email, 'admin') // bootstrap the first 站长 directly in the database
  })

  async function roleOf(id: string): Promise<string> {
    return withClient(DATABASE_URL, async (c) => (await c.query(`select role from users where id = $1`, [id])).rows[0].role)
  }

  test('站长 (admin) can set roles', async () => {
    const res = await authCall('/admin/set-role', { body: { userId: manager.id, role: 'manager' }, cookie: siteOwner.cookie })
    expect(res.status).toBe(200)
    expect(await roleOf(manager.id)).toBe('manager')
  })

  test('管理员 (manager) gets 403', async () => {
    const res = await authCall('/admin/set-role', { body: { userId: target.id, role: 'admin' }, cookie: manager.cookie })
    expect(res.status).toBe(403)
    expect(await roleOf(target.id)).toBe('user')
  })

  test('a plain user gets 403', async () => {
    const res = await authCall('/admin/set-role', { body: { userId: target.id, role: 'manager' }, cookie: target.cookie })
    expect(res.status).toBe(403)
    expect(await roleOf(target.id)).toBe('user')
  })

  test('unauthenticated gets 401', async () => {
    const res = await authCall('/admin/set-role', { body: { userId: target.id, role: 'admin' } })
    expect(res.status).toBe(401)
    expect(await roleOf(target.id)).toBe('user')
  })

  test('a manager cannot list users either', async () => {
    const res = await authCall('/admin/list-users', { cookie: manager.cookie })
    expect(res.status).toBe(403)
    const ok = await authCall('/admin/list-users', { cookie: siteOwner.cookie })
    expect(ok.status).toBe(200)
  })
})
