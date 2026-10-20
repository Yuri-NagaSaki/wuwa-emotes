import { useNavigate, useRouter } from '@tanstack/react-router'
import { useState, type CSSProperties } from 'react'
import type { EmojiView } from '#/server/submissions/emojis'
import type { ReviewItem, ReviewQueue, ReviewTab } from '#/server/submissions/service'
import { approveSubmissionFn, returnSubmissionFn } from '#/server/submissions/fn'
import { IDENTITY_LABELS, KIND_LABELS, KIND_TONE, RETURN_TEMPLATES, TEXT_LIMITS } from '#/server/submissions/rules'
import { licenseLabel } from '#/server/media/credits'
import { can, type Role } from '#/shared/roles'
import { Button, buttonClass } from '../Button'
import { Chip, Chips } from '../Chip'
import { cx } from '../cx'
import { EmptyState } from '../EmptyState'
import { Field, Textarea } from '../Field'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { Modal, ModalClose } from '../Modal'
import { Sheet } from '../Sheet'
import { Switch } from '../Switch'
import { Tabs } from '../Tabs'
import { toast } from '../Toast'
import { useAnimatedPreview } from '../usePreview'
import { ago, errorText } from '../account/text'

// 投稿审核 (prototype id "a-review"): tabs with counts, one card per submission (previews through
// /review-img, kind, submitter history, declaration, automatic checks), 通过并发布 with the 允许下载
// confirmation, 退回修改 with reason templates, and a preview sheet. Side panel: 审核要点.

const TABS: { value: ReviewTab; label: string }[] = [
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'returned', label: '已退回' },
]

type Action = { kind: 'approve'; item: ReviewItem } | { kind: 'return'; item: ReviewItem } | { kind: 'preview'; item: ReviewItem } | null

export function ReviewPage({ data, tab, role }: { data: ReviewQueue; tab: ReviewTab; role: Role }) {
  const router = useRouter()
  const navigate = useNavigate()
  const [action, setAction] = useState<Action>(null)
  const [done, setDone] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)

  async function decide(item: ReviewItem, fn: () => Promise<unknown>, message: string) {
    setBusy(true)
    try {
      await fn()
      setAction(null)
      setDone((s) => new Set(s).add(item.id))
      toast(message)
      // let the card fold away before the list refreshes
      setTimeout(() => void router.invalidate(), 320)
    } catch (err) {
      toast({ message: errorText(err), icon: 'warn', duration: 4000 })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="adm-h">
        <div>
          <h1>投稿审核</h1>
          <p>所有注册用户都能投稿；站长与管理员在这里审核。通过后立即发布，退回时附上原因。</p>
        </div>
      </div>
      <Tabs
        label="投稿状态"
        items={TABS.map((t) => ({ ...t, count: data.counts[t.value] }))}
        value={tab}
        onValueChange={(v) => navigate({ to: '/admin/review', search: { tab: v } })}
      />
      <div className="cols-2">
        <section className="panel rv-list" aria-live="polite">
          <div className="panel-b flush">
            {data.items.length ? (
              data.items.map((item) => (
                <ReviewCard
                  key={item.id}
                  item={item}
                  tab={tab}
                  done={done.has(item.id)}
                  onApprove={() => setAction({ kind: 'approve', item })}
                  onReturn={() => setAction({ kind: 'return', item })}
                  onPreview={() => setAction({ kind: 'preview', item })}
                />
              ))
            ) : (
              <EmptyState icon="inbox" title={tab === 'pending' ? '没有待处理的投稿' : tab === 'approved' ? '还没有通过的投稿' : '没有退回的投稿'}>
                {tab === 'pending' ? '新的投稿会出现在这里。' : null}
              </EmptyState>
            )}
          </div>
          {data.pages > 1 ? (
            <div className="pager">
              <span>
                第 {data.page + 1} / {data.pages} 页
              </span>
              <button type="button" disabled={data.page === 0} onClick={() => navigate({ to: '/admin/review', search: { tab, page: data.page - 1 } })} aria-label="上一页">
                <Icon name="left" size="sm" />
              </button>
              <button type="button" disabled={data.page + 1 >= data.pages} onClick={() => navigate({ to: '/admin/review', search: { tab, page: data.page + 1 } })} aria-label="下一页">
                <Icon name="right" size="sm" />
              </button>
            </div>
          ) : null}
        </section>
        <SidePanel role={role} />
      </div>

      {action?.kind === 'approve' ? (
        <ApproveDialog item={action.item} busy={busy} onClose={() => setAction(null)} onConfirm={(downloadable) => decide(action.item, () => approveSubmissionFn({ data: { id: action.item.id, downloadable } }), '已通过并发布')} />
      ) : null}
      <ReturnSheet
        item={action?.kind === 'return' ? action.item : null}
        busy={busy}
        onClose={() => setAction(null)}
        onConfirm={(reason) => action?.kind === 'return' && decide(action.item, () => returnSubmissionFn({ data: { id: action.item.id, reason } }), '已退回，投稿者会收到通知')}
      />
      <PreviewSheet item={action?.kind === 'preview' ? action.item : null} onClose={() => setAction(null)} />
    </>
  )
}

function ReviewCard({ item, tab, done, onApprove, onReturn, onPreview }: { item: ReviewItem; tab: ReviewTab; done: boolean; onApprove: () => void; onReturn: () => void; onPreview: () => void }) {
  const d = item.declaration
  const media = item.images.slice(0, 4)
  return (
    <article className={cx('rv', done && 'is-done')}>
      <div className="rv-media">
        {media.length ? media.map((e) => <Thumb key={e.id} emoji={e} />) : <span className="rv-empty"><Icon name="image" /></span>}
      </div>
      <div className="rv-main">
        <div className="rv-h">
          <b className="dyn">{item.title}</b>
          <span className={cx('st', KIND_TONE[item.kind])}>{KIND_LABELS[item.kind]}</span>
          {item.emojiCount ? <span className="pill-stat">{item.emojiCount} 张</span> : null}
          {item.official ? <span className="flag official">官转</span> : null}
        </div>
        <div className="hint">
          投稿者 <b className="dyn" style={{ color: 'var(--tp-ink)' }}>{item.submitter.name}</b> · 已通过 {item.submitter.approved} 次 ·{' '}
          <span suppressHydrationWarning>{ago(tab === 'pending' ? item.submittedAt : item.decidedAt)}</span>
        </div>
        {item.characters.length || item.artists.length ? (
          <div className="hint dyn">
            {item.characters.length ? `角色：${item.characters.join('、')}` : ''}
            {item.characters.length && item.artists.length ? ' · ' : ''}
            {item.artists.length ? `画师：${item.artists.join('、')}` : ''}
          </div>
        ) : null}
        {item.diff.length ? (
          <div className="diff">
            {item.diff.map((x) => (
              <div key={x.field}>
                {x.field}：{x.from ? <span className="del dyn">{x.from}</span> : null}
                {x.from ? ' → ' : ''}
                <span className="add dyn">{x.to}</span>
              </div>
            ))}
            <div className="hint">审核通过前，线上仍显示旧版本</div>
          </div>
        ) : null}
        <dl className="rv-lic">
          <dt>身份</dt>
          <dd>{d ? IDENTITY_LABELS[d.identity] : '—'}</dd>
          <dt>许可</dt>
          <dd>{item.kind === 'add_emojis' ? licenseLabel(item.pack.license) : d ? licenseLabel(d.license) : '—'}</dd>
          <dt>凭证</dt>
          <dd>
            {d?.proofUrl ? (
              <a href={d.proofUrl} target="_blank" rel="noopener noreferrer nofollow" style={{ color: 'var(--tp-teal-ink)', fontWeight: 800 }}>
                查看凭证
              </a>
            ) : (
              <span className="hint err">未提供</span>
            )}
          </dd>
          <dt>下载</dt>
          <dd>{item.official ? '只提供预览（官方）' : d?.downloadable ? '投稿者希望允许' : '只提供预览'}</dd>
        </dl>
        {d?.note ? <p className="rv-note dyn">「{d.note}」</p> : null}
        <div className="rv-checks">
          {item.checks.map((c) => (
            <span key={c.label} className={c.ok ? 'ok' : 'no'}>
              <Icon name={c.ok ? 'check' : 'warn'} size="sm" />
              {c.label}
            </span>
          ))}
        </div>
        {item.crossPack.length ? (
          <div className="hint">
            重复的图片也在：
            {item.crossPack.map((p, i) => (
              <span key={p.slug}>
                {i ? '、' : ''}
                {p.status === 'published' ? (
                  <AppLink to={`/packs/${p.slug}`} className="dyn" style={{ color: 'var(--tp-teal-ink)', fontWeight: 700 }}>
                    {p.title}
                  </AppLink>
                ) : (
                  <span className="dyn">{p.title}（未发布）</span>
                )}
                （{p.count} 张）
              </span>
            ))}
          </div>
        ) : null}
        {item.conflict ? (
          <div className="note-box warn">
            <Icon name="warn" size="sm" />
            <span>这个包在投稿创建后被修改过，现在无法通过。请退回，让投稿者重新提交。</span>
          </div>
        ) : null}
        {item.reviewNote && tab !== 'approved' ? (
          <div className="note-box warn">
            <Icon name="info" size="sm" />
            <span className="dyn">
              {tab === 'pending' ? '上次退回原因：' : '退回原因：'}
              {item.reviewNote}
            </span>
          </div>
        ) : null}
      </div>
      <div className="rv-acts">
        {tab === 'pending' ? (
          <>
            <Button variant="primary" size="sm" icon="check" onClick={onApprove} disabled={item.conflict}>
              通过并发布
            </Button>
            <Button size="sm" icon="reply" onClick={onReturn}>
              退回修改
            </Button>
          </>
        ) : null}
        {tab === 'approved' ? (
          <AppLink to={`/packs/${item.pack.slug}`} className={buttonClass({ variant: 'ghost', size: 'sm' })}>
            <Icon name="eye" />
            查看
          </AppLink>
        ) : (
          <Button variant="ghost" size="sm" icon="eye" onClick={onPreview}>
            预览
          </Button>
        )}
      </div>
    </article>
  )
}

function Thumb({ emoji, size = 240 }: { emoji: EmojiView; size?: number }) {
  const pv = useAnimatedPreview<HTMLSpanElement>(emoji.poster ?? '', emoji.preview)
  return (
    <span className="rv-thumb" ref={pv.ref} {...pv.handlers}>
      {emoji.poster ? <img src={pv.src} width={size} height={size} alt="" loading="lazy" decoding="async" /> : <Icon name="clock" />}
    </span>
  )
}

function ApproveDialog({ item, busy, onClose, onConfirm }: { item: ReviewItem; busy: boolean; onClose: () => void; onConfirm: (downloadable: boolean) => void }) {
  const [downloadable, setDownloadable] = useState(!item.official && Boolean(item.declaration?.downloadable))
  return (
    <Modal
      open
      onOpenChange={(v) => !v && onClose()}
      icon="check"
      title="通过并发布？"
      actions={
        <>
          <ModalClose render={<Button>取消</Button>} />
          <Button variant="primary" icon="check" onClick={() => onConfirm(item.official ? false : downloadable)} disabled={busy}>
            {busy ? '正在发布…' : '通过并发布'}
          </Button>
        </>
      }
    >
      <span className="dyn">「{item.title}」</span>
      {item.kind === 'new_pack' ? '会作为新包公开' : item.kind === 'add_emojis' ? `的 ${item.emojiCount} 张新表情会加入线上版本` : '的修改会替换线上版本'}。请确认是否允许下载原图：
      <br />
      <Switch checked={item.official ? false : downloadable} disabled={item.official} onCheckedChange={setDownloadable}>
        {item.official ? '官方表情：只提供预览' : downloadable ? '允许下载' : '只提供预览'}
      </Switch>
    </Modal>
  )
}

function ReturnSheet({ item, busy, onClose, onConfirm }: { item: ReviewItem | null; busy: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  const pick = (t: string) => setReason((r) => (r.includes(t) ? r : r.trim() ? `${r.trim()}；${t}` : t))
  return (
    <Sheet
      open={item != null}
      onOpenChange={(v) => {
        if (!v) {
          onClose()
          setReason('')
        }
      }}
      title="退回修改"
      subtitle={item ? item.title : undefined}
      icon="reply"
      footer={
        <Button
          variant="primary"
          block
          disabled={busy || !reason.trim()}
          onClick={() => {
            onConfirm(reason.trim())
            setReason('')
          }}
        >
          退回并通知投稿者
        </Button>
      }
    >
      <div className="sheet-form">
        <Field label="常用原因">
          <Chips>
            {RETURN_TEMPLATES.map((t) => (
              <Chip key={t} size="sm" on={reason.includes(t)} onClick={() => pick(t)}>
                {t}
              </Chip>
            ))}
          </Chips>
        </Field>
        <Field label="退回原因" hint="投稿者会在通知里看到这段话，写清楚怎么改。">
          <Textarea value={reason} maxLength={TEXT_LIMITS.reason} onChange={(e) => setReason(e.currentTarget.value)} placeholder="例如：缺少画师授权说明，请补充聊天截图链接。" />
        </Field>
      </div>
    </Sheet>
  )
}

function PreviewSheet({ item, onClose }: { item: ReviewItem | null; onClose: () => void }) {
  return (
    <Sheet open={item != null} onOpenChange={(v) => !v && onClose()} title="预览" subtitle={item?.title} icon="eye">
      {item ? (
        <>
          <dl className="kv">
            <dt>类型</dt>
            <dd>{KIND_LABELS[item.kind]}</dd>
            <dt>表情包</dt>
            <dd className="dyn">{item.pack.title}</dd>
            {item.payload.excerpt ? (
              <>
                <dt>简介</dt>
                <dd className="dyn">{item.payload.excerpt}</dd>
              </>
            ) : null}
            {item.payload.commissioner ? (
              <>
                <dt>约稿人</dt>
                <dd className="dyn">{item.payload.commissioner}</dd>
              </>
            ) : null}
            <dt>表情</dt>
            <dd>{item.emojiCount} 张</dd>
          </dl>
          <div className="rv-preview" style={{ '--tile': '96px' } as CSSProperties}>
            {item.images.map((e) => (
              <Thumb key={e.id} emoji={e} />
            ))}
          </div>
        </>
      ) : null}
    </Sheet>
  )
}

function SidePanel({ role }: { role: Role }) {
  return (
    <section className="panel">
      <div className="panel-h">
        <h3>审核要点</h3>
      </div>
      <div className="panel-b">
        <ul className="rules">
          <li>画师、约稿人与授权说明写清楚；没有凭证时可以退回补充。</li>
          <li>同一组风格的表情放在同一个包里。</li>
          <li>官方表情可以收录，但「允许下载」必须关闭。</li>
          <li>修改已发布的包会生成新版本，通过后替换线上内容。</li>
        </ul>
        <div className="field" style={{ marginTop: 12 }}>
          <div className="lab">退回原因模板</div>
          <Chips>
            {RETURN_TEMPLATES.slice(0, 4).map((t) => (
              <span key={t} className="chip sm">
                {t}
              </span>
            ))}
          </Chips>
        </div>
        <div className="rule-row" style={{ marginTop: 6 }}>
          <div>
            <b>可信投稿者免审</b>
            <small>在「用户与权限」里对单个用户开启</small>
          </div>
          {can(role, 'users') ? (
            <AppLink to="/admin/users" className={buttonClass({ size: 'xs' })}>
              去设置
            </AppLink>
          ) : (
            <span className="hint">仅站长</span>
          )}
        </div>
      </div>
    </section>
  )
}
