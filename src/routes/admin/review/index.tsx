import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { listReviewQueueFn } from '#/server/submissions/fn'
import type { ReviewQueue, ReviewTab } from '#/server/submissions/service'
import { can } from '#/shared/roles'
import { errorStatus } from '#/ui/account/text'
import { ReviewPage } from '#/ui/review/ReviewPage'
import reviewCss from '#/ui/review/review.css?url'

const admin = getRouteApi('/admin')
const TABS: ReviewTab[] = ['pending', 'approved', 'returned']

// 管理台 › 投稿审核 (perm 'review'). Without the permission the admin shell shows its 403 state; the
// loader then returns nothing instead of failing.
export const Route = createFileRoute('/admin/review/')({
  validateSearch: (s: Record<string, unknown>): { tab?: ReviewTab; page?: number } => {
    const page = Number(s.page)
    return {
      ...(TABS.includes(s.tab as ReviewTab) ? { tab: s.tab as ReviewTab } : {}),
      ...(Number.isInteger(page) && page > 0 ? { page } : {}),
    }
  },
  loaderDeps: ({ search }) => ({ tab: search.tab ?? 'pending', page: search.page ?? 0 }),
  loader: async ({ deps }): Promise<ReviewQueue | null> => {
    try {
      return await listReviewQueueFn({ data: { tab: deps.tab, page: deps.page } })
    } catch (err) {
      const status = errorStatus(err)
      if (status === 401 || status === 403) return null
      throw err
    }
  },
  head: () => ({ links: [{ rel: 'stylesheet', href: reviewCss }] }),
  component: function Review() {
    const data = Route.useLoaderData()
    const { tab } = Route.useLoaderDeps()
    const { viewer } = admin.useLoaderData()
    if (!data || !viewer || !can(viewer.role, 'review')) return null
    return <ReviewPage data={data} tab={tab} role={viewer.role} />
  },
})
