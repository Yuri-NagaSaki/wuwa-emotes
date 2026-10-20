import { Dialog } from '@base-ui/react/dialog'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactionKey } from '#/server/comments/constants'
import { badgeCommentFn, moderateCommentsFn, pinCommentFn } from '#/server/comments/admin-fns'
import { deleteCommentFn, listCommentsFn, listRepliesFn, reactCommentFn, reportCommentFn } from '#/server/comments/fns'
import type { CommentItem as Item, CommentSort, CreateResult, Sticker, ThreadPage, ThreadRoot } from '#/server/comments/types'
import { Button } from '../Button'
import { Chip, Chips } from '../Chip'
import { EmptyState } from '../EmptyState'
import { Icon } from '../Icon'
import { Modal, ModalClose } from '../Modal'
import { Seg } from '../Seg'
import { toast } from '../Toast'
import { PHONE_QUERY, useMediaQuery } from '../useMediaQuery'
import { CommentItem, type CommentActions } from './CommentItem'
import commentsCss from './comments.css?url'
import { Composer } from './Composer'
import { errorMessage } from './util'

// 评论区 for a pack page or a single emoji. The thread is per viewer (own pending comments, reactions,
// edit windows), so it is fetched in the browser when the section scrolls near the viewport, never
// rendered into the shared-cached HTML.

export interface CommentsSectionProps {
  threadType: 'pack' | 'emoji'
  /** pack: String(pack.id) (not the slug, which can be renamed); emoji: the emoji id. */
  threadId: string
  /** 本包 tab of the sticker picker; defaults to the thread's pack for pack threads. */
  packId?: number | null
  /** The pack's stickers if the page already has them (PackEmoji works: id, poster, width, height). */
  packStickers?: readonly Sticker[] | null
  /** Load right away instead of when scrolled near (default: lazy). */
  eager?: boolean
  className?: string
}

const SORTS = [
  { value: 'hot', label: '最热' },
  { value: 'new', label: '最新' },
  { value: 'old', label: '最早' },
] as const

const REPORT_REASONS = ['广告或引流', '人身攻击', '色情低俗', '剧透或刷屏', '其他']

type Target = { item: Item; root: number }

export function CommentsSection({ threadType, threadId, packId, packStickers, eager, className }: CommentsSectionProps) {
  const ref = useRef<HTMLElement>(null)
  const phone = useMediaQuery(PHONE_QUERY)
  const [near, setNear] = useState(!!eager)
  const [sort, setSort] = useState<CommentSort>('hot')
  const [page, setPage] = useState<ThreadPage | null>(null)
  const [roots, setRoots] = useState<ThreadRoot[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [replying, setReplying] = useState<Target | null>(null)
  const [editing, setEditing] = useState<Item | null>(null)
  const [reporting, setReporting] = useState<Item | null>(null)
  const [reportReason, setReportReason] = useState(REPORT_REASONS[0]!)
  const [deleting, setDeleting] = useState<{ item: Item; moderator: boolean } | null>(null)
  const flashed = useRef(false)

  // load when the section comes near (or right away for a #c-123 link)
  useEffect(() => {
    if (near) return
    if (/^#c-\d+$/.test(location.hash) || location.hash === '#comments' || typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])

  const load = useCallback(
    async (nextSort: CommentSort, after?: string | null) => {
      setLoading(true)
      setFailed(null)
      try {
        const res = await listCommentsFn({ data: { threadType, threadId, sort: nextSort, cursor: after ?? undefined } })
        setPage(res)
        setRoots((prev) => (after ? [...prev, ...res.items.filter((r) => !prev.some((p) => p.id === r.id))] : res.items))
        setCursor(res.nextCursor)
      } catch (err) {
        setFailed(errorMessage(err, '评论加载失败'))
      } finally {
        setLoading(false)
      }
    },
    [threadType, threadId],
  )

  useEffect(() => {
    if (near) void load(sort)
  }, [near, sort, load])

  // #c-123: scroll to the comment once it is on the page
  useEffect(() => {
    if (flashed.current || !roots.length) return
    const m = /^#c-(\d+)$/.exec(location.hash)
    if (!m) return
    const el = document.getElementById(`c-${m[1]}`)
    if (!el) return
    flashed.current = true
    el.scrollIntoView({ block: 'center' })
    el.classList.add('is-flash')
  }, [roots])

  // ---- tree updates ----

  function mapItems(fn: (it: Item) => Item | null) {
    setRoots((list) =>
      list.flatMap((r) => {
        const next = fn(r)
        const replies = r.replies.flatMap((x) => {
          const y = fn(x)
          return y ? [y] : []
        })
        if (!next) return replies.length ? [{ ...r, state: 'deleted' as const, html: null, author: null, replies }] : []
        return [{ ...r, ...next, replies }]
      }),
    )
  }

  function replaceItem(updated: Item) {
    mapItems((it) => (it.id === updated.id ? { ...it, ...updated } : it))
  }

  function onCreated(res: CreateResult, root: number | null) {
    const c = res.comment
    if (root == null) {
      setRoots((list) => [{ ...c, replies: [], replyCount: 0, repliesCursor: null }, ...list])
    } else {
      setRoots((list) => list.map((r) => (r.id === root ? { ...r, replies: [...r.replies, c], replyCount: r.replyCount + (res.status === 'published' ? 1 : 0) } : r)))
    }
    if (res.status === 'published') setPage((p) => (p ? { ...p, total: p.total + 1 } : p))
    setReplying(null)
  }

  async function moreReplies(root: ThreadRoot) {
    if (!root.repliesCursor) return
    try {
      const res = await listRepliesFn({ data: { rootId: root.id, cursor: root.repliesCursor } })
      setRoots((list) =>
        list.map((r) => (r.id === root.id ? { ...r, replies: [...r.replies, ...res.items.filter((x) => !r.replies.some((y) => y.id === x.id))], repliesCursor: res.nextCursor } : r)),
      )
    } catch (err) {
      toast({ message: errorMessage(err), icon: 'warn' })
    }
  }

  const viewer = page?.viewer ?? null
  const needLogin = (what: string) => toast({ message: `登录后才能${what}`, icon: 'lock' })

  const actions: CommentActions = {
    onReply: (item) => {
      setEditing(null)
      setReplying({ item, root: item.rootId ?? item.id })
    },
    onReact: async (item, key: ReactionKey) => {
      if (!viewer) return needLogin('回应')
      try {
        const reactions = await reactCommentFn({ data: { id: item.id, key } })
        replaceItem({ ...item, reactions })
      } catch (err) {
        toast({ message: errorMessage(err), icon: 'warn' })
      }
    },
    onReport: (item) => {
      if (!viewer) return needLogin('举报')
      setReportReason(REPORT_REASONS[0]!)
      setReporting(item)
    },
    onEdit: (item) => {
      setReplying(null)
      setEditing(item)
    },
    onDelete: (item) => setDeleting({ item, moderator: false }),
    onModDelete: (item) => setDeleting({ item, moderator: true }),
    onPin: async (item) => {
      try {
        await pinCommentFn({ data: { id: item.id, pinned: !item.pinned } })
        toast({ message: item.pinned ? '已取消置顶' : '已置顶', icon: 'pin' })
        void load(sort)
      } catch (err) {
        toast({ message: errorMessage(err), icon: 'warn' })
      }
    },
    onBadge: async (item, badge) => {
      try {
        await badgeCommentFn({ data: { id: item.id, badge } })
        replaceItem({ ...item, badge })
      } catch (err) {
        toast({ message: errorMessage(err), icon: 'warn' })
      }
    },
  }

  async function confirmReport() {
    const item = reporting
    if (!item) return
    setReporting(null)
    try {
      const res = await reportCommentFn({ data: { id: item.id, reason: reportReason } })
      toast({ message: res.already ? '你已经举报过这条评论' : '已举报，感谢反馈', icon: 'flag' })
      if (res.hidden) mapItems((it) => (it.id === item.id ? null : it))
    } catch (err) {
      toast({ message: errorMessage(err), icon: 'warn' })
    }
  }

  async function confirmDelete() {
    const d = deleting
    if (!d) return
    setDeleting(null)
    try {
      if (d.moderator) await moderateCommentsFn({ data: { ids: [d.item.id], action: 'delete' } })
      else await deleteCommentFn({ data: { id: d.item.id } })
      mapItems((it) => (it.id === d.item.id ? null : it))
      if (d.item.state === 'visible') setPage((p) => (p ? { ...p, total: Math.max(0, p.total - 1) } : p))
      toast({ message: '已删除', icon: 'trash' })
    } catch (err) {
      toast({ message: errorMessage(err), icon: 'warn' })
    }
  }

  const config = page?.config
  const pickerPack = packId ?? (threadType === 'pack' ? Number(threadId) : null)
  const composerViewer = viewer ? { id: viewer.id, name: viewer.name, banned: viewer.banned } : null

  function composer(extra: { replyTo?: Target | null; editing?: Item | null; compact?: boolean; onCancel?: () => void }) {
    if (!page || !config) return null
    const root = extra.replyTo?.root ?? null
    return (
      <Composer
        threadType={threadType}
        threadId={threadId}
        viewer={composerViewer}
        config={config}
        formToken={page.formToken}
        replyTo={extra.replyTo ? { id: extra.replyTo.item.id, name: extra.replyTo.item.author?.name ?? '' } : null}
        editing={extra.editing}
        packId={pickerPack}
        packStickers={packStickers}
        phone={phone}
        compact={extra.compact}
        onCancel={extra.onCancel}
        onDone={(res) => {
          if (extra.editing) {
            replaceItem(res.comment)
            setEditing(null)
          } else onCreated(res, root)
        }}
      />
    )
  }

  function renderItem(item: Item, reply: boolean) {
    if (editing?.id === item.id) {
      return <div key={item.id}>{composer({ editing: item, compact: true, onCancel: () => setEditing(null) })}</div>
    }
    return <CommentItem key={item.id} item={item} reply={reply} viewer={viewer} config={config!} actions={actions} />
  }

  return (
    <section ref={ref} className={['sec cm', className].filter(Boolean).join(' ')} id="comments" aria-label="评论">
      {/* React 19 hoists and dedupes this into <head> */}
      <link rel="stylesheet" href={commentsCss} precedence="default" />
      <div className="cm-head">
        <h2>评论</h2>
        {page ? <span className="n">{page.total}</span> : null}
        <Seg size="sm" label="评论排序" options={SORTS} value={sort} onChange={(v) => setSort(v)} />
      </div>
      {!page ? (
        failed ? (
          <EmptyState icon="warn" title="评论加载失败" actions={<Button size="sm" icon="refresh" onClick={() => void load(sort)}>重试</Button>}>
            {failed}
          </EmptyState>
        ) : (
          <div className="cm-loading" aria-busy="true" aria-label="正在加载评论">
            <div className="skel" />
            <div className="skel" />
          </div>
        )
      ) : (
        <>
          {composer({})}
          {roots.length ? (
            <div>
              {roots.map((root) => {
                const shownReplies = root.replies.filter((r) => r.state === 'visible').length
                const rest = Math.max(0, root.replyCount - shownReplies)
                return editing?.id === root.id ? (
                  <div key={root.id}>{composer({ editing: root, compact: true, onCancel: () => setEditing(null) })}</div>
                ) : (
                  <CommentItem key={root.id} item={root} viewer={viewer} config={config!} actions={actions}>
                    {root.replies.length || replying?.root === root.id ? (
                      <div className="cmt-replies">
                        {root.replies.map((r) => renderItem(r, true))}
                        {root.repliesCursor ? (
                          <button type="button" className="more-replies" onClick={() => void moreReplies(root)}>
                            <Icon name="down" size="sm" />
                            展开其余 {rest || ''} 条回复
                          </button>
                        ) : null}
                        {replying?.root === root.id ? composer({ replyTo: replying, compact: true, onCancel: () => setReplying(null) }) : null}
                      </div>
                    ) : null}
                  </CommentItem>
                )
              })}
            </div>
          ) : (
            <EmptyState icon="chat" title="还没有评论">
              来抢沙发吧，发一张贴纸也行。
            </EmptyState>
          )}
          {cursor ? (
            <div className="loadmore">
              <Button size="sm" onClick={() => void load(sort, cursor)} disabled={loading}>
                {loading ? '加载中…' : '加载更多评论'}
              </Button>
            </div>
          ) : null}
        </>
      )}
      <ReportDialog
        open={!!reporting}
        reason={reportReason}
        onReason={setReportReason}
        onCancel={() => setReporting(null)}
        onConfirm={() => void confirmReport()}
      />
      <Modal
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        icon="trash"
        title={deleting?.moderator ? '以管理员身份删除？' : '删除这条评论？'}
        actions={
          <>
            <ModalClose render={<Button size="sm">取消</Button>} />
            <Button size="sm" variant="danger" onClick={() => void confirmDelete()}>
              删除
            </Button>
          </>
        }
      >
        {deleting?.moderator ? '删除会写入审计日志，可在「评论审核 › 已删除」恢复。' : '删除后不能恢复；有回复时会保留「该评论已删除」的位置。'}
      </Modal>
    </section>
  )
}

/** 举报 dialog: the Modal look (.modal on the blob) with reason chips under the description. */
function ReportDialog({ open, reason, onReason, onCancel, onConfirm }: { open: boolean; reason: string; onReason: (r: string) => void; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onCancel()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="scrim" />
        <Dialog.Viewport className="modal-wrap">
          <Dialog.Popup className="modal">
            <div className="modal-body">
              <span className="modal-ico">
                <Icon name="flag" size="lg" />
              </span>
              <Dialog.Title render={<h3 />}>举报这条评论</Dialog.Title>
              <Dialog.Description render={<p />}>选一个原因。被多人举报的评论会先隐藏，等管理员处理。</Dialog.Description>
              <Chips className="report-reasons">
                {REPORT_REASONS.map((r) => (
                  <Chip key={r} size="sm" on={r === reason} onClick={() => onReason(r)}>
                    {r}
                  </Chip>
                ))}
              </Chips>
              <div className="acts">
                <Button size="sm" onClick={onCancel}>
                  取消
                </Button>
                <Button size="sm" variant="primary" onClick={onConfirm}>
                  举报
                </Button>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
