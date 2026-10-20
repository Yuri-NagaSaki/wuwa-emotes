import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requirePerm } from '../perm/fn'
import {
  downloadsPatch,
  readDownloadSettings,
  riskOverview,
  saveDownloadSettings,
  setSourceMode as setSourceModeImpl,
  sourceModeInput,
  suspiciousSources,
} from './risk'

// 后台 › 下载与风控 server functions. Only 站长 holds the `downloads` permission; writes are audit logged.

/** KPIs: originals today, month-to-date R2 read estimate, throttled requests, listed sources. */
export const getRiskOverview = createServerFn({ method: 'GET' })
  .middleware([requirePerm('downloads')])
  .handler(async () => riskOverview())

/** The downloads settings (limits: null = unlimited). */
export const getRiskSettings = createServerFn({ method: 'GET' })
  .middleware([requirePerm('downloads')])
  .handler(async () => readDownloadSettings())

/** Partial update: keys left out keep their value, null clears a limit. Returns the saved settings. */
export const saveRiskSettings = createServerFn({ method: 'POST' })
  .middleware([requirePerm('downloads')])
  .validator(downloadsPatch)
  .handler(async ({ data, context }) => saveDownloadSettings(context.viewer, data))

/** 可疑来源: top subjects of the last day with their features and blocked_sources state. */
export const listSuspiciousSources = createServerFn({ method: 'GET' })
  .middleware([requirePerm('downloads')])
  .validator(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
  .handler(async ({ data }) => suspiciousSources({ limit: data?.limit }))

/** Block, watch or release (mode: 'none') a subject (ip:<hash> or user:<id>). */
export const setSourceMode = createServerFn({ method: 'POST' })
  .middleware([requirePerm('downloads')])
  .validator(sourceModeInput)
  .handler(async ({ data, context }) => setSourceModeImpl(context.viewer, data))
