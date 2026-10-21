import { useNavigate, useRouter } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { ROLES } from '#/shared/roles'
import { isStaff } from '../admin/nav'
import { cx } from '../cx'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { Menu, type MenuEntry } from '../Menu'
import { Sheet } from '../Sheet'
import { useOptionalSiteConfig } from '../site-config'
import { toast } from '../Toast'
import { PHONE_QUERY, useMediaQuery } from '../useMediaQuery'
import type { HeaderUser } from './Header'

// The signed-in header slot: the avatar and its account menu (a bottom sheet on phones). Header.tsx
// loads this module lazily, only once someone is signed in, so anonymous pages (most visits, and all
// edge-cached HTML) never download Base UI's menu and dialog for it.
//
// The role comes from the root config's viewer, the one useViewerRefresh re-checks after hydration (an
// edge-cached page is anonymous HTML), never from the server HTML; the menu and the sheet only render
// when opened, after hydration.

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

/** The menu's entries; 管理台 only for staff (站长, 管理员). */
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

/** Phones: the same entries as a list in the bottom sheet. */
function SheetList({ entries, onDone }: { entries: readonly MenuEntry[]; onDone: () => void }) {
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

export default function AccountMenu({ user, face }: { user: HeaderUser; face: ReactNode }) {
  const viewer = useOptionalSiteConfig()?.viewer ?? null
  const phone = useMediaQuery(PHONE_QUERY)
  const [sheet, setSheet] = useState(false)
  const signOut = useSignOut()
  const role = viewer?.role ?? null
  const entries = accountEntries(isStaff(role), () => void signOut())
  const roleName = role ? ROLES[role].name : ''
  const label = `账号菜单（${user.name}）`
  if (phone) {
    return (
      <>
        <button type="button" className="avatar user-slot" aria-label={label} aria-haspopup="dialog" aria-expanded={sheet} onClick={() => setSheet(true)}>
          {face}
        </button>
        <Sheet open={sheet} onOpenChange={setSheet} title={user.name} subtitle={roleName || undefined} className="account-sheet">
          <SheetList entries={entries} onDone={() => setSheet(false)} />
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
