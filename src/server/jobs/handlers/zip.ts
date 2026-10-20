import { log } from '../../log'
import { buildPackZip } from '../../media/zip'
import type { JobData } from '../queues'

/** zip.build (singletonKey = pack id): rebuild the pack ZIP when its published content changed. */
export async function zipBuildJob({ packId }: JobData['zip.build']) {
  const r = await buildPackZip(packId)
  if (r.status === 'skipped') log().info({ packId, reason: r.reason }, 'zip: skipped')
}
