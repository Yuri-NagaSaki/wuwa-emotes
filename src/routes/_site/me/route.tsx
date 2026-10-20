import { createFileRoute, Outlet, redirect, useLocation } from '@tanstack/react-router'
import { getMeSummaryFn } from '#/server/account/fn'
import accountCss from '#/ui/account/account.css?url'
import { privateHead } from '#/ui/account/head'
import { MeShell } from '#/ui/account/MeShell'
import { errorStatus } from '#/ui/account/text'

// 个人中心 layout: signed-in only (anonymous visitors go to /login and come back). The header and tabs
// wrap every tab page; the 投稿 editor (/me/submissions/$id) renders on its own.
export const Route = createFileRoute('/_site/me')({
  loader: async ({ location }) => {
    try {
      return { summary: await getMeSummaryFn() }
    } catch (err) {
      if (errorStatus(err) === 401) throw redirect({ to: '/login', search: { next: location.href } })
      throw err
    }
  },
  head: ({ matches }) => privateHead(matches, '个人中心', [accountCss]),
  component: MeLayout,
})

const EDITOR = /^\/me\/submissions\/[^/]+\/?$/

function MeLayout() {
  const { summary } = Route.useLoaderData()
  const pathname = useLocation({ select: (l) => l.pathname })
  if (EDITOR.test(pathname)) return <Outlet />
  return (
    <MeShell summary={summary}>
      <Outlet />
    </MeShell>
  )
}
