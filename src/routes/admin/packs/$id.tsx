import { createFileRoute } from '@tanstack/react-router'
import { adminPackEditorFn } from '#/server/admin/fns/content'
import { EmptyState } from '#/ui/EmptyState'
import { guarded } from '#/ui/admin-pages/bits'
import { pageCss } from '#/ui/admin-pages/css'
import { PackEditorPage } from '#/ui/admin-pages/PackEditorPage'

export const Route = createFileRoute('/admin/packs/$id')({
  head: pageCss,
  loader: ({ params }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) return null
    return guarded(() => adminPackEditorFn({ data: { id } }))
  },
  errorComponent: ({ error }) => (
    <EmptyState icon="info" title="打不开这个表情包" className="adm-deny">
      {(error as Error).message}
    </EmptyState>
  ),
  component: () => {
    const data = Route.useLoaderData()
    return data ? <PackEditorPage data={data} /> : null
  },
})
