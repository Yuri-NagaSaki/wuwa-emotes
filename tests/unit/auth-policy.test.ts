import { describe, expect, test } from 'bun:test'
import { AUTH_RATE_RULES, CAP_PROTECTED_PATHS, durationText, RESET_PASSWORD_EXPIRES_IN, VERIFY_EMAIL_EXPIRES_IN } from '#/server/auth/policy'

// src/server/auth/policy.ts: which Better Auth endpoints need a Cap token, and the per-IP limits that
// stand in for Cap on the verification mail. The HTTP behaviour is covered in
// tests/integration/auth-resend.test.ts.

describe('Cap-protected auth endpoints', () => {
  test('sign-up, sign-in and the password-reset mail need a token', () => {
    expect([...CAP_PROTECTED_PATHS].sort()).toEqual(['/request-password-reset', '/sign-in/email', '/sign-up/email'])
  })

  test('resending the verification mail does not', () => {
    expect(CAP_PROTECTED_PATHS.has('/send-verification-email')).toBe(false)
  })
})

describe('auth rate limits', () => {
  test('the verification mail is limited to a few per 10 minutes per IP', () => {
    const rule = AUTH_RATE_RULES['/send-verification-email']!
    expect(rule.window).toBeGreaterThanOrEqual(600)
    expect(rule.max).toBeLessThanOrEqual(3)
  })

  test('every Cap-protected endpoint has its own rule too', () => {
    for (const path of CAP_PROTECTED_PATHS) expect(AUTH_RATE_RULES[path]).toBeDefined()
  })
})

describe('link lifetimes', () => {
  test('copy follows the configured seconds', () => {
    expect(durationText(3600)).toBe('1 小时')
    expect(durationText(1800)).toBe('30 分钟')
    expect(durationText(86_400)).toBe('1 天')
    expect(durationText(5400)).toBe('90 分钟')
    expect(durationText(VERIFY_EMAIL_EXPIRES_IN)).toBe('1 小时')
    expect(durationText(RESET_PASSWORD_EXPIRES_IN)).toBe('1 小时')
  })
})
