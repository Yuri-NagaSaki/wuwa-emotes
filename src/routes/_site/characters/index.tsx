import { createFileRoute } from '@tanstack/react-router'
import { charactersFn } from '#/server/catalog/fns'
import { type CharacterSort, CharactersPage } from '#/ui/pages/CharactersPage'
import { pageHead } from '#/ui/pages/seo'

export const Route = createFileRoute('/_site/characters/')({
  validateSearch: (s: Record<string, unknown>): { sort?: Exclude<CharacterSort, 'count'> } =>
    s.sort === 'recent' || s.sort === 'pinyin' ? { sort: s.sort } : {},
  loaderDeps: ({ search }) => ({ sort: (search.sort ?? 'count') as CharacterSort }),
  loader: ({ deps }) => charactersFn({ data: { sort: deps.sort } }),
  head: ({ matches, loaderData }) =>
    pageHead(matches, {
      title: '角色图鉴',
      description: `鸣潮 ${loaderData?.length ?? ''} 位角色的表情包，按表情数量、最近更新或拼音浏览。`,
      path: '/characters',
      image: loaderData?.[0]?.avatar?.poster,
    }),
  component: CharactersRoute,
})

function CharactersRoute() {
  const list = Route.useLoaderData()
  const { sort } = Route.useSearch()
  return <CharactersPage list={list} sort={sort ?? 'count'} />
}
