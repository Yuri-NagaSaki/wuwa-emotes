import { createFileRoute } from '@tanstack/react-router'
import { exploreFn, homeFn } from '#/server/catalog/fns'
import { HomePage } from '#/ui/pages/HomePage'
import { pageHead } from '#/ui/pages/seo'
import { emojiParam } from '#/ui/pages/search-params'

export const Route = createFileRoute('/_site/')({
  validateSearch: emojiParam,
  loader: async () => {
    const [home, explore] = await Promise.all([homeFn(), exploreFn().catch(() => null)])
    return { home, explore }
  },
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
  const { home, explore } = Route.useLoaderData()
  const { e } = Route.useSearch()
  return <HomePage home={home} explore={explore} current={e} />
}
