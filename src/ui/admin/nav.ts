import { can, type Perm } from '#/shared/roles'
import type { IconName } from '../icons'

// Admin sidebar (from the prototype's ADM_NAV). Menus only mirror permissions: every admin route and
// server function checks the permission itself.

export type AdminNavId =
  | 'dash'
  | 'review'
  | 'packs'
  | 'upload'
  | 'emojis'
  | 'characters'
  | 'artists'
  | 'taxonomy'
  | 'comments'
  | 'users'
  | 'downloads'
  | 'storage'
  | 'jobs'
  | 'audit'
  | 'settings'

export interface AdminNavItem {
  id: AdminNavId
  to: string
  label: string
  icon: IconName
  perm: Perm
}

export interface AdminNavGroup {
  title: string
  items: readonly AdminNavItem[]
}

export const ADMIN_NAV: readonly AdminNavGroup[] = [
  { title: '概览', items: [{ id: 'dash', to: '/admin', label: '仪表盘', icon: 'gauge', perm: 'dash' }] },
  {
    title: '内容',
    items: [
      { id: 'review', to: '/admin/review', label: '投稿审核', icon: 'inbox', perm: 'review' },
      { id: 'packs', to: '/admin/packs', label: '表情包', icon: 'grid', perm: 'packs' },
      { id: 'upload', to: '/admin/upload', label: '上传中心', icon: 'upload', perm: 'upload' },
      { id: 'emojis', to: '/admin/emojis', label: '表情库', icon: 'image', perm: 'packs' },
      { id: 'characters', to: '/admin/characters', label: '角色', icon: 'users', perm: 'taxonomy' },
      { id: 'artists', to: '/admin/artists', label: '画师', icon: 'edit', perm: 'taxonomy' },
      { id: 'taxonomy', to: '/admin/taxonomy', label: '标签', icon: 'hash', perm: 'taxonomy' },
    ],
  },
  {
    title: '社区',
    items: [
      { id: 'comments', to: '/admin/comments', label: '评论审核', icon: 'chat', perm: 'comments' },
      { id: 'users', to: '/admin/users', label: '用户与权限', icon: 'user', perm: 'users' },
    ],
  },
  {
    title: '系统',
    items: [
      { id: 'downloads', to: '/admin/downloads', label: '下载与风控', icon: 'shield', perm: 'downloads' },
      { id: 'storage', to: '/admin/storage', label: '存储 R2', icon: 'cloud', perm: 'storage' },
      { id: 'jobs', to: '/admin/jobs', label: '任务队列', icon: 'layers', perm: 'system' },
      { id: 'audit', to: '/admin/audit', label: '审计日志', icon: 'history', perm: 'audit' },
      { id: 'settings', to: '/admin/settings', label: '系统设置', icon: 'sliders', perm: 'settings' },
    ],
  },
]

const ALL = ADMIN_NAV.flatMap((g) => g.items)

/** Groups and items the role may see; empty groups are dropped. */
export function navForRole(role: string | null | undefined): AdminNavGroup[] {
  return ADMIN_NAV.map((g) => ({ title: g.title, items: g.items.filter((i) => can(role, i.perm)) })).filter((g) => g.items.length > 0)
}

/** The nav item a path belongs to (longest matching prefix; "/admin" itself only matches exactly). */
export function activeNavItem(pathname: string): AdminNavItem | undefined {
  const path = pathname.replace(/\/+$/, '') || '/'
  let best: AdminNavItem | undefined
  for (const item of ALL) {
    const hit = item.to === '/admin' ? path === '/admin' : path === item.to || path.startsWith(item.to + '/')
    if (hit && (!best || item.to.length > best.to.length)) best = item
  }
  return best
}

/** Staff = may open the admin at all (站长 and 管理员). */
export function isStaff(role: string | null | undefined): boolean {
  return can(role, 'dash')
}

/** Whether the role may open this path. Unknown admin paths fall back to staff-only. */
export function canOpen(role: string | null | undefined, pathname: string): boolean {
  if (!isStaff(role)) return false
  const item = activeNavItem(pathname)
  return item ? can(role, item.perm) : true
}

export interface AdminSearchTarget {
  to: '/admin/packs' | '/admin/emojis' | '/admin/users'
  q: string
}

const EMOJI_QUERY = /^(r-[0-9a-f]{1,20}|[0-9a-f]{64})$/i

/**
 * Where the top-bar search (搜索包、表情 ID、用户) goes, as the ?q= filter of a list page: emoji ids
 * (r-…) and SHA-256 hashes open 表情库, e-mail addresses open 用户与权限 (站长 only); anything else
 * searches the list being viewed when that is 表情库 or 用户与权限, and 表情包 otherwise.
 */
export function adminSearchTarget(query: string, role: string | null | undefined, pathname: string): AdminSearchTarget {
  const q = query.trim()
  if (EMOJI_QUERY.test(q)) return { to: '/admin/emojis', q: q.toLowerCase() }
  const users = can(role, 'users')
  if (users && q.includes('@')) return { to: '/admin/users', q }
  const here = activeNavItem(pathname)?.id
  if (here === 'users' && users) return { to: '/admin/users', q }
  if (here === 'emojis') return { to: '/admin/emojis', q }
  return { to: '/admin/packs', q }
}
