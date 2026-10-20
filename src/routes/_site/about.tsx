import { createFileRoute } from '@tanstack/react-router'
import { homeFn } from '#/server/catalog/fns'
import { AboutPage } from '#/ui/pages/DocPages'
import { pageHead, siteNameOf } from '#/ui/pages/seo'
import { useSiteConfig } from '#/ui/site-config'

export const Route = createFileRoute('/_site/about')({
  loader: async () => ({ stats: await homeFn().then((h) => h.stats, () => null) }),
  head: ({ matches }) =>
    pageHead(matches, {
      title: `关于${siteNameOf(matches)}`,
      description: '本站是什么、内容从哪里来、署名与授权、下载规则与下架申诉。',
      path: '/about',
    }),
  component: AboutRoute,
})

function AboutRoute() {
  const { stats } = Route.useLoaderData()
  const { site } = useSiteConfig()
  return <AboutPage siteName={site.name} stats={stats} />
}
