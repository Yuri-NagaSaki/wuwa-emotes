import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../env'
import { FORM_TOKEN_MAX_AGE_MS, MIN_FILL_MS } from './constants'

// Minimum fill time: the composer gets a signed timestamp when it loads (never in cached HTML: the
// thread is fetched by the browser) and sends it back with the comment. Too young = a bot that posts
// the instant the form exists; too old = a stale form, fetch a new one. Not secret, not single-use:
// it only proves when the form was handed out.

function sign(issuedAt: number): string {
  return createHmac('sha256', env().AUTH_SECRET).update(`comment-form:${issuedAt}`).digest('base64url').slice(0, 32)
}

export function issueFormToken(now = Date.now()): string {
  return `${now}.${sign(now)}`
}

export type FormTokenCheck = { ok: true; issuedAt: number } | { ok: false; reason: 'invalid' | 'too_fast' | 'expired' }

export function checkFormToken(token: string | null | undefined, now = Date.now()): FormTokenCheck {
  const m = /^([0-9]{13})\.([A-Za-z0-9_-]{32})$/.exec(token ?? '')
  if (!m) return { ok: false, reason: 'invalid' }
  const issuedAt = Number(m[1])
  const want = Buffer.from(sign(issuedAt))
  const got = Buffer.from(m[2]!)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: 'invalid' }
  const age = now - issuedAt
  if (age < MIN_FILL_MS) return { ok: false, reason: 'too_fast' }
  if (age > FORM_TOKEN_MAX_AGE_MS) return { ok: false, reason: 'expired' }
  return { ok: true, issuedAt }
}
