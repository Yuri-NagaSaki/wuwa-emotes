import { createFileRoute } from '@tanstack/react-router'
import { LinksPage } from '#/ui/pages/DocPages'
import { pageHead } from '#/ui/pages/seo'

export const Route = createFileRoute('/_site/links')({
  head: ({ matches }) => pageHead(matches, { title: '友情链接', description: '鸣潮相关的资料站、工具与同好站点。', path: '/links' }),
  component: LinksPage,
})
