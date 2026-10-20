import { auditRows, runServerFn, setupAdminTests, SITE_URL, userWithRole, type RoleUser } from './harness'
import { authCall } from '../integration/setup'
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createServerEntry, getResponseHeaders } from '@tanstack/react-start/server'
import { stopImpersonatingFn } from '#/server/account/fn'
import { stopImpersonating } from '#/server/admin/users'
import { getViewer, type Viewer } from '#/server/auth/session'
import { db, schema } from '#/server/db/client'

// 结束模拟: the impersonated session ends itself through Better Auth's stop-impersonating, which puts
// the 站长's own session cookie back; the stop is audited as the 站长.

let owner: RoleUser

beforeAll(async () => {
  await setupAdminTests()
  owner = await userWithRole('admin', 'imp-stop-owner')
}, 60_000)

/** `name=value` pairs a response sets (the last one per name wins, as in a browser). */
function setCookies(res: Response): Map<string, string> {
  const out = new Map<string, string>()
  for (const c of res.headers.getSetCookie()) {
    const pair = c.split(';')[0]!
    const i = pair.indexOf('=')
    out.set(pair.slice(0, i), pair.slice(i + 1))
  }
  return out
}

const header = (jar: Map<string, string>) => [...jar].filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ')

/** 站长 starts 模拟登录 of a fresh user; returns the browser's cookie jar afterwards. */
async function impersonate(target: RoleUser) {
  const res = await authCall('/admin/impersonate-user', { body: { userId: target.id }, cookie: owner.cookie })
  expect(res.status).toBe(200)
  const jar = setCookies(res)
  expect(jar.get('better-auth.admin_session')).toBeTruthy()
  return jar
}

/**
 * Run `fn` in a Start request scope with this Cookie header (Better Auth's tanstackStartCookies writes
 * Set-Cookie into the scope's response headers); returns its value and those headers.
 */
async function inRequestWithCookies<T>(cookie: string, fn: (headers: Headers) => Promise<T>): Promise<{ value: T; res: Response }> {
  const headers = new Headers({ origin: SITE_URL, cookie })
  const request = new Request(`${SITE_URL}/_serverFn/test`, { method: 'POST', headers })
  let value: T | undefined
  let failure: unknown
  let res = new Response(null)
  await createServerEntry({
    fetch: async () => {
      try {
        value = await fn(headers)
        res = new Response(null, { headers: new Headers(getResponseHeaders() as HeadersInit) })
      } catch (err) {
        failure = err
      }
      return new Response(null, { status: 204 })
    },
  }).fetch(request)
  if (failure) throw failure
  return { value: value as T, res }
}

describe('结束模拟', () => {
  test('restores the 站长’s own session, deletes the impersonation session, and is audited', async () => {
    const target = await userWithRole('user', 'imp-stop-target')
    const jar = await impersonate(target)
    const impCookie = header(jar)
    const asTarget = (await getViewer(new Headers({ cookie: impCookie }))) as Viewer
    expect(asTarget.id).toBe(target.id)
    expect(asTarget.impersonatedBy).toBe(owner.id)
    const [impSession] = await db().select().from(schema.sessions).where(eq(schema.sessions.impersonatedBy, owner.id))
    expect(impSession?.userId).toBe(target.id)

    const { value, res } = await inRequestWithCookies(impCookie, (h) => stopImpersonating(asTarget, h))
    expect(value).toEqual({ ok: true })
    const back = setCookies(res)
    // the 站长's original session token comes back; the admin_session cookie is cleared
    expect(back.get('better-auth.session_token')).toBe(owner.cookie.split('=')[1])
    expect(back.get('better-auth.admin_session')).toBe('')
    for (const [k, v] of back) jar.set(k, v)

    const restored = await getViewer(new Headers({ cookie: header(jar) }))
    expect(restored).toMatchObject({ id: owner.id, role: 'admin', impersonatedBy: null })
    expect(await getViewer(new Headers({ cookie: impCookie }))).toBeNull()
    expect(await db().select().from(schema.sessions).where(eq(schema.sessions.id, impSession!.id))).toEqual([])

    const [a] = await auditRows('user.impersonate_stop', target.id)
    expect(a).toMatchObject({ actorId: owner.id, actorRole: 'admin', impersonatedBy: null, targetType: 'user', diff: { name: 'imp-stop-target' } })
  })

  test('only an impersonated session can stop; anonymous callers get 401', async () => {
    await expect(stopImpersonating(owner.actor, new Headers({ cookie: owner.cookie }))).rejects.toMatchObject({ status: 400, message: '当前没有在模拟登录' })
    expect((await runServerFn(stopImpersonatingFn, undefined)).status).toBe(401)
    // a plain 用户 being impersonated passes the guard (requireUser, not a 站长 permission)
    const target = await userWithRole('user', 'imp-stop-guard')
    const jar = await impersonate(target)
    expect((await runServerFn(stopImpersonatingFn, undefined, header(jar))).status).toBeNull()
  })
})
