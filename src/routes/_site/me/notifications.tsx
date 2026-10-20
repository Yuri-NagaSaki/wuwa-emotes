import { createFileRoute } from '@tanstack/react-router'
import { listNotificationsFn } from '#/server/account/fn'
import { NotificationsPanel } from '#/ui/account/NotificationsPanel'
import { errorStatus } from '#/ui/account/text'

// 个人中心 › 通知
export const Route = createFileRoute('/_site/me/notifications')({
  loader: async () => {
    try {
      return await listNotificationsFn({ data: {} })
    } catch (err) {
      if (errorStatus(err) === 401) return { items: [], unread: 0, more: false }
      throw err
    }
  },
  component: function Notifications() {
    const data = Route.useLoaderData()
    return <NotificationsPanel items={data.items} unread={data.unread} more={data.more} />
  },
})
