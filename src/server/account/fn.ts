import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireUser } from '../perm/fn'

// 个人中心 server functions (summary, 通知, 注销账号). Name, password and sessions go through Better
// Auth's endpoints from the browser instead.

export const getMeSummaryFn = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const { meSummary } = await import('./service')
    return meSummary(context.viewer)
  })

export const listNotificationsFn = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ before: z.number().int().positive().optional() }))
  .handler(async ({ data, context }) => {
    const { listNotifications } = await import('./notifications')
    return listNotifications(context.viewer.id, data.before)
  })

/** Mark the given notifications read, or all of them without ids. Returns the unread count. */
export const markNotificationsReadFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ ids: z.array(z.number().int().positive()).max(200).optional() }))
  .handler(async ({ data, context }) => {
    const { markRead } = await import('./notifications')
    return { unread: await markRead(context.viewer.id, data.ids) }
  })

export const deleteAccountFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ password: z.string().min(1).max(128) }))
  .handler(async ({ data, context }) => {
    const { deleteAccount } = await import('./service')
    await deleteAccount(context.viewer, data.password)
    return { ok: true as const }
  })
