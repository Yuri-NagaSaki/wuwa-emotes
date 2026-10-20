import type { IconName } from '../icons'

// Public navigation tables (paths are created by the pages lane; links resolve at runtime).

export interface NavItem {
  to: string
  label: string
  icon: IconName
}

export const MAIN_NAV: readonly NavItem[] = [
  { to: '/', label: '首页', icon: 'home' },
  { to: '/packs', label: '表情包', icon: 'grid' },
  { to: '/characters', label: '角色', icon: 'users' },
  { to: '/gallery', label: '画廊', icon: 'wave' },
  { to: '/explore', label: '探索', icon: 'hash' },
]

/**
 * The main-nav entry a page belongs to (the prototype's `shell(ctx, active)`): 画师 and 搜索 sit under
 * 探索, the reading pages under 首页. Null: no entry is highlighted (account, 打包, admin).
 */
export function navKeyFor(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, '') || '/'
  if (p === '/') return '/'
  const first = `/${p.split('/')[1]}`
  if (first === '/packs' || first === '/e') return '/packs'
  if (first === '/characters' || first === '/gallery') return first
  if (first === '/explore' || first === '/artists' || first === '/search' || first === '/tags') return '/explore'
  if (first === '/about' || first === '/links' || first === '/legal') return '/'
  return null
}

export const TAB_NAV: readonly NavItem[] = [
  { to: '/', label: '首页', icon: 'home' },
  { to: '/packs', label: '表情包', icon: 'grid' },
  { to: '/gallery', label: '画廊', icon: 'wave' },
  { to: '/characters', label: '角色', icon: 'users' },
  { to: '/me', label: '我的', icon: 'user' },
]

export interface FooterGroup {
  title: string
  links: readonly { to: string; label: string }[]
}

/** `{site}` is replaced with the site name. */
export const FOOTER_NAV: readonly FooterGroup[] = [
  {
    title: '浏览',
    links: [
      { to: '/packs', label: '全部表情包' },
      { to: '/characters', label: '角色图鉴' },
      { to: '/gallery', label: '潮汐画廊' },
    ],
  },
  {
    title: '社区',
    links: [
      { to: '/about', label: '关于{site}' },
      { to: '/links', label: '友情链接' },
      { to: '/artists', label: '画师名录' },
    ],
  },
  {
    title: '规则',
    links: [
      { to: '/legal/privacy', label: '隐私政策' },
      { to: '/legal/terms', label: '服务条款' },
      { to: '/legal/takedown', label: '版权与下架申诉' },
    ],
  },
]
