import { createFileRoute } from '@tanstack/react-router'
import accountCss from '#/ui/account/account.css?url'
import { privateHead } from '#/ui/account/head'
import { LoginPage } from '#/ui/account/AuthPages'

export const Route = createFileRoute('/_site/login')({
  validateSearch: (s: Record<string, unknown>): { next?: string } => (typeof s.next === 'string' ? { next: s.next } : {}),
  head: ({ matches }) => privateHead(matches, '登录', [accountCss]),
  component: function Login() {
    const { next } = Route.useSearch()
    return <LoginPage next={next} />
  },
})
