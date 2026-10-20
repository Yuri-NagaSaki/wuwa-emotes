import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { admin } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db, schema } from '../db/client'
import { env } from '../env'
import { hashValue } from '../http/client'
import { mailConfigured, sendMail } from '../mail'
import { ac, authRoles } from './access'
import { CAP_HEADER, capErrorMessage, verifyCapToken } from './cap'
import { AUTH_RATE_RULES, CAP_PROTECTED_PATHS, durationText, RESET_PASSWORD_EXPIRES_IN, VERIFY_EMAIL_EXPIRES_IN } from './policy'

export { CAP_PROTECTED_PATHS } from './policy'

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
