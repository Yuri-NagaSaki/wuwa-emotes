import { createFileRoute } from '@tanstack/react-router'
import { adminJobsFn } from '#/server/admin/fns/system'
import { guarded } from '#/ui/admin-pages/bits'
import { pageCss } from '#/ui/admin-pages/css'
import { JobsPage } from '#/ui/admin-pages/SystemPages'

export const Route = createFileRoute('/admin/jobs')({
  head: pageCss,
  loader: () => guarded(() => adminJobsFn()),
  component: () => {
    const data = Route.useLoaderData()
    return data ? <JobsPage data={data} /> : null
  },
})
