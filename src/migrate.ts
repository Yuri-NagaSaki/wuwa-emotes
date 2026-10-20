// One-shot: apply SQL migrations and install/upgrade the pg-boss schema, then exit.
// Runs before web and worker start (compose `migrate` service), so both can assume the schema exists.
// Migrations must stay backward compatible with the previous release (expand first, contract later):
// during a rolling deploy the old web replica keeps serving while the new one starts.
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { PgBoss } from 'pg-boss'
import { closeDb, db } from './server/db/client'
import { env } from './server/env'
import { ensureQueues } from './server/jobs/boss'
import { log } from './server/log'

async function main() {
  const started = Date.now()
  await migrate(db(), { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) })
  log().info({ ms: Date.now() - started }, 'migrate: database schema up to date')

  const boss = new PgBoss({ connectionString: env().DATABASE_URL, max: 2, schedule: false, supervise: false })
  await boss.start()
  await ensureQueues(boss)
  await boss.stop({ graceful: true })
  log().info('migrate: job queues ready')
  await closeDb()
}

main().catch((err) => {
  log().fatal({ err: err instanceof Error ? err.message : String(err) }, 'migrate failed')
  process.exit(1)
})
