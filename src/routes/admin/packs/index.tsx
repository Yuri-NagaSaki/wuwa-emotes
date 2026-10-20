import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { adminPacksFn } from '#/server/admin/fns/content'
import { guarded } from '#/ui/admin-pages/bits'
import { pageCss } from '#/ui/admin-pages/css'
import { PacksPage } from '#/ui/admin-pages/PacksPage'

const search = z.object({
  q: z.string().max(100).optional().catch(undefined),
  status: z.enum(['draft', 'published', 'hidden']).optional().catch(undefined),
  kind: z.enum(['animated', 'static', 'mixed']).optional().catch(undefined),
  source: z.enum(['community', 'official']).optional().catch(undefined),
  sort: z.enum(['updated', 'created', 'title', 'downloads']).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
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
