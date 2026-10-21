import { createFileRoute } from '@tanstack/react-router'
import { loadAuthArt } from '#/ui/account/art'
import accountCss from '#/ui/account/account.css?url'
import { privateHead } from '#/ui/account/head'
import { ResetPasswordPage } from '#/ui/account/AuthPages'
import { CATALOG_STALE_MS } from '#/ui/pages/catalog-stale'

// Better Auth redirects here from the mail link with ?token=… (or ?error=INVALID_TOKEN).
export const Route = createFileRoute('/_site/reset-password')({
  validateSearch: (s: Record<string, unknown>): { token?: string; error?: string } => ({
    ...(typeof s.token === 'string' ? { token: s.token } : {}),
    ...(typeof s.error === 'string' ? { error: s.error } : {}),
  }),
  // the art panel's stickers (from the cached home data; none if it is unavailable)
  loader: async () => ({ art: await loadAuthArt() }),
  staleTime: CATALOG_STALE_MS,
  head: ({ matches }) => privateHead(matches, '重置密码', [accountCss]),
  component: function Reset() {
    const { token, error } = Route.useSearch()
    const { art } = Route.useLoaderData()
    return <ResetPasswordPage token={token} error={error} art={art} />
  },
})
