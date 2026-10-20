import { log } from '../../log'
import { type JobData, Q, type QueueName } from '../queues'
import { dailyCleanup, rollupStats } from './maintenance'
import { deriveEmoji, generateFull } from './media'

export interface Handler<N extends QueueName> {
  run(data: JobData[N]): Promise<void>
  /** parallel jobs of this queue in one worker; image work stays at 1 (memory) */
  concurrency?: number
}

function notImplemented(name: QueueName) {
  return async () => {
    log().warn({ queue: name }, 'job handler not implemented yet; job skipped')
  }
}

// One entry per queue. Feature lanes replace the notImplemented placeholders in their own files.
export const HANDLERS: { [N in QueueName]: Handler<N> } = {
  [Q.ingest]: { run: notImplemented(Q.ingest) },
  [Q.derive]: { run: deriveEmoji },
  [Q.full]: { run: generateFull },
  [Q.zipBuild]: { run: notImplemented(Q.zipBuild) },
  [Q.statsRollup]: { run: rollupStats },
  [Q.dbBackup]: { run: notImplemented(Q.dbBackup) },
  [Q.cleanup]: { run: dailyCleanup },
  [Q.r2Alert]: { run: notImplemented(Q.r2Alert) },
}
