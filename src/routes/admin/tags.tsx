import { createFileRoute, redirect } from '@tanstack/react-router'

// The sidebar links 标签 to /admin/taxonomy; keep /admin/tags working as an alias.
export const Route = createFileRoute('/admin/tags')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/taxonomy', replace: true })
  },
})
