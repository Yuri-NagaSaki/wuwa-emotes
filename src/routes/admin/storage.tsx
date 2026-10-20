import { createFileRoute } from '@tanstack/react-router'
import { adminStorageFn } from '#/server/admin/fns/system'
import { guarded } from '#/ui/admin-pages/bits'
import { pageCss } from '#/ui/admin-pages/css'
import { StoragePage } from '#/ui/admin-pages/SystemPages'

export const Route = createFileRoute('/admin/storage')({
  head: pageCss,
  loader: () => guarded(() => adminStorageFn()),
  component: () => {
    const data = Route.useLoaderData()
    return data ? <StoragePage data={data} /> : null
  },
})
