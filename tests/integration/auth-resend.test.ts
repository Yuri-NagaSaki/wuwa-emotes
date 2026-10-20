import { authCall, mainDatabase, SITE_URL, signUp } from './setup'
import { beforeAll, describe, expect, test } from 'bun:test'

// Resending the verification mail needs no Cap token (the account pages call it without one); a
// strict per-IP rate limit stands in for Cap there. The other mail endpoint, the password reset,
// stays Cap protected.

beforeAll(async () => {
  const run = await mainDatabase()
  if (run.exitCode !== 0) throw new Error(`migrate failed:\n${run.output}`)
}, 60_000)

/** POST /send-verification-email from a fixed client IP (authCall picks a fresh one every time). */
async function resend(email: string, ip: string): Promise<Response> {
  const { auth } = await import('#/server/auth/auth')
  return auth().handler(
    new Request(`${SITE_URL}/api/auth/send-verification-email`, {
      method: 'POST',
      headers: { origin: SITE_URL, 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify({ email, callbackURL: '/verify-email' }),
    }),
  )
}

describe('resending the verification mail', () => {
  let email = ''
  beforeAll(async () => {
    // tests run without SMTP, so new accounts stay unverified and the mail goes to the log
    email = (await signUp('resend')).email
  })

  test('works without a Cap token', async () => {
    const res = await authCall('/send-verification-email', { body: { email, callbackURL: '/verify-email' } })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { status?: boolean }).status).toBe(true)
  })

  test('the password-reset mail still needs one', async () => {
    const res = await authCall('/request-password-reset', { body: { email, redirectTo: '/reset-password' } })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code?: string }).code).toBe('CAPTCHA_MISSING')
  })

  test('is limited to 3 per 10 minutes per IP', async () => {
    // outside the 10.0.x.x range that setup.ts nextIp() hands out
    const ip = '10.250.0.1'
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) statuses.push((await resend(email, ip)).status)
    expect(statuses).toEqual([200, 200, 200, 429])
    const blocked = await resend(email, ip)
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('x-retry-after'))).toBeGreaterThan(60)
    // another address is not affected
    expect((await resend(email, '10.250.0.2')).status).toBe(200)
  }, 20_000)
})
