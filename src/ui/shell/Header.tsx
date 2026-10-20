import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconButton } from '../Button'
import { cx } from '../cx'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { LogoMark, LogoWord } from '../LogoMark'
import { MAIN_NAV } from './nav'

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
            <AppLink key={n.to} to={n.to}>
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

function UserSlot({ user }: { user: HeaderUser | null }) {
  if (!user) {
    return (
      <AppLink to="/login" className="btn sm user-slot">
        <Icon name="user" size="sm" />
        登录
      </AppLink>
    )
  }
  return (
    <AppLink to="/me" className="avatar user-slot" aria-label={`个人中心（${user.name}）`}>
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" width={40} height={40} /> : <span aria-hidden="true">{[...user.name][0] ?? '?'}</span>}
    </AppLink>
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
