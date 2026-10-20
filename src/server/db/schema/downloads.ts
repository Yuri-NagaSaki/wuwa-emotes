import { bigint, date, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { packs } from './catalog'
import { createdAt, tstz } from './_shared'

// Counters and rate windows are UNLOGGED (set in the migration): fast, and emptied after a crash,
// which is acceptable for daily limits. download_stats_daily is a normal table fed hourly.

export type CounterKind = 'orig' | 'batch_item' | 'batch' | 'zip'

export const downloadCounters = pgTable(
  'download_counters',
  {
    // ip:<hash> or user:<id>
    subject: text('subject').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    kind: text('kind').$type<CounterKind>().notNull(),
    n: integer('n').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.subject, t.day, t.kind] })],
)

/** Generic fixed-window rate limiter storage (per minute buckets etc.) */
export const rateWindows = pgTable(
  'rate_windows',
  {
    subject: text('subject').notNull(),
    bucket: text('bucket').notNull(),
    windowStart: tstz('window_start').notNull(),
    n: integer('n').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.subject, t.bucket, t.windowStart] })],
)

export const downloadStatsDaily = pgTable(
  'download_stats_daily',
  {
    day: date('day', { mode: 'string' }).notNull(),
    kind: text('kind').notNull(),
    subjectCount: integer('subject_count').notNull().default(0),
    n: bigint('n', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.kind] })],
)

export type BlockMode = 'block' | 'watch'

export const blockedSources = pgTable('blocked_sources', {
  subject: text('subject').primaryKey(),
  mode: text('mode').$type<BlockMode>().notNull().default('watch'),
  reason: text('reason'),
  until: tstz('until'),
  createdBy: text('created_by'),
  createdAt: createdAt(),
})

export const zipArtifacts = pgTable('zip_artifacts', {
  packId: integer('pack_id')
    .primaryKey()
    .references(() => packs.id, { onDelete: 'cascade' }),
  contentHash: text('content_hash').notNull(),
  objectKey: text('object_key').notNull(),
  bytes: bigint('bytes', { mode: 'number' }).notNull(),
  builtAt: tstz('built_at').notNull().defaultNow(),
})
