import { createServerFn } from '@tanstack/react-start'
import type { Role } from '#/shared/roles'
import { env } from '../env'
import { log } from '../log'
import { publicFn, requireUser } from '../perm/fn'
import { getSetting, siteIdentity } from '../settings'

// Public site chrome: name, announcement, Cap endpoint and who is signed in. Loaded once by the root
// route and cached on the client (see src/routes/__root.tsx), so keep it small and never include email.

export interface ViewerSummary {
  id: string
  name: string
  role: Role
  /** a 站长 is browsing as this user (模拟登录) */
  impersonated: boolean
}

export interface PublicConfig {
  site: { name: string; subtitle: string }
  announcement: string | null
  cap: { endpoint: string }
  viewer: ViewerSummary | null
}

async function readSite(): Promise<{ site: PublicConfig['site']; announcement: string | null }> {
  try {
    const [site, raw] = await Promise.all([siteIdentity(), getSetting('site')])
    return { site, announcement: raw.announcement?.trim() || null }
  } catch (err) {
    // The settings table is an override; if it can't be read the env defaults still name the site.
    log().warn({ err: (err as Error).message }, 'ui: site settings unavailable, using env defaults')
    return { site: { name: env().SITE_NAME, subtitle: env().SITE_SUBTITLE }, announcement: null }
  }
}

export const getPublicConfig = createServerFn({ method: 'GET' })
  .middleware([publicFn])
  .handler(async ({ context }): Promise<PublicConfig> => {
    const { site, announcement } = await readSite()
    const v = context.viewer
    return {
      site,
      announcement,
      cap: { endpoint: env().CAP_API_ENDPOINT },
      viewer: v ? { id: v.id, name: v.name, role: v.role, impersonated: Boolean(v.impersonatedBy) } : null,
    }
  })

/** The signed-in viewer for the admin layout. Anonymous callers get 401 from requireUser. */
export const getAdminViewer = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(async ({ context }): Promise<ViewerSummary> => {
    const v = context.viewer
    return { id: v.id, name: v.name, role: v.role, impersonated: Boolean(v.impersonatedBy) }
  })
