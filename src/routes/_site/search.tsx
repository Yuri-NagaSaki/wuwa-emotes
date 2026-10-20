import { createFileRoute } from '@tanstack/react-router'
import { searchFn } from '#/server/catalog/fns'
import { SearchPage } from '#/ui/pages/SearchPage'
import { pageHead } from '#/ui/pages/seo'

export const Route = createFileRoute('/_site/search')({
  validateSearch: (s: Record<string, unknown>): { q?: string } => {
    const q = typeof s.q === 'string' || typeof s.q === 'number' ? String(s.q).slice(0, 200) : ''
    return q.trim() ? { q } : {}
  },
  loaderDeps: ({ search }) => ({ q: search.q ?? '' }),
  loader: ({ deps }) => (deps.q.trim() ? searchFn({ data: { q: deps.q, limit: 24 } }) : null),
  head: ({ matches, loaderData }) =>
    pageHead(matches, {
      title: loaderData?.q ? `搜索「${loaderData.q}」` : '搜索',
      description: '搜索鸣潮表情包、角色、画师与标签。',
      path: '/search',
      // result pages are endless and thin: keep them out of the index
      noindex: true,
    }),
  component: SearchRoute,
})

function SearchRoute() {
  const result = Route.useLoaderData()
  const { q } = Route.useSearch()
  return <SearchPage result={result} q={q ?? ''} />
}
