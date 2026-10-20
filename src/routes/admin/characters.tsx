import { createFileRoute } from '@tanstack/react-router'
import { adminCharactersFn } from '#/server/admin/fns/taxonomy'
import { guarded } from '#/ui/admin-pages/bits'
import { pageCss } from '#/ui/admin-pages/css'
import { CharactersPage } from '#/ui/admin-pages/TaxonomyPages'

export const Route = createFileRoute('/admin/characters')({
  head: pageCss,
  loader: () => guarded(() => adminCharactersFn({ data: {} })),
  component: () => {
    const rows = Route.useLoaderData()
    return rows ? <CharactersPage rows={rows} /> : null
  },
})
