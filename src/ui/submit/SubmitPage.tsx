import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import type { SubmissionKind } from '#/server/db/schema/submissions'
import type { SubmitContext } from '#/server/submissions/context'
import { createSubmissionFn } from '#/server/submissions/fn'
import { Button, buttonClass } from '../Button'
import { EmptyState } from '../EmptyState'
import { AppLink } from '../link'
import { toast } from '../Toast'
import { errorText } from '../account/text'
import { SubmitForm } from './SubmitForm'

/** /submit: a new 投稿 (new pack by default; ?pack=<slug>&kind=add_emojis|edit_pack for an existing one). */
export function SubmitPage({ ctx, kind, packSlug }: { ctx: SubmitContext; kind: SubmissionKind; packSlug?: string }) {
  if (kind !== 'new_pack' && !ctx.pack) {
    return (
      <div className="wrap">
        <EmptyState icon="info" title="这个表情包不存在或还没有发布" actions={<AppLink to="/submit" className={buttonClass({ variant: 'primary', size: 'sm' })}>投稿新的表情包</AppLink>}>
          只能给已经发布的表情包补充表情或提出修改。
        </EmptyState>
      </div>
    )
  }
  if (kind === 'edit_pack') return <EditStart ctx={ctx} />
  return <SubmitForm ctx={ctx} detail={null} kind={kind} packSlug={packSlug} />
}

/** 修改已发布: the draft is created from the live pack, then edited at /me/submissions/$id. */
function EditStart({ ctx }: { ctx: SubmitContext }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const pack = ctx.pack!
  async function start() {
    setBusy(true)
    try {
      const r = await createSubmissionFn({ data: { kind: 'edit_pack', packSlug: pack.slug } })
      await navigate({ to: '/me/submissions/$id', params: { id: r.id } })
    } catch (err) {
      toast({ message: errorText(err), icon: 'warn' })
      setBusy(false)
    }
  }
  return (
    <div className="wrap">
      <div className="page-h">
        <h1>修改表情包</h1>
        <span className="sub">修改会生成一个待审核版本；审核通过前，线上仍显示现在的内容。</span>
      </div>
      <div className="card edit-start">
        <div className="target-pack" style={{ width: '100%' }}>
          {pack.cover ? <img src={pack.cover} alt="" width={64} height={64} /> : null}
          <div>
            <b className="dyn">{pack.title}</b>
            <small>{pack.emojiCount} 张</small>
          </div>
        </div>
        {pack.canEdit ? (
          <Button variant="primary" icon="edit" onClick={start} disabled={busy}>
            开始修改
          </Button>
        ) : (
          <>
            <p className="muted">只有这个包的投稿者可以修改它。想给它加表情，可以投稿「补充表情」。</p>
            <AppLink to={`/submit?kind=add_emojis&pack=${encodeURIComponent(pack.slug)}`} className={buttonClass({ variant: 'primary', size: 'sm' })}>
              补充表情
            </AppLink>
          </>
        )}
      </div>
    </div>
  )
}
