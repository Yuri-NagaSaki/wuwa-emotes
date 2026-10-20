import { createIsomorphicFn } from '@tanstack/react-start'
import { env } from '#/server/env'
import type { PublicConfig } from '#/server/ui/public-config'

// Per-page <title>, description, canonical and Open Graph tags. og:image and canonical must be
// absolute: the server uses SITE_URL, the browser (client-side navigation) its own origin, which is
// the same site in production. createIsomorphicFn keeps env() out of the client bundle.

export const siteOrigin = createIsomorphicFn()
  .server(() => new URL(env().SITE_URL).origin)
  .client(() => window.location.origin)

export interface PageMeta {
  /** Page title without the site name; omit for the home page. */
  title?: string
  description?: string | null
  /** Path of the canonical URL, e.g. /packs/aimisi-01 */
  path: string
  /** Same-site image path (p240 poster) or absolute URL. */
  image?: string | null
  type?: 'website' | 'article'
  noindex?: boolean
}

type HeadMatch = { loaderData?: unknown }

/** Site name from the root loader (always the first match). */
export function siteNameOf(matches: readonly HeadMatch[]): string {
  const cfg = matches[0]?.loaderData as PublicConfig | undefined
  return cfg?.site.name ?? '潮池'
}

function clip(s: string, n = 120): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return Array.from(flat).length > n ? Array.from(flat).slice(0, n - 1).join('') + '…' : flat
}

export function pageHead(matches: readonly HeadMatch[], m: PageMeta) {
  const site = siteNameOf(matches)
  const origin = siteOrigin()
  const title = m.title ? `${m.title} · ${site}` : site
  const url = origin + m.path
  const image = m.image ? (/^https?:\/\//.test(m.image) ? m.image : origin + m.image) : null
  const description = m.description ? clip(m.description) : null
  return {
    meta: [
      { title },
      ...(description ? [{ name: 'description', content: description }, { property: 'og:description', content: description }] : []),
      { property: 'og:title', content: m.title ?? site },
      { property: 'og:site_name', content: site },
      { property: 'og:type', content: m.type ?? 'website' },
      { property: 'og:url', content: url },
      { property: 'og:locale', content: 'zh_CN' },
      ...(image ? [{ property: 'og:image', content: image }, { name: 'twitter:card', content: 'summary' }] : []),
      ...(m.noindex ? [{ name: 'robots', content: 'noindex' }] : []),
    ],
    links: [{ rel: 'canonical', href: url }],
  }
}
