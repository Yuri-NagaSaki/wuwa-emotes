import { createFileRoute } from '@tanstack/react-router'
import accountCss from '#/ui/account/account.css?url'
import { privateHead } from '#/ui/account/head'
import { ForgotPasswordPage } from '#/ui/account/AuthPages'

export const Route = createFileRoute('/_site/forgot-password')({
  head: ({ matches }) => privateHead(matches, '找回密码', [accountCss]),
  component: ForgotPasswordPage,
})
