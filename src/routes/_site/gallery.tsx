import { createFileRoute } from '@tanstack/react-router'
import { charactersFn, galleryFn, homeFn } from '#/server/catalog/fns'
import { type GallerySearch, GalleryPage } from '#/ui/pages/GalleryPage'
import { emojiParam } from '#/ui/pages/search-params'
import { pageHead } from '#/ui/pages/seo'

const SEED_RE = /^[0-9a-z]{1,16}$/
const SLUG_MAX = 200

export const Route = createFileRoute('/_site/gallery')({
  validateSearch: (s: Record<string, unknown>): GallerySearch => ({
    ...(s.sort === 'new' ? { sort: 'new' as const } : {}),
    ...(typeof s.character === 'string' && s.character.trim() && s.character.length <= SLUG_MAX ? { character: s.character.trim() } : {}),
    ...(s.type === 'animated' || s.type === 'static' ? { type: s.type } : {}),
    ...(s.sort !== 'new' && typeof s.seed === 'string' && SEED_RE.test(s.seed) ? { seed: s.seed } : {}),
    ...emojiParam(s),
  }),
  loaderDeps: ({ search }) => ({ sort: search.sort, character: search.character, type: search.type, seed: search.seed }),
  loader: async ({ deps }) => {
    const [page, characters, home] = await Promise.all([
      galleryFn({ data: { sort: deps.sort ?? 'random', character: deps.character, type: deps.type, seed: deps.seed, limit: 60 } }),
      charactersFn({ data: { sort: 'count' } }),
      homeFn(),
    ])
    return { page, characters, total: home.stats.emojis }
  },
  head: ({ matches, loaderData }) =>
    pageHead(matches, {
      title: '潮汐画廊',
      description: '所有鸣潮表情一张接一张：随机或最新排列，可按角色和动态/静态筛选。',
      path: '/gallery',
      image: loaderData?.page.items[0]?.poster,
    }),
  component: GalleryRoute,
})

function GalleryRoute() {
  const { page, characters, total } = Route.useLoaderData()
  const search = Route.useSearch()
  return <GalleryPage page={page} characters={characters} search={search} total={total} />
}
