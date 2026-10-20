import { createFileRoute } from '@tanstack/react-router'
import accountCss from '#/ui/account/account.css?url'
import { privateHead } from '#/ui/account/head'
import { RegisterPage } from '#/ui/account/AuthPages'

export const Route = createFileRoute('/_site/register')({
  validateSearch: (s: Record<string, unknown>): { next?: string } => (typeof s.next === 'string' ? { next: s.next } : {}),
  head: ({ matches }) => privateHead(matches, '注册', [accountCss]),
  component: function Register() {
    const { next } = Route.useSearch()
    return <RegisterPage next={next} />
  },
})
