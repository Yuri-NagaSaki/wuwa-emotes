import { type JobData, Q, type QueueName } from '../queues'
import { r2AlertJob } from './alerts'
import { dbBackupJob } from './backup'
import { ingestJob } from './ingest'
import { dailyCleanup, rollupStats } from './maintenance'
import { deriveEmoji, generateFull } from './media'
import { zipBuildJob } from './zip'

export interface Handler<N extends QueueName> {
  run(data: JobData[N]): Promise<void>
  /** parallel jobs of this queue in one worker; image work stays at 1 (memory) */
  concurrency?: number
}

// One entry per queue.
export const HANDLERS: { [N in QueueName]: Handler<N> } = {
  [Q.ingest]: { run: ingestJob },
  [Q.derive]: { run: deriveEmoji },
  [Q.full]: { run: generateFull },
  [Q.zipBuild]: { run: zipBuildJob },
  [Q.statsRollup]: { run: rollupStats },
  [Q.dbBackup]: { run: dbBackupJob },
  [Q.cleanup]: { run: dailyCleanup },
  [Q.r2Alert]: { run: r2AlertJob },
}
