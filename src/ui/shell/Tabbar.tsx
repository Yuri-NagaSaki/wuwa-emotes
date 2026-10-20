import { useRouterState } from '@tanstack/react-router'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { navKeyFor, TAB_NAV } from './nav'

/** Phone bottom navigation (≤760px). Fixed; pages reserve room with `.page` bottom padding. */
export function Tabbar() {
  const navKey = useRouterState({ select: (s) => navKeyFor(s.location.pathname) })
  return (
    <nav className="tabbar" aria-label="底部导航">
      {TAB_NAV.map((t) => (
        <AppLink key={t.to} to={t.to} aria-current={navKey === t.to ? 'page' : undefined}>
          <Icon name={t.icon} />
          {t.label}
        </AppLink>
      ))}
    </nav>
  )
}
