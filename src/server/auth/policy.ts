// Account rules shared by the server (auth.ts) and the account pages: which Better Auth endpoints need
// a Cap token, the per-IP rate limits, and how long mailed links stay valid. No imports, so unit tests
// and the browser bundle can use it without pulling in Better Auth, the database or the env schema.

/**
 * Endpoints that create accounts, check passwords or send a password-reset mail: each needs a fresh
 * Cap token. Not /send-verification-email: Better Auth only mails accounts that exist and are not
 * verified yet, and AUTH_RATE_RULES keeps that endpoint to a few requests per IP.
 */
export const CAP_PROTECTED_PATHS: ReadonlySet<string> = new Set(['/sign-up/email', '/sign-in/email', '/request-password-reset'])

export interface RateRule {
  /** seconds */
  window: number
  /** requests per IP per window */
  max: number
}

/** Better Auth `rateLimit.customRules` (per IP; replaces its built-in rules for these paths). */
export const AUTH_RATE_RULES: Readonly<Record<string, RateRule>> = {
  '/sign-in/email': { window: 60, max: 10 },
  '/sign-up/email': { window: 3600, max: 10 },
  '/request-password-reset': { window: 3600, max: 5 },
  '/send-verification-email': { window: 600, max: 3 },
}

/** Lifetime of the link in the verification mail, in seconds. */
export const VERIFY_EMAIL_EXPIRES_IN = 60 * 60
/** Lifetime of the link in the password-reset mail, in seconds. */
export const RESET_PASSWORD_EXPIRES_IN = 60 * 60

/** "1 小时", "30 分钟", "1 天" for the copy around those links. */
export function durationText(seconds: number): string {
  if (seconds >= 86_400 && seconds % 86_400 === 0) return `${seconds / 86_400} 天`
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600} 小时`
  return `${Math.max(1, Math.round(seconds / 60))} 分钟`
}

/** At most one 「这个邮箱已经注册过」 notice per address per window (kept per web process). */
export const EXISTING_NOTICE_WINDOW_MS = 10 * 60_000
const existingNoticeAt = new Map<string, number>()

/**
 * Whether the notice to an address that signed up again may go out now; records the send. Sign-up
 * already needs a Cap token and is limited per IP (AUTH_RATE_RULES); this keeps one inbox from being
 * flooded through it.
 */
export function mayNoticeExisting(email: string, now = Date.now()): boolean {
  const key = email.trim().toLowerCase()
  const last = existingNoticeAt.get(key)
  if (last !== undefined && now - last < EXISTING_NOTICE_WINDOW_MS) return false
  existingNoticeAt.set(key, now)
  if (existingNoticeAt.size > 5000) {
    for (const [k, t] of existingNoticeAt) if (now - t >= EXISTING_NOTICE_WINDOW_MS) existingNoticeAt.delete(k)
  }
  return true
}
