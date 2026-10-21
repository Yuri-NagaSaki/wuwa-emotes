import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import type { Role } from '#/shared/roles'
import type { Viewer } from '../auth/session'
import { getHome } from '../catalog/home'
import { db, schema } from '../db/client'
import { env } from '../env'
import { log } from '../log'
import { avatarUrl } from '../media/keys'
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
  /** 头像, 256 px (/img/v1/avatar/…); null shows the first letter */
  avatarUrl: string | null
}

export interface PublicConfig {
  site: { name: string; subtitle: string }
  announcement: string | null
  cap: { endpoint: string }
  viewer: ViewerSummary | null
  /** Catalog totals for the footer base line (表情 N 张 · 表情包 N 个); null when the catalog is unavailable. */
  stats: { emojis: number; packs: number } | null
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

/** Totals from the cached home data (30 s), so the chrome adds no query of its own most of the time. */
async function readStats(): Promise<PublicConfig['stats']> {
  try {
    const s = (await getHome()).stats
    return { emojis: s.emojis, packs: s.packs }
  } catch (err) {
    log().warn({ err: (err as Error).message }, 'ui: catalog totals unavailable for the footer')
    return null
  }
}

/** The viewer's 头像 URL (one primary-key read; Viewer itself does not carry users.image). */
async function readAvatar(userId: string): Promise<string | null> {
  try {
    const [u] = await db().select({ image: schema.users.image }).from(schema.users).where(eq(schema.users.id, userId))
    return avatarUrl(userId, u?.image, 256)
  } catch (err) {
    log().warn({ err: (err as Error).message }, 'ui: avatar unavailable for the header')
    return null
  }
}

async function summarize(v: Viewer): Promise<ViewerSummary> {
  return { id: v.id, name: v.name, role: v.role, impersonated: Boolean(v.impersonatedBy), avatarUrl: await readAvatar(v.id) }
}

export const getPublicConfig = createServerFn({ method: 'GET' })
  .middleware([publicFn])
  .handler(async ({ context }): Promise<PublicConfig> => {
    const v = context.viewer
    const [{ site, announcement }, stats, viewer] = await Promise.all([readSite(), readStats(), v ? summarize(v) : null])
    return {
      site,
      announcement,
      cap: { endpoint: env().CAP_API_ENDPOINT },
      viewer,
      stats,
    }
  })

/** The signed-in viewer for the admin layout. Anonymous callers get 401 from requireUser. */
export const getAdminViewer = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(({ context }): Promise<ViewerSummary> => summarize(context.viewer))
