import { createFileRoute } from '@tanstack/react-router'
import accountCss from '#/ui/account/account.css?url'
import { privateHead } from '#/ui/account/head'
import { ResetPasswordPage } from '#/ui/account/AuthPages'

// Better Auth redirects here from the mail link with ?token=… (or ?error=INVALID_TOKEN).
export const Route = createFileRoute('/_site/reset-password')({
  validateSearch: (s: Record<string, unknown>): { token?: string; error?: string } => ({
    ...(typeof s.token === 'string' ? { token: s.token } : {}),
    ...(typeof s.error === 'string' ? { error: s.error } : {}),
  }),
  head: ({ matches }) => privateHead(matches, '重置密码', [accountCss]),
  component: function Reset() {
    const { token, error } = Route.useSearch()
    return <ResetPasswordPage token={token} error={error} />
  },
})
