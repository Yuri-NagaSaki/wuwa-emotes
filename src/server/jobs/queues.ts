import type { PgBoss } from 'pg-boss'

// Queue names and their policies. `exclusive` + singletonKey = at most one queued-or-active job per key,
// e.g. repeated /img misses for the same emoji enqueue a single media.full job.

export const Q = {
  ingest: 'media.ingest',
  derive: 'media.derive',
  full: 'media.full',
  zipBuild: 'zip.build',
  statsRollup: 'stats.rollup',
  dbBackup: 'db.backup',
  cleanup: 'cleanup.daily',
  r2Alert: 'r2.alert',
} as const

export type QueueName = (typeof Q)[keyof typeof Q]

export interface JobData {
  [Q.ingest]: { uploadItemId: string }
  [Q.derive]: { emojiId: string; target: 'review' | 'derived' }
  [Q.full]: { emojiId: string }
  [Q.zipBuild]: { packId: number }
  [Q.statsRollup]: Record<string, never>
  [Q.dbBackup]: Record<string, never>
  [Q.cleanup]: Record<string, never>
  [Q.r2Alert]: Record<string, never>
}

export const QUEUE_OPTIONS: Record<QueueName, Parameters<PgBoss['createQueue']>[1]> = {
  [Q.ingest]: { policy: 'standard', retryLimit: 3, retryDelay: 30, expireInSeconds: 600 },
  [Q.derive]: { policy: 'exclusive', retryLimit: 3, retryDelay: 60, expireInSeconds: 600 },
  [Q.full]: { policy: 'exclusive', retryLimit: 2, retryDelay: 60, expireInSeconds: 900 },
  [Q.zipBuild]: { policy: 'exclusive', retryLimit: 3, retryDelay: 120, expireInSeconds: 1800 },
  [Q.statsRollup]: { policy: 'singleton', retryLimit: 1, expireInSeconds: 300 },
  [Q.dbBackup]: { policy: 'singleton', retryLimit: 2, retryDelay: 600, expireInSeconds: 3600 },
  [Q.cleanup]: { policy: 'singleton', retryLimit: 1, expireInSeconds: 1800 },
  [Q.r2Alert]: { policy: 'singleton', retryLimit: 1, expireInSeconds: 300 },
}

/** Cron schedules (Asia/Shanghai) registered by the worker. */
export const SCHEDULES: { name: QueueName; cron: string }[] = [
  { name: Q.statsRollup, cron: '5 * * * *' },
  { name: Q.dbBackup, cron: '0 3 * * *' },
  { name: Q.r2Alert, cron: '0 4 * * *' },
  { name: Q.cleanup, cron: '30 4 * * *' },
]
