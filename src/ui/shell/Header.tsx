import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ROLES } from '#/shared/roles'
import { isStaff } from '../admin/nav'
import { IconButton } from '../Button'
import { cx } from '../cx'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { LogoMark, LogoWord } from '../LogoMark'
import { Menu, type MenuEntry } from '../Menu'
import { Sheet } from '../Sheet'
import { useOptionalSiteConfig } from '../site-config'
import { toast } from '../Toast'
import { PHONE_QUERY, useMediaQuery } from '../useMediaQuery'
import { MAIN_NAV, navKeyFor } from './nav'
import { isNight, setPref, subscribeTheme } from './theme'

export interface HeaderUser {
  name: string
  avatarUrl?: string | null
}

export interface HeaderProps {
  siteName: string
  subtitle?: string
  /** Stickers in the 打包 tray (badge). */
  trayCount?: number
  /** Open the tray drawer. Without it the button links to /batch. */
  onTrayClick?: () => void
  /** Open search (command palette). Also bound to Ctrl/⌘ K. Without it the trigger links to /search. */
  onSearch?: () => void
  /** Signed-in user, or null for the 登录 button. */
  user?: HeaderUser | null
  /** Replace the default user slot entirely. */
  userSlot?: ReactNode
}

/** Bump the badge when the count goes up (CSS: .bottle-btn.is-bump). */
function useBump(count: number) {
  const prev = useRef(count)
  const [bump, setBump] = useState(0)
  useEffect(() => {
    if (count > prev.current) setBump((b) => b + 1)
    prev.current = count
  }, [count])
  return bump
}

export function Header({ siteName, subtitle, trayCount = 0, onTrayClick, onSearch, user, userSlot }: HeaderProps) {
  const bump = useBump(trayCount)
  const navKey = useRouterState({ select: (s) => navKeyFor(s.location.pathname) })

  useEffect(() => {
    if (!onSearch) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSearch])

  const trayLabel = `打包清单，已选 ${trayCount} 张`
  const trayInner = (
    <>
      <Icon name="box" />
      <span className="label">打包</span>
      <span className="count num">{trayCount}</span>
    </>
  )
  const searchInner = (
    <>
      <Icon name="search" />
      <span>搜索表情包、角色、画师</span>
      <span className="kbd">Ctrl K</span>
    </>
  )

  return (
    <header className="head">
      <div className="wrap">
        <AppLink to="/" className="logo" aria-label={`${siteName}首页`}>
          <LogoMark />
          <LogoWord name={siteName} subtitle={subtitle} />
        </AppLink>
        <nav className="nav" aria-label="主导航">
          {MAIN_NAV.map((n) => (
            <AppLink key={n.to} to={n.to} aria-current={navKey === n.to ? 'page' : undefined}>
              {n.label}
            </AppLink>
          ))}
        </nav>
        {onSearch ? (
          <button type="button" className="head-search" onClick={onSearch} aria-label="搜索">
            {searchInner}
          </button>
        ) : (
          <AppLink to="/search" className="head-search" aria-label="搜索">
            {searchInner}
          </AppLink>
        )}
        <div className="head-actions">
          {onSearch ? (
            <IconButton icon="search" label="搜索" className="m-search" onClick={onSearch} />
          ) : (
            <AppLink to="/search" className="icon-btn m-search" aria-label="搜索">
              <Icon name="search" />
            </AppLink>
          )}
          <ThemeToggle />
          {onTrayClick ? (
            <button key={bump} type="button" className={cx('bottle-btn', bump > 0 && 'is-bump')} onClick={onTrayClick} aria-label={trayLabel} data-tray-target="">
              {trayInner}
            </button>
          ) : (
            <AppLink key={bump} to="/batch" className={cx('bottle-btn', bump > 0 && 'is-bump')} aria-label={trayLabel} data-tray-target="">
              {trayInner}
            </AppLink>
          )}
          {userSlot ?? <UserSlot user={user ?? null} />}
        </div>
      </div>
    </header>
  )
}

/** 白昼 / 夜潮 switch. Both icons are in the HTML; CSS shows the one for the theme in effect, so the
 * server render (which cannot know the theme) never mismatches. */
function ThemeToggle() {
  const night = useSyncExternalStore(subscribeTheme, isNight, () => false)
  return (
    <button type="button" className="icon-btn theme-btn" onClick={() => setPref(night ? 'light' : 'night')} aria-label="夜潮主题" aria-pressed={night} title={night ? '切换到白昼' : '切换到夜潮'}>
      <Icon name="moon" className="i-moon" />
      <Icon name="sun" className="i-sun" />
    </button>
  )
}

/** 退出登录, the same way as 设置 does it (the auth client loads on first use). */
function useSignOut() {
  const router = useRouter()
  const navigate = useNavigate()
  return async () => {
    try {
      const { authClient } = await import('../account/auth-client')
      const res = await authClient().signOut()
      if (res.error) throw new Error(res.error.message)
      toast('已退出登录')
      await router.invalidate()
      await navigate({ to: '/login' })
    } catch {
      toast({ message: '退出登录失败，请稍后再试', icon: 'warn' })
    }
  }
}

/** The account menu's entries; 管理台 only for staff (站长, 管理员). */
function accountEntries(staff: boolean, signOut: () => void): MenuEntry[] {
  return [
    { kind: 'link', label: '个人中心', icon: 'user', to: '/me' },
    { kind: 'link', label: '我的投稿', icon: 'upload', to: '/me/submissions' },
    { kind: 'link', label: '通知', icon: 'bell', to: '/me/notifications' },
    { kind: 'link', label: '设置', icon: 'sliders', to: '/me/settings' },
    { kind: 'separator' },
    ...(staff ? [{ kind: 'link', label: '管理台', icon: 'gauge', to: '/admin' } as const] : []),
    { label: '退出登录', icon: 'logout', onSelect: signOut },
  ]
}

/** Phones: the account menu as a bottom sheet. */
function AccountSheetList({ entries, onDone }: { entries: readonly MenuEntry[]; onDone: () => void }) {
  return (
    <nav className="menu-list" aria-label="账号">
      {entries.map((it, i) => {
        if (it.kind === 'separator') return <hr key={i} className="menu-sep" />
        const inner = (
          <>
            {it.icon ? <Icon name={it.icon} /> : null}
            {it.label}
          </>
        )
        if (it.kind === 'link') {
          return (
            <AppLink key={i} to={it.to} className="menu-it" onClick={onDone}>
              {inner}
            </AppLink>
          )
        }
        return (
          <button
            key={i}
            type="button"
            className={cx('menu-it', it.danger && 'danger')}
            disabled={it.disabled}
            onClick={() => {
              onDone()
              it.onSelect()
            }}
          >
            {inner}
          </button>
        )
      })}
    </nav>
  )
}

function UserSlot({ user }: { user: HeaderUser | null }) {
  // The role comes from the root config's viewer, the one useViewerRefresh re-checks after hydration
  // (an edge-cached page is anonymous HTML), never from the server HTML: the menu and the sheet
  // render only when opened, after hydration.
  const viewer = useOptionalSiteConfig()?.viewer ?? null
  const phone = useMediaQuery(PHONE_QUERY)
  const [sheet, setSheet] = useState(false)
  const signOut = useSignOut()
  if (!user) {
    return (
      <AppLink to="/login" className="btn sm user-slot">
        <Icon name="user" size="sm" />
        登录
      </AppLink>
    )
  }
  const role = viewer?.role ?? null
  const entries = accountEntries(isStaff(role), () => void signOut())
  const roleName = role ? ROLES[role].name : ''
  const face = user.avatarUrl ? <img src={user.avatarUrl} alt="" width={40} height={40} /> : <span aria-hidden="true">{[...user.name][0] ?? '?'}</span>
  const label = `账号菜单（${user.name}）`
  if (phone) {
    return (
      <>
        <button type="button" className="avatar user-slot" aria-label={label} aria-haspopup="dialog" aria-expanded={sheet} onClick={() => setSheet(true)}>
          {face}
        </button>
        <Sheet open={sheet} onOpenChange={setSheet} title={user.name} subtitle={roleName || undefined} className="account-sheet">
          <AccountSheetList entries={entries} onDone={() => setSheet(false)} />
        </Sheet>
      </>
    )
  }
  return (
    <Menu
      trigger={
        <button type="button" className="avatar user-slot" aria-label={label}>
          {face}
        </button>
      }
      header={
        <>
          <b>{user.name}</b>
          {roleName ? <small>{roleName}</small> : null}
        </>
      }
      items={entries}
    />
  )
}

/** Floating 打包 button on phones (shown only when the tray has items). */
export function TrayFab({ count, onClick }: { count: number; onClick?: () => void }) {
  const cls = cx('fab-bottle', count > 0 && 'is-on')
  const inner = (
    <>
      <Icon name="box" size="lg" />
      <span className="count">{count}</span>
    </>
  )
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} aria-label={`打包清单，已选 ${count} 张`}>
      {inner}
    </button>
  ) : (
    <AppLink to="/batch" className={cls} aria-label={`打包清单，已选 ${count} 张`}>
      {inner}
    </AppLink>
  )
}
