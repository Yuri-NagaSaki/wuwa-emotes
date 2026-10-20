import { createFileRoute } from '@tanstack/react-router'
import { adminAuditFn } from '#/server/admin/fns/system'
import { guarded } from '#/ui/admin-pages/bits'
import { pageCss } from '#/ui/admin-pages/css'
import { day, int, searchParser, text } from '#/ui/admin/search'
import { AuditPage } from '#/ui/admin-pages/SystemPages'

const search = searchParser({
  actor: text(100),
  action: text(60),
  targetType: text(40),
  targetId: text(100),
  from: day,
  to: day,
  page: int(1, 10_000),
})

export const Route = createFileRoute('/admin/audit')({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  head: pageCss,
  loader: ({ deps }) => guarded(() => adminAuditFn({ data: deps })),
  component: () => {
    const data = Route.useLoaderData()
    const s = Route.useSearch()
    return data ? <AuditPage data={data} search={s} actions={data.actions} /> : null
  },
})
