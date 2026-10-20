import { createFileRoute } from '@tanstack/react-router'
import { adminArtistsFn } from '#/server/admin/fns/taxonomy'
import { guarded } from '#/ui/admin-pages/bits'
import { pageCss } from '#/ui/admin-pages/css'
import { ArtistsPage } from '#/ui/admin-pages/TaxonomyPages'

export const Route = createFileRoute('/admin/artists')({
  head: pageCss,
  loader: () => guarded(() => adminArtistsFn({ data: {} })),
  component: () => {
    const rows = Route.useLoaderData()
    return rows ? <ArtistsPage rows={rows} /> : null
  },
})
