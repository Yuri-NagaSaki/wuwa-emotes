import { createFileRoute } from '@tanstack/react-router'
import accountCss from '#/ui/account/account.css?url'
import { privateHead } from '#/ui/account/head'
import { VerifyEmailPage } from '#/ui/account/AuthPages'

// callbackURL of the verification mail: Better Auth verifies, signs in and redirects here, adding
// ?error=TOKEN_EXPIRED|INVALID_TOKEN|USER_NOT_FOUND|INVALID_USER when it failed.
export const Route = createFileRoute('/_site/verify-email')({
  validateSearch: (s: Record<string, unknown>): { error?: string } => (typeof s.error === 'string' ? { error: s.error } : {}),
  head: ({ matches }) => privateHead(matches, '验证邮箱', [accountCss]),
  component: function Verify() {
    const { error } = Route.useSearch()
    return <VerifyEmailPage error={error} />
  },
})
