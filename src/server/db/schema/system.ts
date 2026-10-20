import { bigint, index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import { createdAt, tstz } from './_shared'

export const redirects = pgTable('redirects', {
  fromPath: text('from_path').primaryKey(),
  toPath: text('to_path').notNull(),
  code: integer('code').notNull().default(301),
  createdAt: createdAt(),
})

/** Runtime settings edited in 系统设置 (site name override, risk limits, switches, …) */
export const siteSettings = pgTable('site_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  updatedBy: text('updated_by'),
})

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    actorId: text('actor_id'),
    actorRole: text('actor_role'),
    impersonatedBy: text('impersonated_by'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    diff: jsonb('diff').$type<unknown>(),
    ipHash: text('ip_hash'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_created_idx').on(t.createdAt), index('audit_logs_target_idx').on(t.targetType, t.targetId)],
)
