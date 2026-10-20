import type { MeSummary } from '#/server/account/service'

// Tabs of 个人中心 (/me). This table is the slot API: to add a tab, create its page under
// src/routes/_site/me/ (it renders inside the /me layout) and add an entry here; `order` places it.
// Planned slots, left out because their data does not exist yet:
//   { id: 'downloads', label: '下载记录', to: '/me/downloads', order: 30 }   (no per-user download history)

export interface MeTab {
  id: string
  label: string
  to: string
  order: number
  /** number after the label */
  count?: (s: MeSummary) => number | null
  /** draw the count as a red badge (unread) */
  hot?: boolean
}

export const ME_TABS: readonly MeTab[] = [
  { id: 'favorites', label: '收藏夹', to: '/me', order: 10, count: (s) => s.favorites },
  {
    id: 'submissions',
    label: '我的投稿',
    to: '/me/submissions',
    order: 20,
    count: (s) => s.submissions.approved + s.submissions.pending + s.submissions.returned + s.submissions.draft,
  },
  // 我的评论 (src/routes/_site/me/comments.tsx)
  { id: 'comments', label: '我的评论', to: '/me/comments', order: 40, count: (s) => s.comments },
  { id: 'notifications', label: '通知', to: '/me/notifications', order: 50, count: (s) => s.unread || null, hot: true },
  { id: 'settings', label: '设置', to: '/me/settings', order: 60 },
]

export function sortedTabs(tabs: readonly MeTab[] = ME_TABS): MeTab[] {
  return [...tabs].sort((a, b) => a.order - b.order)
}
