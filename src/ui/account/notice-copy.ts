import type { NotificationItem } from '#/server/account/notifications'
import type { IconName } from '../Icon'

// Copy of each notice kind (src/server/account/notifications.ts NoticePayloads) for the 通知 tab.

export interface NoticeCopy {
  icon: IconName
  title: string
  detail?: string
  to?: string
  action?: string
}

/** Line, detail and link of a notice; kinds without copy get a generic 新通知. */
export function noticeCopy(n: Pick<NotificationItem, 'kind' | 'payload'>): NoticeCopy {
  const p = n.payload
  switch (n.kind) {
    case 'submission.approved':
      return {
        icon: 'check',
        title: `你的投稿「${p.title ?? ''}」${p.auto ? '已发布' : '已通过审核并发布'}`,
        to: p.slug ? `/packs/${p.slug}` : undefined,
        action: '查看',
      }
    case 'submission.returned':
      return {
        icon: 'reply',
        title: `你的投稿「${p.title ?? ''}」被退回修改`,
        detail: p.reason ? `原因：${p.reason}` : undefined,
        to: p.submissionId ? `/me/submissions/${p.submissionId}` : undefined,
        action: '去修改',
      }
    case 'comment.reply':
      return {
        icon: 'chat',
        title: `${p.by || '有人'} 回复了你`,
        detail: p.excerpt || undefined,
        to: p.href ?? undefined,
        action: '查看',
      }
    default:
      return { icon: 'bell', title: '新通知' }
  }
}
