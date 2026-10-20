import { bigint, boolean, index, integer, pgTable, text } from 'drizzle-orm/pg-core'
import type { Role, SubmitMode } from '#/shared/roles'
import { createdAt, tstz, updatedAt } from './_shared'

// Tables read and written by Better Auth (adapter option usePlural: true).
// TS keys must equal Better Auth field names; the SQL columns are snake_case.

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // admin plugin
    role: text('role').$type<Role>().notNull().default('user'),
    banned: boolean('banned').notNull().default(false),
    banReason: text('ban_reason'),
    banExpires: tstz('ban_expires'),
    // app fields (declared as additionalFields in the auth config)
    submitMode: text('submit_mode').$type<SubmitMode>().notNull().default('review'),
  },
  (t) => [index('users_role_idx').on(t.role)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: tstz('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // stored as salted hashes, never raw values
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonated_by'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: tstz('access_token_expires_at'),
    refreshTokenExpiresAt: tstz('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('accounts_user_idx').on(t.userId)],
)

export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
)

export const rateLimits = pgTable('rate_limits', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
})
