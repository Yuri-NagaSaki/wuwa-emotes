import { useLocation } from '@tanstack/react-router'
import { useEffect, useRef, type ReactNode } from 'react'
import type { MeSummary } from '#/server/account/service'
import { isStaff } from '../admin/nav'
import { Avatar } from '../Avatar'
import { buttonClass } from '../Button'
import { cx } from '../cx'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { sortedTabs } from './me-tabs'
import { fullDate } from './text'

/** 个人中心 header (avatar, name, 投稿 summary) and the tab row; the tab page goes below. */
export function MeShell({ summary, children }: { summary: MeSummary; children: ReactNode }) {
  const s = summary.submissions
  const tabs = useRef<HTMLElement>(null)
  const pathname = useLocation({ select: (l) => l.pathname })
  useEffect(() => {
    // phones scroll the tab row: keep the current tab in view (only the row scrolls, never the page)
    const nav = tabs.current
    const on = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!nav || !on || nav.scrollWidth <= nav.clientWidth) return
    const left = on.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft
    if (left < nav.scrollLeft || left + on.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = Math.max(0, left - 16)
  }, [pathname])
  return (
    <div className="wrap">
      <div className="me-h">
        <Avatar name={summary.name} src={summary.avatarUrl} loading="eager" />
        <div>
          <h1>{summary.name}</h1>
          <span className="meta">
            {fullDate(summary.joinedAt)} 加入 · 评论 {summary.comments} 条 · 投稿 {s.approved + s.pending + s.returned} 个包
          </span>
        </div>
        <div className="quota">
          <div className="row">
            我的投稿
            <small>
              已发布 {s.approved} · 审核中 {s.pending} · 已退回 {s.returned}
            </small>
          </div>
          {summary.submitMode === 'blocked' ? (
            <span className="hint">你的账号暂时不能投稿，如有疑问请联系站长。</span>
          ) : (
            <AppLink to="/submit" className={buttonClass({ size: 'sm', block: true })}>
              <Icon name="upload" />
              新建投稿
            </AppLink>
          )}
          {isStaff(summary.role) ? (
            <AppLink to="/admin" className={buttonClass({ size: 'sm', block: true })}>
              <Icon name="gauge" />
              管理台
            </AppLink>
          ) : null}
        </div>
      </div>
      <nav ref={tabs} className="me-tabs" aria-label="个人中心">
        {sortedTabs().map((t) => {
          const n = t.count?.(summary)
          return (
            <AppLink key={t.id} to={t.to} exact={t.to === '/me'}>
              {t.label}
              {n != null ? <span className={cx('n', t.hot && n > 0 && 'hot')}>{n}</span> : null}
            </AppLink>
          )
        })}
      </nav>
      <div className="me-body">{children}</div>
    </div>
  )
}
