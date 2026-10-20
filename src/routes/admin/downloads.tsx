import { createFileRoute } from '@tanstack/react-router'
import { getRiskOverview, getRiskSettings, listSuspiciousSources } from '#/server/downloads/admin-fns'
import { guarded } from '#/ui/admin-pages/bits'
import { pageCss } from '#/ui/admin-pages/css'
import { DownloadsPage } from '#/ui/admin-pages/DownloadsPage'

export const Route = createFileRoute('/admin/downloads')({
  head: pageCss,
  loader: () =>
    guarded(async () => {
      const [overview, settings, sources] = await Promise.all([getRiskOverview(), getRiskSettings(), listSuspiciousSources({ data: { limit: 50 } })])
      return { overview, settings, sources }
    }),
  component: () => {
    const data = Route.useLoaderData()
    return data ? <DownloadsPage data={data} /> : null
  },
})
