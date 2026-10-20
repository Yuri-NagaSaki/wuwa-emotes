import { useEffect, useState } from 'react'
import { myCommentsFn } from '#/server/comments/fns'
import type { MyComment, MyCommentsPage } from '#/server/comments/types'
import { Button } from '../Button'
import { EmptyState } from '../EmptyState'
import { AppLink } from '../link'
import commentsCss from './comments.css?url'
import { errorMessage, fullTime, relTime } from './util'

// 我的评论 for the /me page: the signed-in viewer's comments with their status. Fetched in the browser
// (myCommentsFn needs a session).

const STATUS: Record<string, { cls: string; label: string }> = {
  published: { cls: 'ok', label: '已公开' },
  pending: { cls: 'warn', label: '审核中' },
  spam: { cls: 'err', label: '未通过' },
  deleted: { cls: 'mute', label: '已删除' },
}

function statusOf(c: MyComment) {
  return STATUS[c.deleted ? 'deleted' : c.status] ?? STATUS.pending!
}

export interface MyCommentsProps {
  /** Called with the counts once loaded (e.g. for the tab badge). */
  onCounts?: (counts: MyCommentsPage['counts']) => void
  className?: string
}

export function MyComments({ onCounts, className }: MyCommentsProps) {
  const [items, setItems] = useState<MyComment[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [counts, setCounts] = useState<MyCommentsPage['counts'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load(after?: string | null) {
    setLoading(true)
    setError(null)
    try {
      const page = await myCommentsFn({ data: { cursor: after ?? undefined } })
      setItems((prev) => (after && prev ? [...prev, ...page.items] : page.items))
      setCursor(page.nextCursor)
      setCounts(page.counts)
      onCounts?.(page.counts)
    } catch (err) {
      setError(errorMessage(err, '加载失败'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={['cm-mine', className].filter(Boolean).join(' ')} style={{ display: 'grid', gap: 14 }}>
      <link rel="stylesheet" href={commentsCss} precedence="default" />
      {counts ? (
        <div className="cm-counts">
          <span className="st ok">已公开 {counts.published}</span>
          <span className="st warn">审核中 {counts.pending}</span>
          {counts.spam ? <span className="st err">未通过 {counts.spam}</span> : null}
          {counts.deleted ? <span className="st mute">已删除 {counts.deleted}</span> : null}
        </div>
      ) : null}
      {error && !items ? (
        <EmptyState icon="warn" title="评论加载失败" actions={<Button size="sm" icon="refresh" onClick={() => void load()}>重试</Button>}>
          {error}
        </EmptyState>
      ) : items === null ? (
        <div className="cm-loading" aria-busy="true" aria-label="正在加载">
          <div className="skel" />
          <div className="skel" />
        </div>
      ) : !items.length ? (
        <EmptyState icon="chat" title="还没有发过评论">
          在表情包页面底部的评论区说点什么，或者发一张贴纸。
        </EmptyState>
      ) : (
        <div className="cm-list">
          {items.map((c) => {
            const st = statusOf(c)
            const href = c.thread.href ? `${c.thread.href}#c-${c.id}` : null
            return (
              <div className="cm-li" key={c.id}>
                <div>
                  <div className="where">
                    在「{href ? <AppLink to={href}>{c.thread.title}</AppLink> : <span>{c.thread.title}</span>}」
                    <small>
                      {' · '}
                      <time dateTime={c.createdAt} title={fullTime(c.createdAt)}>
                        {relTime(c.createdAt)}
                      </time>
                      {c.replyCount ? ` · ${c.replyCount} 条回复` : ''}
                    </small>
                  </div>
                  {c.html ? (
                    // server-rendered (src/server/comments/render.ts)
                    <div className="cmt-b" dangerouslySetInnerHTML={{ __html: c.html }} />
                  ) : (
                    <div className="cmt-b hint">该评论已删除</div>
                  )}
                </div>
                <div className="r">
                  <span className={`st ${st.cls}`}>{st.label}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {cursor ? (
        <div className="loadmore">
          <Button size="sm" onClick={() => void load(cursor)} disabled={loading}>
            {loading ? '加载中…' : '加载更多'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
