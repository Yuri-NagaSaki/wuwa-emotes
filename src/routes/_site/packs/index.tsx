import { createFileRoute } from '@tanstack/react-router'
import { packsPageFn } from '#/server/catalog/fns'
import { listInputFor, parsePackSearch, validatePackSearch } from '#/ui/pages/filters'
import { PacksPage } from '#/ui/pages/PacksPage'
import { pageHead } from '#/ui/pages/seo'

// 表情包目录. Every filter is a query parameter (character, artist, kind, source, group, tag=dim:slug,
// sort, seed); the loader refetches page 1 + facets when they change, later pages load on scroll.

export const Route = createFileRoute('/_site/packs/')({
  validateSearch: validatePackSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => packsPageFn({ data: listInputFor(parsePackSearch(deps as Record<string, unknown>)) }),
  head: ({ matches, loaderData }) =>
    pageHead(matches, {
      title: '表情包',
      description: `鸣潮表情包目录：${loaderData?.facets.total ?? ''} 个表情包，按角色、画师、类型、来源和分组筛选，单张复制、整包下载。`,
      path: '/packs',
      image: loaderData?.page.items[0]?.cover?.poster,
    }),
  component: PacksRoute,
})

function PacksRoute() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  return <PacksPage data={data} state={parsePackSearch(search as Record<string, unknown>)} />
}
