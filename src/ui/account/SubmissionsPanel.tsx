import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { MySubmissionItem } from '#/server/submissions/service'
import { withdrawSubmissionFn } from '#/server/submissions/fn'
import { KIND_LABELS, STATUS_LABELS, STATUS_TONE } from '#/server/submissions/rules'
import { Button, buttonClass } from '../Button'
import { cx } from '../cx'
import { EmptyState } from '../EmptyState'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { Modal, ModalClose } from '../Modal'
import { toast } from '../Toast'
import { errorText, shortDate } from './text'

// 我的投稿: one row per submission with its status and the action that state allows (§5.2):
// 草稿 → 继续编辑 / 撤回, 审核中 → 撤回, 已退回 → 修改后重新提交, 已发布 → 查看.

export function SubmissionsPanel({ items, highlight, blocked }: { items: MySubmissionItem[]; highlight?: string; blocked?: boolean }) {
  const router = useRouter()
  const [withdrawing, setWithdrawing] = useState<MySubmissionItem | null>(null)
  const [busy, setBusy] = useState(false)

  async function withdraw() {
    if (!withdrawing) return
    setBusy(true)
    try {
      await withdrawSubmissionFn({ data: { id: withdrawing.id } })
      toast('已撤回')
      setWithdrawing(null)
      await router.invalidate()
    } catch (err) {
      toast({ message: errorText(err), icon: 'warn' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="toolbar">
        <b>我的投稿</b>
        <span className="muted">提交后由管理员审核，通过即公开</span>
        <span className="grow" />
        {blocked ? null : (
          <AppLink to="/submit" className={buttonClass({ variant: 'primary', size: 'sm' })}>
            <Icon name="plus" />
            新建投稿
          </AppLink>
        )}
      </div>
      {items.length ? (
        <div className="list">
          {items.map((x) => (
            <div key={x.id} className={cx('li', x.id === highlight && 'is-new')}>
              <span className="th">{x.thumb ? <img src={x.thumb} alt="" width={48} height={48} loading="lazy" /> : <Icon name="image" />}</span>
              <div>
                <b className="dyn">{x.title}</b>
                <small>
                  {KIND_LABELS[x.kind]} · {x.emojiCount} 张 · {shortDate(x.decidedAt ?? x.submittedAt ?? x.updatedAt)}
                </small>
                {x.status === 'returned' && x.reviewNote ? <span className="note dyn">退回原因：{x.reviewNote}</span> : null}
              </div>
              <span className="r">
                <span className={cx('st', STATUS_TONE[x.status])}>{STATUS_LABELS[x.status]}</span>
                <RowActions item={x} onWithdraw={() => setWithdrawing(x)} />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="upload"
          title="还没有投稿"
          actions={
            blocked ? undefined : (
              <AppLink to="/submit" className={buttonClass({ variant: 'primary', size: 'sm' })}>
                投稿表情包
              </AppLink>
            )
          }
        >
          把你画的、约的或整理的鸣潮表情分享给大家。
        </EmptyState>
      )}
      <div className="note-box">
        <Icon name="info" size="sm" />
        <span>已发布的包再次修改会生成一个待审核版本，审核通过前线上仍显示旧版本。</span>
      </div>

      <Modal
        open={withdrawing != null}
        onOpenChange={(v) => !v && setWithdrawing(null)}
        icon="back"
        title="撤回这条投稿？"
        actions={
          <>
            <ModalClose render={<Button>先不撤回</Button>} />
            <Button variant="danger" onClick={withdraw} disabled={busy}>
              撤回
            </Button>
          </>
        }
      >
        撤回后投稿结束，不能再提交；上传的图片会在 30 天后清理。想修改可以新建一条投稿。
      </Modal>
    </>
  )
}

function RowActions({ item, onWithdraw }: { item: MySubmissionItem; onWithdraw: () => void }) {
  const edit = `/me/submissions/${item.id}`
  switch (item.status) {
    case 'draft':
      return (
        <>
          <AppLink to={edit} className={buttonClass({ size: 'xs', variant: 'primary' })}>
            继续编辑
          </AppLink>
          <Button size="xs" onClick={onWithdraw}>
            撤回
          </Button>
        </>
      )
    case 'pending':
      return (
        <>
          <AppLink to={edit} className={buttonClass({ size: 'xs' })}>
            查看
          </AppLink>
          <Button size="xs" onClick={onWithdraw}>
            撤回
          </Button>
        </>
      )
    case 'returned':
      return (
        <AppLink to={edit} className={buttonClass({ size: 'xs', variant: 'primary' })}>
          修改后重新提交
        </AppLink>
      )
    case 'approved':
      return (
        <AppLink to={`/packs/${item.pack.slug}`} className={buttonClass({ size: 'xs' })}>
          查看
        </AppLink>
      )
    default:
      return (
        <AppLink to={edit} className={buttonClass({ size: 'xs', variant: 'ghost' })}>
          详情
        </AppLink>
      )
  }
}
