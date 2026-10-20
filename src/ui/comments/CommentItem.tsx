import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { BADGE_LABELS, REACTION_KEYS, REACTION_LABELS, type ReactionKey } from '#/server/comments/constants'
import type { CommentItem as Item, ThreadConfig } from '#/server/comments/types'
import { cx } from '../cx'
import { Icon } from '../Icon'
import { Menu, type MenuEntry } from '../Menu'
import { fullTime, relTime } from './util'

// One comment (楼 or 楼中楼). Bodies are server-rendered HTML (src/server/comments/render.ts); this
// component never turns body_src into markup. Names are plain text in the body font.

export interface ItemViewer {
  id: string
  staff: boolean
}

export interface CommentActions {
  onReply: (item: Item) => void
  onReact: (item: Item, key: ReactionKey) => void
  onReport: (item: Item) => void
  onEdit: (item: Item) => void
  onDelete: (item: Item) => void
  onPin: (item: Item) => void
  onModDelete: (item: Item) => void
  onBadge: (item: Item, badge: 'artist' | null) => void
}

export interface CommentItemProps {
  item: Item
  reply?: boolean
  viewer: ItemViewer | null
  config: ThreadConfig
  actions: CommentActions
  /** Replies and the inline reply form, under a root. */
  children?: ReactNode
}

function Avatar({ item, small }: { item: Item; small?: boolean }) {
  if (!item.author) return <span className={cx('avatar gone', small && 'sm')} aria-hidden="true" />
  const c = `var(--c-${item.author.color})`
  return (
    <span className={cx('avatar', small && 'sm')} aria-hidden="true" style={{ borderColor: c, background: `color-mix(in srgb, ${c} 30%, var(--tp-card))` } as CSSProperties}>
      {[...item.author.name][0] ?? '?'}
    </span>
  )
}

function ReactionButton({ k, n, mine, config, onClick }: { k: ReactionKey; n?: number; mine?: boolean; config: ThreadConfig; onClick: () => void }) {
  const sticker = config.reactionStickers[k]
  return (
    <button type="button" className={cx('react', mine && 'is-on')} title={REACTION_LABELS[k]} aria-pressed={mine ?? undefined} aria-label={`${REACTION_LABELS[k]}${n ? ` ${n}` : ''}`} onClick={onClick}>
      {sticker ? <img src={sticker.poster} alt="" width={24} height={24} /> : <span className="lbl">{REACTION_LABELS[k]}</span>}
      {n ? n : null}
    </button>
  )
}

function ReactionAdd({ config, onPick }: { config: ThreadConfig; onPick: (k: ReactionKey) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" className="react add" aria-label="添加回应" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="smile" size="sm" />
      </button>
      {open ? (
        <div className="pop react-pop" role="menu" style={{ position: 'absolute', left: 0, bottom: 'calc(100% + 6px)', zIndex: 25 }}>
          {REACTION_KEYS.map((k) => (
            <ReactionButton
              key={k}
              k={k}
              config={config}
              onClick={() => {
                setOpen(false)
                onPick(k)
              }}
            />
          ))}
        </div>
      ) : null}
    </span>
  )
}

export function CommentItem({ item, reply, viewer, config, actions, children }: CommentItemProps) {
  const shown = item.state === 'visible' || item.state === 'pending'
  const gone = !shown
  const isRoot = item.rootId == null
  const menu: MenuEntry[] = []
  if (shown && item.mine && item.editableUntil) menu.push({ label: '编辑', icon: 'edit', onSelect: () => actions.onEdit(item) })
  if (shown && item.mine) menu.push({ label: '删除', icon: 'trash', danger: true, onSelect: () => actions.onDelete(item) })
  if (viewer?.staff && item.state === 'visible') {
    if (menu.length) menu.push({ kind: 'separator' })
    if (isRoot) menu.push({ label: item.pinned ? '取消置顶' : '置顶', icon: 'pin', onSelect: () => actions.onPin(item) })
    if (item.badge !== 'admin' && item.badge !== 'manager') {
      menu.push({ label: item.badge === 'artist' ? '去掉画师徽章' : '标记为画师', icon: 'star', onSelect: () => actions.onBadge(item, item.badge === 'artist' ? null : 'artist') })
    }
    if (!item.mine) menu.push({ label: '删除（管理）', icon: 'ban', danger: true, onSelect: () => actions.onModDelete(item) })
  }

  return (
    <div id={`c-${item.id}`} className={cx('cmt', item.pinned && shown && 'is-pinned', gone && 'is-gone', item.state === 'pending' && 'is-pending')}>
      <Avatar item={item} small={reply} />
      <div>
        <div className="cmt-h">
          {item.author ? <b>{item.author.name}</b> : <b>{item.state === 'deleted' ? '已删除' : '已隐藏'}</b>}
          {item.badge ? <span className={cx('role', item.badge === 'artist' ? 'artist' : 'staff')}>{BADGE_LABELS[item.badge]}</span> : null}
          {item.author?.guest ? <span className="role guest">游客</span> : null}
          {item.pinned && shown ? (
            <span className="role op">
              <Icon name="pin" size="sm" />
              置顶
            </span>
          ) : null}
          {item.state === 'pending' ? <span className="role pend">审核中</span> : null}
          {item.replyTo ? (
            <span className="reply-to">
              回复 <b>@{item.replyTo}</b>
            </span>
          ) : null}
          <time dateTime={item.createdAt} title={fullTime(item.createdAt)}>
            {relTime(item.createdAt)}
          </time>
          {item.editedAt && shown ? <span className="edited">已编辑</span> : null}
        </div>
        <div className="cmt-b">
          {shown ? (
            // server-rendered (markdown-it, html off); see src/server/comments/render.ts
            <div dangerouslySetInnerHTML={{ __html: item.html ?? '' }} />
          ) : (
            <div>{item.state === 'deleted' ? '该评论已删除' : '该评论已隐藏'}</div>
          )}
        </div>
        {item.state === 'visible' ? (
          <div className="cmt-f">
            {item.reactions.map((r) => (
              <ReactionButton key={r.key} k={r.key} n={r.n} mine={r.mine} config={config} onClick={() => actions.onReact(item, r.key)} />
            ))}
            <ReactionAdd config={config} onPick={(k) => actions.onReact(item, k)} />
            <button type="button" className="lnk" onClick={() => actions.onReply(item)}>
              <Icon name="reply" size="sm" />
              回复
            </button>
            {!item.mine ? (
              <button type="button" className="lnk" onClick={() => actions.onReport(item)}>
                <Icon name="flag" size="sm" />
                举报
              </button>
            ) : null}
            {menu.length ? (
              <Menu
                align="start"
                trigger={
                  <button type="button" className="lnk" aria-label="更多操作">
                    <Icon name="more" size="sm" />
                  </button>
                }
                items={menu}
              />
            ) : null}
          </div>
        ) : item.state === 'pending' && menu.length ? (
          <div className="cmt-f">
            <span className="hint">审核通过后其他人才能看到</span>
            <Menu
              align="start"
              trigger={
                <button type="button" className="lnk" aria-label="更多操作">
                  <Icon name="more" size="sm" />
                </button>
              }
              items={menu}
            />
          </div>
        ) : null}
        {children}
      </div>
    </div>
  )
}
