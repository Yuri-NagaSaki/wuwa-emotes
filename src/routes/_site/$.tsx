import { createFileRoute, notFound } from '@tanstack/react-router'

// Any address no other route matches: the 404 page inside the site chrome (the _site layout's
// notFoundComponent), answered with status 404.
export const Route = createFileRoute('/_site/$')({
  beforeLoad: () => {
    throw notFound()
  },
  head: () => ({ meta: [{ title: '页面不存在' }, { name: 'robots', content: 'noindex' }] }),
  component: () => null,
})
