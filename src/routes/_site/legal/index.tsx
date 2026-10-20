import { createFileRoute, redirect } from '@tanstack/react-router'

// /legal (the architecture's route table) → the first document.
export const Route = createFileRoute('/_site/legal/')({
  beforeLoad: () => {
    throw redirect({ to: '/legal/$doc', params: { doc: 'privacy' }, statusCode: 301 })
  },
})
