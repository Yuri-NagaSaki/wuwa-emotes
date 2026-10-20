import { createFileRoute, notFound } from '@tanstack/react-router'

// Any /admin/* address no admin route matches. Without this splat the site-wide catch-all (/_site/$)
// would answer it with the public 404 in the site chrome; thrown from the loader, the not-found renders
// the admin layout's notFoundComponent (the admin shell with its 404), answered with status 404. The
// layout's loader runs alongside, so the shell still knows the viewer (sign-in and 403 states).
export const Route = createFileRoute('/admin/$')({
  loader: () => {
    throw notFound()
  },
  head: () => ({ meta: [{ title: '页面不存在' }, { name: 'robots', content: 'noindex' }] }),
  component: () => null,
})
