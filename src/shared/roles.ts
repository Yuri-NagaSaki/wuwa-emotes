// Three roles. 站长 (admin) holds every permission; 管理员 (manager) runs packs, uploads,
// taxonomy, submission review and comments; every 用户 (user) may submit packs.
// Menus only mirror this table: the server checks the permission on every route and action.

export const PERMS = [
  'dash',
  'packs',
  'review',
  'upload',
  'taxonomy',
  'comments',
  'users',
  'downloads',
  'storage',
  'system',
  'audit',
  'settings',
  'submit',
] as const

export type Perm = (typeof PERMS)[number]
export type Role = 'admin' | 'manager' | 'user'

export const ROLES: Record<Role, { name: string; perms: readonly (Perm | '*')[] }> = {
  admin: { name: '站长', perms: ['*'] },
  manager: { name: '管理员', perms: ['dash', 'packs', 'review', 'upload', 'taxonomy', 'comments', 'submit'] },
  user: { name: '用户', perms: ['submit'] },
}

export function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'manager' || value === 'user'
}

/** Unknown or missing roles get no permissions. */
export function can(role: string | null | undefined, perm: Perm): boolean {
  if (!isRole(role)) return false
  const perms = ROLES[role].perms
  return perms.includes('*') || perms.includes(perm)
}

export type SubmitMode = 'review' | 'trusted' | 'blocked'
