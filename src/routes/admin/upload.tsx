import { createFileRoute } from '@tanstack/react-router'
import { adminUploadTargetsFn } from '#/server/admin/fns/content'
import { guarded } from '#/ui/admin-pages/bits'
import { pageCss } from '#/ui/admin-pages/css'
import { int, searchParser } from '#/ui/admin/search'
import { UploadPage } from '#/ui/admin-pages/UploadPage'

const search = searchParser({ pack: int(1) })

export const Route = createFileRoute('/admin/upload')({
  validateSearch: search,
  loaderDeps: ({ search }) => ({ pack: search.pack }),
  head: pageCss,
  loader: ({ deps }) =>
    guarded(async () => {
      const recent = await adminUploadTargetsFn({ data: {} })
      const byId = deps.pack ? (await adminUploadTargetsFn({ data: { q: String(deps.pack) } })).rows.find((r) => r.id === deps.pack) : undefined
      return { recent: recent.rows, target: byId ?? null }
    }),
  component: () => {
    const data = Route.useLoaderData()
    return data ? <UploadPage target={data.target} recent={data.recent} /> : null
  },
})
