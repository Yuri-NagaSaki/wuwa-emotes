import { createAccessControl } from 'better-auth/plugins/access'
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access'

// Access control for Better Auth's admin endpoints (list users, set role, ban, impersonate, …).
// Only 站长 (admin) gets them; 管理员 (manager) and 用户 (user) get none, so a manager calling
// set-role is rejected by Better Auth itself. App permissions live in src/shared/roles.ts.

export const ac = createAccessControl(defaultStatements)

export const authRoles = {
  // must include the plugin's own admin statements, or the admin endpoints reject 站长 too
  admin: ac.newRole({ ...adminAc.statements }),
  manager: ac.newRole({ user: [], session: [] }),
  user: ac.newRole({ user: [], session: [] }),
}
