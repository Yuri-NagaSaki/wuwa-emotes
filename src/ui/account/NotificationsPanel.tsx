import { useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { NotificationItem } from '#/server/account/notifications'
import { listNotificationsFn, markNotificationsReadFn } from '#/server/account/fn'
import { Button } from '../Button'
import { cx } from '../cx'
import { EmptyState } from '../EmptyState'
import { Icon } from '../Icon'
import { toast } from '../Toast'
import { noticeCopy } from './notice-copy'
import { ago, errorText } from './text'

// 通知: newest first; opening one marks it read and goes to the pack, the submission or the reply.

export function NotificationsPanel({ items: first, unread, more: firstMore }: { items: NotificationItem[]; unread: number; more: boolean }) {
  const router = useRouter()
  const navigate = useNavigate()
  const [extra, setExtra] = useState<NotificationItem[]>([])
  const [more, setMore] = useState(firstMore)
  const [read, setRead] = useState<Set<number>>(() => new Set())
  const items = [...first, ...extra]

  async function open(n: NotificationItem, to?: string) {
    try {
      if (!n.read && !read.has(n.id)) {
        await markNotificationsReadFn({ data: { ids: [n.id] } })
        setRead((s) => new Set(s).add(n.id))
        await router.invalidate()
      }
      // href, not to: comment links carry a #c-<id> hash
      if (to) await navigate({ href: to })
    } catch (err) {
      toast({ message: errorText(err), icon: 'warn' })
    }
  }

  async function readAll() {
    try {
      await markNotificationsReadFn({ data: {} })
      setRead(new Set(items.map((i) => i.id)))
      await router.invalidate()
    } catch (err) {
      toast({ message: errorText(err), icon: 'warn' })
    }
  }

  async function loadMore() {
    const last = items[items.length - 1]
    if (!last) return
    const r = await listNotificationsFn({ data: { before: last.id } })
    setExtra((x) => [...x, ...r.items])
    setMore(r.more)
  }

  return (
    <>
      <div className="toolbar">
        <b>通知</b>
        <span className="muted">{unread ? `${unread} 条未读` : '没有未读通知'}</span>
        <span className="grow" />
        {unread ? (
          <Button size="sm" icon="check" onClick={readAll}>
            全部标为已读
          </Button>
        ) : null}
      </div>
      {items.length ? (
        <div className="list">
          {items.map((n) => {
            const r = noticeCopy(n)
            const isRead = n.read || read.has(n.id)
            return (
              <div key={n.id} className={cx('li', !isRead && 'is-unread')}>
                <span className="th">
                  <Icon name={r.icon} />
                </span>
                <div>
                  <b className="dyn">{r.title}</b>
                  <small suppressHydrationWarning>
                    {r.detail ? <span className="dyn">{r.detail} · </span> : null}
                    {ago(n.createdAt)}
                  </small>
                </div>
                <span className="r">
                  {!isRead ? <span className="st info">未读</span> : null}
                  {r.to ? (
                    <Button size="xs" onClick={() => open(n, r.to)}>
                      {r.action}
                    </Button>
                  ) : !isRead ? (
                    <Button size="xs" variant="ghost" onClick={() => open(n)}>
                      标为已读
                    </Button>
                  ) : null}
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <EmptyState icon="bell" title="还没有通知">
          投稿审核的结果和评论收到的回复会在这里通知你。
        </EmptyState>
      )}
      {more ? (
        <Button dashed block onClick={loadMore}>
          加载更多
        </Button>
      ) : null}
    </>
  )
}
