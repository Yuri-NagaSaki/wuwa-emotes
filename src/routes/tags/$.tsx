import { createFileRoute, notFound } from '@tanstack/react-router'
import { legacyRedirect } from '#/server/catalog/legacy-route'
import { resolveLegacyPath } from '#/server/catalog/legacy'
import { legacyHead } from '#/ui/pages/legacy-head'
import { LegacyNotFound } from '#/ui/pages/legacy-page'

// Source-site tag addresses: /tags/character-<slug|hash> → /characters/<slug>, artist tags →
// /artists/<slug>, other tags → /packs?group= or ?tag=dim:slug (301, cached a day). Unknown → 404.
export const Route = createFileRoute('/tags/$')({
  server: {
    handlers: {
      GET: async ({ request, next }) => (await legacyRedirect(request, resolveLegacyPath)) ?? next(),
      HEAD: async ({ request, next }) => (await legacyRedirect(request, resolveLegacyPath)) ?? next(),
    },
  },
  beforeLoad: () => {
    throw notFound()
  },
  head: legacyHead,
  component: () => null,
  notFoundComponent: LegacyNotFound,
})
