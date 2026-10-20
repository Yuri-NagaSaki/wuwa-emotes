import { createFileRoute } from '@tanstack/react-router'
import { exploreFn } from '#/server/catalog/fns'
import { ExplorePage } from '#/ui/pages/ExplorePage'
import { emojiParam } from '#/ui/pages/search-params'
import { pageHead } from '#/ui/pages/seo'

export const Route = createFileRoute('/_site/explore')({
  validateSearch: emojiParam,
  loader: () => exploreFn(),
  head: ({ matches, loaderData }) =>
    pageHead(matches, {
      title: '探索',
      description: '随机抽一个鸣潮表情包，看看今日推荐，或者按角色、画师、分组与企划浏览全部表情包。',
      path: '/explore',
      image: loaderData?.randomPack?.cover?.poster,
    }),
  component: ExploreRoute,
})

function ExploreRoute() {
  const data = Route.useLoaderData()
  const { e } = Route.useSearch()
  return <ExplorePage data={data} current={e} />
}
