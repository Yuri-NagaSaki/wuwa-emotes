import { PgBoss } from 'pg-boss'
import { env } from '../env'
import { log } from '../log'
import { type JobData, Q, QUEUE_OPTIONS, type QueueName } from './queues'

// The web process only sends jobs: no maintenance, no schedules, no migrations (migrate.ts installs
// the pg-boss schema before any web or worker container starts).

let sender: Promise<PgBoss> | undefined

export function jobSender(): Promise<PgBoss> {
  sender ??= (async () => {
    const boss = new PgBoss({
      connectionString: env().DATABASE_URL,
      max: 2,
      schedule: false,
      supervise: false,
      migrate: false,
      createSchema: false,
      application_name: 'chaochi-web',
    })
    boss.on('error', (err) => log().error({ err: err.message }, 'pg-boss (sender) error'))
    await boss.start()
    return boss
  })()
  return sender
}

/** Web shutdown (src/server/shutdown.ts): stop the sender if a request ever started it; no-op otherwise. */
export async function stopJobSender() {
  const pending = sender
  sender = undefined
  if (!pending) return
  const boss = await pending.catch(() => undefined)
  await boss?.stop({ graceful: true, close: true, timeout: 5_000 })
}

export async function sendJob<N extends QueueName>(name: N, data: JobData[N], opts: { singletonKey?: string; startAfter?: number } = {}) {
  const boss = await jobSender()
  return boss.send(name, data as object, opts)
}

export async function ensureQueues(boss: PgBoss) {
  for (const name of Object.values(Q)) {
    await boss.createQueue(name, QUEUE_OPTIONS[name])
  }
}
