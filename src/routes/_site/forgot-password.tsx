import { createFileRoute } from '@tanstack/react-router'
import { loadAuthArt } from '#/ui/account/art'
import accountCss from '#/ui/account/account.css?url'
import { privateHead } from '#/ui/account/head'
import { ForgotPasswordPage } from '#/ui/account/AuthPages'
import { CATALOG_STALE_MS } from '#/ui/pages/catalog-stale'

export const Route = createFileRoute('/_site/forgot-password')({
  // the art panel's stickers (from the cached home data; none if it is unavailable)
  loader: async () => ({ art: await loadAuthArt() }),
  staleTime: CATALOG_STALE_MS,
  head: ({ matches }) => privateHead(matches, '找回密码', [accountCss]),
  component: function Forgot() {
    const { art } = Route.useLoaderData()
    return <ForgotPasswordPage art={art} />
  },
})
