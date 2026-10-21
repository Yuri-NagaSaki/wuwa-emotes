import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { admin } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db, schema } from '../db/client'
import { env } from '../env'
import { hashValue } from '../http/client'
import { log, maskEmails } from '../log'
import { mailConfigured, sendMail } from '../mail'
import { ac, authRoles } from './access'
import { CAP_HEADER, capErrorMessage, verifyCapToken } from './cap'
import { AUTH_RATE_RULES, CAP_PROTECTED_PATHS, durationText, forgetExistingNotice, mayNoticeExisting, RESET_PASSWORD_EXPIRES_IN, VERIFY_EMAIL_EXPIRES_IN } from './policy'
import { signedInHintHook } from './signed-in-hint'

export { CAP_PROTECTED_PATHS } from './policy'

/** Better Auth's own log lines (existing-email sign-ups, failed sends) into pino, addresses masked. */
function authLog(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: unknown[]) {
  const detail = args
    .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : null))
    .filter((a): a is string => Boolean(a))
    .map((a) => maskEmails(a).slice(0, 300))
  log()[level](detail.length ? { detail } : {}, `auth: ${maskEmails(message)}`)
}

/** The 「这个邮箱已经注册过」 notice; an account that was never verified has to verify before 登录 works. */
export function existingSignUpText(siteName: string, siteUrl: string, verified: boolean): string {
  const head = `有人（可能是你）刚刚用这个邮箱在${siteName}注册。`
  const tail = `忘记密码：${siteUrl}/forgot-password\n\n如果不是你本人操作，请忽略这封邮件，你的账号没有任何变化。`
  if (verified) return `${head}这个邮箱已经有账号了，不需要再注册。\n\n直接登录：${siteUrl}/login\n${tail}`
  return `${head}这个邮箱已经注册过，但还没有验证。\n\n登录时页面会提示邮箱未验证，点「重新发送」会收到新的验证邮件：${siteUrl}/login\n${tail}`
}

function createAuth() {
  const e = env()
  return betterAuth({
    appName: e.SITE_NAME,
    baseURL: e.SITE_URL,
    secret: e.AUTH_SECRET,
    trustedOrigins: [e.SITE_URL],
    database: drizzleAdapter(db(), {
      provider: 'pg',
      usePlural: true,
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
        rateLimits: schema.rateLimits,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      // Without SMTP nobody could ever verify, so only require verification when mail works.
      requireEmailVerification: mailConfigured(),
      resetPasswordTokenExpiresIn: RESET_PASSWORD_EXPIRES_IN,
      // a reset means the old password may be known to someone else: sign every device out
      revokeSessionsOnPasswordReset: true,
      // Signing up with an address that already has an account answers like a new sign-up (so the
      // form does not reveal which addresses are registered) and sends nothing by default. Tell the
      // owner of the address instead, so 「验证邮件已发出」 is never followed by an empty inbox.
      // Not a fresh verification link for an unverified account: its password was chosen by whoever
      // signed up first, and the link signs in. The notice sends them to 登录 (重新发送) or 忘记密码.
      onExistingUserSignUp: async ({ user }) => {
        if (!mayNoticeExisting(user.email)) return
        try {
          await sendMail(user.email, `${e.SITE_NAME} · 这个邮箱已经注册过`, existingSignUpText(e.SITE_NAME, e.SITE_URL, user.emailVerified))
        } catch {
          // already logged by sendMail; the sign-up answer must not change. A later try may send it.
          forgetExistingNotice(user.email)
        }
      },
      sendResetPassword: async ({ user, url }) => {
        await sendMail(
          user.email,
          `${e.SITE_NAME} · 重置密码`,
          `点击下面的链接重置密码（${durationText(RESET_PASSWORD_EXPIRES_IN)}内有效）：\n\n${url}\n\n如果不是你本人操作，请忽略这封邮件。`,
        )
      },
    },
    emailVerification: {
      sendOnSignUp: mailConfigured(),
      autoSignInAfterVerification: true,
      expiresIn: VERIFY_EMAIL_EXPIRES_IN,
      sendVerificationEmail: async ({ user, url }) => {
        await sendMail(
          user.email,
          `${e.SITE_NAME} · 验证邮箱`,
          `欢迎来到${e.SITE_NAME}。点击下面的链接验证邮箱（${durationText(VERIFY_EMAIL_EXPIRES_IN)}内有效）：\n\n${url}\n\n如果不是你本人注册，请忽略这封邮件。`,
        )
      },
    },
    user: {
      additionalFields: {
        submitMode: { type: 'string', required: false, defaultValue: 'review', input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 120,
      // per IP; /send-verification-email has no Cap check, so its rule is the strict one
      customRules: { ...AUTH_RATE_RULES },
    },
    logger: { level: 'info', log: authLog },
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      useSecureCookies: e.NODE_ENV === 'production',
    },
    databaseHooks: {
      session: {
        create: {
          // store only salted hashes of IP and user agent
          before: async (session) => ({
            data: { ...session, ipAddress: hashValue(session.ipAddress), userAgent: hashValue(session.userAgent) },
          }),
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!CAP_PROTECTED_PATHS.has(ctx.path)) return
        const result = await verifyCapToken(ctx.headers?.get(CAP_HEADER))
        if (!result.ok) {
          throw new APIError(result.reason === 'unavailable' ? 'SERVICE_UNAVAILABLE' : 'BAD_REQUEST', {
            code: `CAPTCHA_${result.reason.toUpperCase()}`,
            message: capErrorMessage(result.reason),
          })
        }
      }),
      // the signed-in hint cookie follows the session cookie (src/server/auth/signed-in-hint.ts); runs
      // before the plugins' after hooks, so tanstackStartCookies() below still forwards it
      after: signedInHintHook,
    },
    plugins: [
      admin({ ac, roles: authRoles, adminRoles: ['admin'], defaultRole: 'user', impersonationSessionDuration: 60 * 30 }),
      // must stay last so cookies set by other plugins reach the TanStack Start response
      tanstackStartCookies(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>

let instance: Auth | undefined

export function auth(): Auth {
  instance ??= createAuth()
  return instance
}
