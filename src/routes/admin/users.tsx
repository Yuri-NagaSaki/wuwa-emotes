import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { adminUsersFn } from '#/server/admin/fns/system'
import { guarded } from '#/ui/admin-pages/bits'
import { pageCss } from '#/ui/admin-pages/css'
import { UsersPage } from '#/ui/admin-pages/UsersPage'

const search = z.object({
  q: z.string().max(100).optional().catch(undefined),
  role: z.enum(['admin', 'manager', 'user']).optional().catch(undefined),
  submitMode: z.enum(['review', 'trusted', 'blocked']).optional().catch(undefined),
  banned: z.boolean().optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
})

export const Route = createFileRoute('/admin/users')({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  head: pageCss,
  loader: ({ deps }) => guarded(() => adminUsersFn({ data: deps })),
  component: () => {
    const data = Route.useLoaderData()
    const s = Route.useSearch()
    return data ? <UsersPage data={data} search={s} /> : null
  },
})
