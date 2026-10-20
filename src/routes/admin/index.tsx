import { createFileRoute } from '@tanstack/react-router'
import { adminDashboardFn } from '#/server/admin/fns/content'
import { guarded } from '#/ui/admin-pages/bits'
import { DashboardPage } from '#/ui/admin-pages/DashboardPage'
import { pageCss } from '#/ui/admin-pages/css'

export const Route = createFileRoute('/admin/')({
  head: pageCss,
  loader: () => guarded(() => adminDashboardFn()),
  component: () => {
    const data = Route.useLoaderData()
    return data ? <DashboardPage data={data} /> : null
  },
})
