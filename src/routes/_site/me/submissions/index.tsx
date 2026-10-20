import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { listMySubmissionsFn } from '#/server/submissions/fn'
import { SubmissionsPanel } from '#/ui/account/SubmissionsPanel'
import { errorStatus } from '#/ui/account/text'

const me = getRouteApi('/_site/me')

// 个人中心 › 我的投稿 (?new=<id> highlights the submission just sent).
export const Route = createFileRoute('/_site/me/submissions/')({
  validateSearch: (s: Record<string, unknown>): { new?: string } => (typeof s.new === 'string' ? { new: s.new } : {}),
  loader: async () => {
    try {
      return { items: await listMySubmissionsFn() }
    } catch (err) {
      if (errorStatus(err) === 401) return { items: [] }
      throw err
    }
  },
  component: function MySubmissions() {
    const { items } = Route.useLoaderData()
    const search = Route.useSearch()
    const { summary } = me.useLoaderData()
    return <SubmissionsPanel items={items} highlight={search.new} blocked={summary.submitMode === 'blocked'} />
  },
})
