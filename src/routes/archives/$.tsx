import { createFileRoute, notFound } from '@tanstack/react-router'
import { legacyRedirect } from '#/server/catalog/legacy-route'
import { resolveLegacyPath } from '#/server/catalog/legacy'
import { legacyHead } from '#/ui/pages/legacy-head'
import { LegacyNotFound } from '#/ui/pages/legacy-page'

// Source-site post addresses: /archives/<postName or packKey> → 301 /packs/<slug> (cached a day).
// Unknown addresses fall through to the page router and render the 404 page (status 404).
export const Route = createFileRoute('/archives/$')({
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
