import { createFileRoute } from '@tanstack/react-router'
import { artistsFn } from '#/server/catalog/fns'
import { ArtistsPage } from '#/ui/pages/ArtistsPages'
import { pageHead } from '#/ui/pages/seo'
import { CATALOG_STALE_MS } from '#/ui/pages/catalog-stale'

export const Route = createFileRoute('/_site/artists/')({
  loader: () => artistsFn(),
  staleTime: CATALOG_STALE_MS,
  head: ({ matches, loaderData }) =>
    pageHead(matches, {
      title: '画师名录',
      description: `${loaderData?.length ?? ''} 位鸣潮表情包画师与约稿人，每个表情包都署名并链接到画师主页。`,
      path: '/artists',
    }),
  component: () => <ArtistsPage list={Route.useLoaderData()} />,
})
