import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { requirePerm } from '../../perm/fn'
import { auditListInput, banInput, jobActionInput, setRoleInput, siteSettingsInput, submitModeInput, userIdInput, userListInput } from '../inputs'
import { auditActions, getJobs, getSettings, getStorage, jobAction, listAudit, saveSiteSettings } from '../system'
import { banUser, impersonateUser, listUsers, revokeSessions, setSubmitMode, setUserRole, unbanUser } from '../users'

// 站长-only pages (docs/ARCHITECTURE.md §5.1): 用户与权限 (users), 存储 (storage), 任务队列 (system),
// 审计日志 (audit), 系统设置 (settings). Better Auth admin endpoints get the caller's own headers.

const headers = () => getRequest().headers

// ---------- 用户与权限 (users) ----------

export const adminUsersFn = createServerFn({ method: 'GET' })
  .middleware([requirePerm('users')])
  .validator(userListInput)
  .handler(({ data }) => listUsers(data))

export const adminSetRoleFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('users')])
  .validator(setRoleInput)
  .handler(({ data, context }) => setUserRole(context.viewer, headers(), data))

export const adminSetSubmitModeFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('users')])
  .validator(submitModeInput)
  .handler(({ data, context }) => setSubmitMode(context.viewer, data))

export const adminBanUserFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('users')])
  .validator(banInput)
  .handler(({ data, context }) => banUser(context.viewer, headers(), data))

export const adminUnbanUserFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('users')])
  .validator(userIdInput)
  .handler(({ data, context }) => unbanUser(context.viewer, headers(), data))

export const adminRevokeSessionsFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('users')])
  .validator(userIdInput)
  .handler(({ data, context }) => revokeSessions(context.viewer, headers(), data))

export const adminImpersonateFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('users')])
  .validator(userIdInput)
  .handler(({ data, context }) => impersonateUser(context.viewer, headers(), data))

// ---------- 存储 (storage) ----------

export const adminStorageFn = createServerFn({ method: 'GET' })
  .middleware([requirePerm('storage')])
  .handler(() => getStorage())

// ---------- 任务队列 (system) ----------

export const adminJobsFn = createServerFn({ method: 'GET' })
  .middleware([requirePerm('system')])
  .handler(() => getJobs())

export const adminRetryJobFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('system')])
  .validator(jobActionInput)
  .handler(({ data, context }) => jobAction(context.viewer, data, 'retry'))

export const adminCancelJobFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('system')])
  .validator(jobActionInput)
  .handler(({ data, context }) => jobAction(context.viewer, data, 'cancel'))

// ---------- 审计日志 (audit) ----------

export const adminAuditFn = createServerFn({ method: 'GET' })
  .middleware([requirePerm('audit')])
  .validator(auditListInput)
  .handler(async ({ data }) => ({ ...(await listAudit(data)), actions: await auditActions() }))

// ---------- 系统设置 (settings) ----------

export const adminSettingsFn = createServerFn({ method: 'GET' })
  .middleware([requirePerm('settings')])
  .handler(() => getSettings())

export const adminSaveSiteFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('settings')])
  .validator(siteSettingsInput)
  .handler(({ data, context }) => saveSiteSettings(context.viewer, data))
