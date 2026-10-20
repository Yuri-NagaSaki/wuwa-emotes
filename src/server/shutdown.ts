import { useNitroHooks } from 'nitro/app'
import { closeDb } from './db/client'
import { stopJobSender } from './jobs/boss'
import { log } from './log'

// Web process shutdown (SIGTERM from `docker stop` or a compose recreate; SIGINT locally).
//
// Nitro's Bun server (srvx) already handles the signal: it stops accepting connections and waits for
// in-flight requests (at most SERVER_SHUTDOWN_TIMEOUT seconds), then runs Nitro's `close` hooks. What it
// does not do is end the process: the pg pool (30 s idle timeout) and the pg-boss sender keep it alive
// until Docker's SIGKILL. This hook closes both once the requests are done, so the container exits 0.
// Web only: the worker, migrate and the CLI close their own connections.

let registered = false

export function registerShutdown() {
  if (registered) return
  registered = true
  useNitroHooks().hook('close', async () => {
    const started = Date.now()
    const results = await Promise.allSettled([stopJobSender(), closeDb()])
    const failed = results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason))
    log().info({ ms: Date.now() - started, failed }, 'shutdown: requests drained, database connections closed')
    // Backstop: exit even if some other handle (a stray timer) would keep the process alive.
    setTimeout(() => process.exit(0), 1000).unref()
  })
}
