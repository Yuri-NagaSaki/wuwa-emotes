import { getViewer } from '../auth/session'
import { env } from '../env'
import { ipSubject } from '../http/client'
import { presignGet } from '../media/s3'
import { enqueuePackZip } from '../media/zip'
import { getSetting } from '../settings'
import type { DownloadDeps } from './handlers'
import { batchCredits, bumpPackDownloads, creditsSite, lookupEmojis, lookupPackBySlug, packZipState } from './lookup'
import { pgPolicyDeps } from './store'

/** Real dependencies for the download routes. */
export const downloadDeps: DownloadDeps = {
  policy: pgPolicyDeps,
  siteOrigin: () => new URL(env().SITE_URL).origin,
  async getViewer(headers) {
    const v = await getViewer(headers)
    return v ? { id: v.id, role: v.role } : null
  },
  settings: () => getSetting('downloads'),
  ipSubject,
  lookupEmojis,
  lookupPackBySlug,
  presign: (key, opts) => presignGet(key, opts),
  bumpPackDownloads,
  zipState: packZipState,
  enqueueZip: enqueuePackZip,
  credits: batchCredits,
  site: creditsSite,
}
