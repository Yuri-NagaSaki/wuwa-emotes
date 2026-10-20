import { createFileRoute } from '@tanstack/react-router'
import { adminSettingsFn } from '#/server/admin/fns/system'
import { guarded } from '#/ui/admin-pages/bits'
import { pageCss } from '#/ui/admin-pages/css'
import { SettingsPage } from '#/ui/admin-pages/SystemPages'

export const Route = createFileRoute('/admin/settings')({
  head: pageCss,
  loader: () => guarded(() => adminSettingsFn()),
  component: () => {
    const data = Route.useLoaderData()
    return data ? <SettingsPage key={data.updatedAt ?? ''} data={data} /> : null
  },
})
