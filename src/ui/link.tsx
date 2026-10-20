import { Link } from '@tanstack/react-router'
import type { AnchorHTMLAttributes, Ref } from 'react'

export interface AppLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** An app path such as "/packs" or "/packs/aimisi-01" (resolved by the router at runtime). */
  to: string
  /** Match the path exactly for aria-current (defaults to true for "/"). */
  exact?: boolean
  ref?: Ref<HTMLAnchorElement>
}

/**
 * Internal link for UI components that receive paths as data (nav tables, cards). Client-side
 * navigation + intent preloading, and aria-current="page" when active. Route code with literal targets
 * should use the typed <Link> directly.
 */
export function AppLink({ to, exact, ...rest }: AppLinkProps) {
  return <Link to={to as '/'} activeOptions={{ exact: exact ?? to === '/', includeSearch: false }} {...rest} />
}
