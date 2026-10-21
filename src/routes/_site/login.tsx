import { createFileRoute } from '@tanstack/react-router'
import { loadAuthArt } from '#/ui/account/art'
import accountCss from '#/ui/account/account.css?url'
import { privateHead } from '#/ui/account/head'
import { LoginPage } from '#/ui/account/AuthPages'
import { CATALOG_STALE_MS } from '#/ui/pages/catalog-stale'

export const Route = createFileRoute('/_site/login')({
  validateSearch: (s: Record<string, unknown>): { next?: string } => (typeof s.next === 'string' ? { next: s.next } : {}),
  // the art panel's stickers (from the cached home data; none if it is unavailable)
  loader: async () => ({ art: await loadAuthArt() }),
  staleTime: CATALOG_STALE_MS,
  head: ({ matches }) => privateHead(matches, '登录', [accountCss]),
  component: function Login() {
    const { next } = Route.useSearch()
    const { art } = Route.useLoaderData()
    return <LoginPage next={next} art={art} />
  },
})
