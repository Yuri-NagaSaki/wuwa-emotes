import { createAuthClient } from 'better-auth/react'
import { CAP_TOKEN_HEADER } from '../cap/load'

// Better Auth in the browser (/api/auth/*). Created on first use, so server rendering never builds it.
// Cap-protected calls (sign-in, sign-up, the password-reset mail: CAP_PROTECTED_PATHS in
// src/server/auth/policy.ts) send the single-use token in the x-cap-token header:
// `authClient().signIn.email(body, withCap(token))`. Resending the verification mail sends none.

type Client = ReturnType<typeof createAuthClient>
let client: Client | undefined

export function authClient(): Client {
  client ??= createAuthClient({ baseURL: typeof window === 'undefined' ? undefined : window.location.origin })
  return client
}

export function withCap(token: string) {
  return { headers: { [CAP_TOKEN_HEADER]: token } }
}

export interface AuthFailure {
  code?: string
  message?: string
  status?: number
}

/** Chinese copy by error code. Server messages are never shown as they are (some are English). */
export function authErrorText(err: AuthFailure | null | undefined, fallback = '操作失败，请稍后再试'): string {
  if (!err) return fallback
  switch (err.code) {
    case 'CAPTCHA_MISSING':
      return '请先完成人机验证'
    case 'CAPTCHA_INVALID':
      return '人机验证已过期，请重试'
    case 'CAPTCHA_UNAVAILABLE':
      return '人机验证服务暂时不可用'
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_PASSWORD':
    case 'CREDENTIAL_ACCOUNT_NOT_FOUND':
      return '邮箱或密码不正确'
    case 'BANNED_USER':
      return '这个账号已被封禁，如有疑问请联系站长'
    case 'EMAIL_NOT_VERIFIED':
      return '邮箱还没有验证。请点击验证邮件里的链接，或重新发送一封。'
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return '这个邮箱已经注册过了，可以直接登录'
    case 'INVALID_EMAIL':
      return '邮箱格式不正确'
    case 'PASSWORD_TOO_SHORT':
      return '密码至少 8 位'
    case 'PASSWORD_TOO_LONG':
      return '密码太长了（最多 128 位）'
    case 'INVALID_TOKEN':
      return '链接无效或已过期，请重新申请'
    case 'TOKEN_EXPIRED':
      return '链接已过期，请重新申请'
    case 'SESSION_EXPIRED':
    case 'SESSION_NOT_FRESH':
      return '为了安全，请重新登录后再试'
  }
  if (err.status === 429) return '操作太频繁了，请稍后再试'
  return fallback
}

/** Password strength 0–4 for the four-segment meter. */
export function passwordStrength(pw: string): number {
  if (!pw) return 0
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  return Math.min(4, score)
}

export const STRENGTH_TEXT = ['', '强度：弱', '强度：一般', '强度：较好', '强度：很好']

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** A local path to return to after signing in; anything else falls back. */
export function safeNext(next: unknown, fallback = '/me'): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  return next
}
