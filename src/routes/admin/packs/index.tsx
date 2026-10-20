import { createFileRoute } from '@tanstack/react-router'
import { adminPacksFn } from '#/server/admin/fns/content'
import { guarded } from '#/ui/admin-pages/bits'
import { pageCss } from '#/ui/admin-pages/css'
import { int, oneOf, searchParser, text } from '#/ui/admin/search'
import { PacksPage } from '#/ui/admin-pages/PacksPage'

const search = searchParser({
  q: text(100),
  status: oneOf(['draft', 'published', 'hidden']),
  kind: oneOf(['animated', 'static', 'mixed']),
  source: oneOf(['community', 'official']),
  sort: oneOf(['updated', 'created', 'title', 'downloads']),
  page: int(1, 10_000),
})

export const Route = createFileRoute('/admin/packs/')({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  head: pageCss,
  loader: ({ deps }) => guarded(() => adminPacksFn({ data: deps })),
  component: () => {
    const data = Route.useLoaderData()
    const s = Route.useSearch()
    return data ? <PacksPage data={data} search={s} /> : null
  },
})
