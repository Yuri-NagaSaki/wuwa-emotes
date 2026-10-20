import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { adminEmojisFn, adminPackEditorFn } from '#/server/admin/fns/content'
import { guarded } from '#/ui/admin-pages/bits'
import { pageCss } from '#/ui/admin-pages/css'
import { EmojisPage } from '#/ui/admin-pages/EmojisPage'

const search = z.object({
  q: z.string().max(100).optional().catch(undefined),
  packId: z.coerce.number().int().positive().optional().catch(undefined),
  status: z.enum(['pending', 'published', 'hidden']).optional().catch(undefined),
  format: z.enum(['gif', 'png', 'webp', 'jpeg']).optional().catch(undefined),
  derived: z.enum(['ready', 'missing']).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
})

export const Route = createFileRoute('/admin/emojis')({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  head: pageCss,
  loader: ({ deps }) =>
    guarded(async () => {
      const list = await adminEmojisFn({ data: deps })
      const packTitle = deps.packId ? ((await adminPackEditorFn({ data: { id: deps.packId } }).catch(() => null))?.pack.title ?? null) : null
      return { list, packTitle }
    }),
  component: () => {
    const data = Route.useLoaderData()
    const s = Route.useSearch()
    return data ? <EmojisPage data={data.list} search={s} packTitle={data.packTitle} /> : null
  },
})
