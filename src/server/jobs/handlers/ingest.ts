import { ingestUpload } from '../../media/ingest'
import type { JobData } from '../queues'

/**
 * media.ingest: validate one upload and turn it into a pending emoji. Rejected files (size, format,
 * dimensions) end as status 'failed' without throwing; storage or database errors throw so pg-boss
 * retries the job.
 */
export async function ingestJob({ uploadItemId }: JobData['media.ingest']) {
  await ingestUpload(uploadItemId)
}
