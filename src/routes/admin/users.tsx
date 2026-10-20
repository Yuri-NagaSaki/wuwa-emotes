import { createFileRoute } from '@tanstack/react-router'
import { adminUsersFn } from '#/server/admin/fns/system'
import { guarded } from '#/ui/admin-pages/bits'
import { pageCss } from '#/ui/admin-pages/css'
import { bool, int, oneOf, searchParser, text } from '#/ui/admin/search'
import { UsersPage } from '#/ui/admin-pages/UsersPage'

const search = searchParser({
  q: text(100),
  role: oneOf(['admin', 'manager', 'user']),
  submitMode: oneOf(['review', 'trusted', 'blocked']),
  banned: bool,
  page: int(1, 10_000),
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
