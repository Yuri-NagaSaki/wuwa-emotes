import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { artistDetailFn } from '#/server/catalog/fns'
import { ArtistPage } from '#/ui/pages/ArtistsPages'
import { pageHead } from '#/ui/pages/seo'
import { CATALOG_STALE_MS } from '#/ui/pages/catalog-stale'

export const Route = createFileRoute('/_site/artists/$slug')({
  loader: async ({ params }) => {
    const r = await artistDetailFn({ data: { slug: params.slug } })
    if (r.kind === 'redirect') throw redirect({ href: r.redirectTo, statusCode: 301, headers: { 'cache-control': 'public, max-age=86400' } })
    if (r.kind === 'missing') throw notFound()
    return r
  },
  staleTime: CATALOG_STALE_MS,
  head: ({ matches, loaderData: d }) =>
    d
      ? pageHead(matches, {
          title: `画师 ${d.artist.name}`,
          description: `${d.artist.name}的 ${d.artist.packCount} 个鸣潮表情包、${d.artist.emojiCount} 张表情。`,
          path: `/artists/${encodeURIComponent(d.artist.slug)}`,
          image: d.page.items[0]?.cover?.poster,
        })
      : {},
  component: () => <ArtistPage detail={Route.useLoaderData()} />,
})
