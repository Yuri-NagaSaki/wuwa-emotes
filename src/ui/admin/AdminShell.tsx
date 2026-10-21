import { Fragment, useState, type ReactNode } from 'react'
import { ROLES, type Role } from '#/shared/roles'
import { buttonClass, IconButton } from '../Button'
import { EmptyState } from '../EmptyState'
import { Input } from '../Field'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { LogoMark } from '../LogoMark'
import { Sheet } from '../Sheet'
import { activeNavItem, canOpen, isStaff, navForRole, type AdminNavId } from './nav'

export interface AdminViewer {
  name: string
  role: Role
}

export interface AdminShellProps {
  siteName: string
  /** Signed-in viewer, or null when nobody is signed in. */
  viewer: AdminViewer | null
  pathname: string
  /** Breadcrumbs after 管理台; defaults to the active nav label. */
  crumbs?: ReactNode[]
  /** Counters next to nav items (e.g. pending reviews). */
  badges?: Partial<Record<AdminNavId, number>>
  /** Top-bar search; the field is hidden when absent. */
  onSearch?: (q: string) => void
  onSignOut?: () => void
  children: ReactNode
}

function AdminNav({ role, badges, onNavigate }: { role: Role | null; badges?: AdminShellProps['badges']; onNavigate?: () => void }) {
  return (
    <nav className="adm-nav" aria-label="后台导航">
      {navForRole(role).map((g) => (
        <Fragment key={g.title}>
          <h5>{g.title}</h5>
          {g.items.map((it) => (
            <AppLink key={it.id} to={it.to} exact={it.to === '/admin'} onClick={onNavigate}>
              <Icon name={it.icon} />
              {it.label}
              {badges?.[it.id] ? <span className="badge-dot">{badges[it.id]}</span> : null}
            </AppLink>
          ))}
        </Fragment>
      ))}
    </nav>
  )
}

/** Site name + 管理台; links to the public site. */
function Brand({ siteName, onNavigate }: { siteName: string; onNavigate?: () => void }) {
  return (
    <AppLink to="/" className="adm-logo" aria-label={`${siteName}首页`} onClick={onNavigate}>
      <LogoMark />
      <div>
        <b>{siteName}</b>
        <small>管理台</small>
      </div>
    </AppLink>
  )
}

/** Who is signed in, with 个人中心 and 退出登录 (bottom of the sidebar and of the phone drawer). */
function AdminMe({ viewer, onSignOut, onNavigate }: { viewer: AdminViewer; onSignOut?: () => void; onNavigate?: () => void }) {
  return (
    <div className="adm-me">
      <span className="avatar sm" style={{ borderColor: 'var(--c-teal)' }} aria-hidden="true">
        {[...viewer.name][0] ?? '?'}
      </span>
      <div>
        <b>{viewer.name}</b>
        <small>{ROLES[viewer.role].name}</small>
      </div>
      <div className="adm-me-acts">
        <AppLink to="/me" className="ibtn" aria-label="个人中心" title="个人中心" onClick={onNavigate}>
          <Icon name="user" />
        </AppLink>
        {onSignOut ? <IconButton look="plain" icon="logout" label="退出登录" title="退出登录" onClick={onSignOut} /> : null}
      </div>
    </div>
  )
}

/** Admin layout: sidebar filtered by role, sticky top bar, and the 403 / sign-in states. */
export function AdminShell({ siteName, viewer, pathname, crumbs, badges, onSearch, onSignOut, children }: AdminShellProps) {
  const [menu, setMenu] = useState(false)
  const role = viewer?.role ?? null
  const item = activeNavItem(pathname)
  const trail = crumbs ?? (item ? [item.label] : [])

  let body: ReactNode = children
  if (!viewer) {
    body = (
      <EmptyState
        className="adm-deny"
        icon="lock"
        title="请先登录"
        actions={
          <a href={`/login?next=${encodeURIComponent(pathname)}`} className={buttonClass({ variant: 'primary', size: 'sm' })}>
            登录
          </a>
        }
      >
        管理台只对站长和管理员开放。
      </EmptyState>
    )
  } else if (!isStaff(role)) {
    body = (
      <EmptyState className="adm-deny" icon="lock" title={`${ROLES[viewer.role].name}没有管理台的权限`} actions={<AppLink to="/" className={buttonClass({ size: 'sm' })}>回到首页</AppLink>}>
        投稿可以在「投稿表情包」页面提交，审核结果会通知你。
      </EmptyState>
    )
  } else if (!canOpen(role, pathname)) {
    body = (
      <EmptyState
        className="adm-deny"
        icon="lock"
        title={`${ROLES[viewer.role].name}没有「${item?.label ?? '这个页面'}」的权限`}
        actions={
          <AppLink to="/admin" exact className={buttonClass({ size: 'sm' })}>
            回到仪表盘
          </AppLink>
        }
      >
        用户、下载与风控、存储、任务、审计和系统设置只对站长开放。需要调整时请联系站长。
      </EmptyState>
    )
  }

  return (
    <div className="adm">
      <aside className="adm-side">
        <Brand siteName={siteName} />
        <AdminNav role={role} badges={badges} />
        {viewer ? <AdminMe viewer={viewer} onSignOut={onSignOut} /> : null}
      </aside>
      <div className="adm-main">
        <header className="adm-top">
          <IconButton look="plain" icon="menu" label="打开菜单" className="adm-burger" onClick={() => setMenu(true)} />
          <div className="crumbs">
            <span>管理台</span>
            {trail.map((c, i) => (
              <Fragment key={i}>
                <Icon name="right" />
                <span>{c}</span>
              </Fragment>
            ))}
          </div>
          {onSearch ? (
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault()
                const q = new FormData(e.currentTarget).get('q')
                if (typeof q === 'string' && q.trim()) onSearch(q.trim())
              }}
            >
              <Input name="q" icon="search" placeholder="搜索包、表情 ID、用户" aria-label="搜索后台" />
            </form>
          ) : null}
          <AppLink to="/" className={buttonClass({ size: 'sm' }, 'adm-back')}>
            <Icon name="home" />
            返回站点
          </AppLink>
        </header>
        <main className="adm-body">{body}</main>
      </div>
      <Sheet open={menu} onOpenChange={setMenu} title="后台导航" bare className="adm-drawer">
        <Brand siteName={siteName} onNavigate={() => setMenu(false)} />
        <AppLink to="/" className="adm-site" onClick={() => setMenu(false)}>
          <Icon name="home" />
          返回站点
        </AppLink>
        <AdminNav role={role} badges={badges} onNavigate={() => setMenu(false)} />
        {viewer ? <AdminMe viewer={viewer} onSignOut={onSignOut} onNavigate={() => setMenu(false)} /> : null}
      </Sheet>
    </div>
  )
}
