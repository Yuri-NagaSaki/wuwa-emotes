import { createFileRoute } from '@tanstack/react-router'
import { galleryFn, homeFn } from '#/server/catalog/fns'
import { HomePage } from '#/ui/pages/HomePage'
import { pageHead } from '#/ui/pages/seo'
import { emojiParam } from '#/ui/pages/search-params'
import { CATALOG_STALE_MS } from '#/ui/pages/catalog-stale'

export const Route = createFileRoute('/_site/')({
  validateSearch: emojiParam,
  loader: async () => {
    // 潮汐流: 18 random stickers (the prototype's three rows with two 2×2 focus tiles)
    const [home, stream] = await Promise.all([homeFn(), galleryFn({ data: { sort: 'random', limit: 18 } }).then((p) => p.items, () => [])])
    return { home, stream }
  },
  staleTime: CATALOG_STALE_MS,
  head: ({ matches, loaderData }) => {
    const s = loaderData?.home.stats
    return pageHead(matches, {
      description: s
        ? `鸣潮表情包仓库：${s.packs} 个表情包、${s.emojis} 张表情，覆盖 ${s.characters} 位角色。单张复制、跨包打包、整包下载。`
        : '鸣潮表情包仓库：单张复制、跨包打包、整包下载。',
      path: '/',
      image: loaderData?.home.characters[0]?.avatar?.poster,
    })
  },
  component: Home,
})

function Home() {
  const { home, stream } = Route.useLoaderData()
  const { e } = Route.useSearch()
  return <HomePage home={home} stream={stream} current={e} />
}
