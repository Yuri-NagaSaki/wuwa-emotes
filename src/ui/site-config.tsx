import { createContext, useContext, type ReactNode } from 'react'
import type { PublicConfig } from '#/server/ui/public-config'

// The root loader's public config (site name, announcement, Cap endpoint, viewer), available to any
// component without importing route modules.

const SiteConfigContext = createContext<PublicConfig | null>(null)

export function SiteConfigProvider({ value, children }: { value: PublicConfig; children: ReactNode }) {
  return <SiteConfigContext.Provider value={value}>{children}</SiteConfigContext.Provider>
}

export function useSiteConfig(): PublicConfig {
  const v = useContext(SiteConfigContext)
  if (!v) throw new Error('useSiteConfig() outside <SiteConfigProvider> (src/routes/__root.tsx)')
  return v
}

/** Same, but null outside the provider (for components that also render in isolation). */
export function useOptionalSiteConfig(): PublicConfig | null {
  return useContext(SiteConfigContext)
}
