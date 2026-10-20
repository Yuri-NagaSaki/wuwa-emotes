import { createFileRoute } from '@tanstack/react-router'
import { adminEmojisFn, adminPackEditorFn } from '#/server/admin/fns/content'
import { guarded } from '#/ui/admin-pages/bits'
import { pageCss } from '#/ui/admin-pages/css'
import { int, oneOf, searchParser, text } from '#/ui/admin/search'
import { EmojisPage } from '#/ui/admin-pages/EmojisPage'

const search = searchParser({
  q: text(100),
  packId: int(1),
  status: oneOf(['pending', 'published', 'hidden']),
  format: oneOf(['gif', 'png', 'webp', 'jpeg']),
  derived: oneOf(['ready', 'missing']),
  page: int(1, 10_000),
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
