import { createFileRoute } from '@tanstack/react-router'
import { adminTagsFn } from '#/server/admin/fns/taxonomy'
import { guarded } from '#/ui/admin-pages/bits'
import { pageCss } from '#/ui/admin-pages/css'
import { TagsPage } from '#/ui/admin-pages/TaxonomyPages'

// 标签 lives at /admin/taxonomy (the sidebar's path, src/ui/admin/nav.ts); /admin/tags redirects here.
export const Route = createFileRoute('/admin/taxonomy')({
  head: pageCss,
  loader: () => guarded(() => adminTagsFn({ data: {} })),
  component: () => {
    const rows = Route.useLoaderData()
    return rows ? <TagsPage rows={rows} /> : null
  },
})
