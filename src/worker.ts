// Background worker: image derivatives, ZIP builds, backups, rollups. Runs in its own container
// (2 GB memory, 1 CPU) so image work can never take the website down.
process.env.CHAOCHI_SERVICE ??= 'worker'

import { PgBoss } from 'pg-boss'
import { closeDb } from './server/db/client'
import { env } from './server/env'
import { ensureQueues } from './server/jobs/boss'
import { HANDLERS } from './server/jobs/handlers'
import { type QueueName, SCHEDULES } from './server/jobs/queues'
import { log } from './server/log'
import { configureSharp } from './server/media/derive'

async function main() {
  configureSharp()
  const boss = new PgBoss({ connectionString: env().DATABASE_URL, max: 4, application_name: 'chaochi-worker' })
  boss.on('error', (err) => log().error({ err: err.message }, 'pg-boss error'))
  await boss.start()
  await ensureQueues(boss)

  for (const [name, handler] of Object.entries(HANDLERS) as [QueueName, (typeof HANDLERS)[QueueName]][]) {
    await boss.work(name, { batchSize: 1, localConcurrency: handler.concurrency ?? 1 }, async (jobs) => {
      for (const job of jobs) {
        const started = Date.now()
        await (handler.run as (d: unknown) => Promise<void>)(job.data)
        log().info({ queue: name, job: job.id, ms: Date.now() - started }, 'job done')
      }
    })
  }
  for (const s of SCHEDULES) await boss.schedule(s.name, s.cron, {}, { tz: 'Asia/Shanghai' })
  log().info({ queues: Object.keys(HANDLERS).length }, 'worker started')

  let stopping = false
  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    log().info({ signal }, 'worker stopping: finishing active jobs')
    await boss.stop({ graceful: true, timeout: 60_000 })
    await closeDb()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  log().fatal({ err: err instanceof Error ? err.stack : String(err) }, 'worker failed to start')
  process.exit(1)
})
