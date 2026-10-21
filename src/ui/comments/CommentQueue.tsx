import { useState, type ReactNode } from 'react'
import type { CommentSettingsView } from '#/server/comments/admin'
import { banCommenterFn, commentQueueFn, commentSettingsFn, moderateCommentsFn, pinCommentFn, saveCommentSettingsFn } from '#/server/comments/admin-fns'
import { BADGE_LABELS, HOLD_REASON_LABELS, MAX_STICKERS, REACTION_KEYS, REACTION_LABELS, type ReactionKey } from '#/server/comments/constants'
import type { ModerateAction, QueueItem, QueuePage, QueueTab } from '#/server/comments/types'
import { Avatar } from '../Avatar'
import { Button } from '../Button'
import { Chip, Chips } from '../Chip'
import { cx } from '../cx'
import { EmptyState } from '../EmptyState'
import { Check, Input } from '../Field'
import { Switch } from '../Switch'
import { Tabs } from '../Tabs'
import { toast } from '../Toast'
import commentsCss from './comments.css?url'
import { errorMessage, fullTime, relTime } from './util'

// 评论审核 (/admin/comments): five tabs with counts, the queue with single and bulk actions, and the
// rules panel (switches, edit window, report threshold, 屏蔽词, 回应贴纸, 禁止评论). Everything goes
// through requirePerm('comments') server functions, which audit each change.

const TABS: { value: QueueTab; label: string }[] = [
  { value: 'pending', label: '待审核' },
  { value: 'reported', label: '被举报' },
  { value: 'spam', label: '垃圾' },
  { value: 'published', label: '已通过' },
  { value: 'deleted', label: '已删除' },
]

const ACTION_DONE: Record<ModerateAction, string> = { approve: '已通过', spam: '已标为垃圾', delete: '已删除', restore: '已恢复' }

function fmtCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n)
}

export interface CommentQueueProps {
  initialQueue: QueuePage
  initialSettings: CommentSettingsView
  /** Role of the viewer (站长 may do more in ban rules). */
  viewerRole: 'admin' | 'manager'
}

export function CommentQueue({ initialQueue, initialSettings, viewerRole }: CommentQueueProps) {
  const [queue, setQueue] = useState(initialQueue)
  const [tab, setTab] = useState<QueueTab>(initialQueue.tab)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [settings, setSettings] = useState(initialSettings)

  async function loadTab(next: QueueTab, cursor?: string | null) {
    setBusy(true)
    try {
      const page = await commentQueueFn({ data: { tab: next, cursor: cursor ?? undefined } })
      setQueue((prev) => (cursor ? { ...page, items: [...prev.items, ...page.items] } : page))
      setTab(next)
      if (!cursor) setSelected(new Set())
    } catch (err) {
      toast({ message: errorMessage(err), icon: 'warn' })
    } finally {
      setBusy(false)
    }
  }

  async function act(ids: number[], action: ModerateAction) {
    if (!ids.length) return
    setBusy(true)
    try {
      const res = await moderateCommentsFn({ data: { ids, action } })
      const skipped = res.skipped.length ? `，${res.skipped.length} 条不适用` : ''
      toast({ message: `${ACTION_DONE[action]} ${res.done.length} 条${skipped}`, icon: action === 'approve' || action === 'restore' ? 'check' : 'trash' })
      await loadTab(tab)
    } catch (err) {
      toast({ message: errorMessage(err), icon: 'warn' })
      setBusy(false)
    }
  }

  async function pin(item: QueueItem) {
    try {
      await pinCommentFn({ data: { id: item.id, pinned: !item.pinned } })
      setQueue((q) => ({ ...q, items: q.items.map((i) => (i.id === item.id ? { ...i, pinned: !i.pinned } : i)) }))
    } catch (err) {
      toast({ message: errorMessage(err), icon: 'warn' })
    }
  }

  async function ban(userId: string, banned: boolean) {
    try {
      await banCommenterFn({ data: { userId, banned } })
      toast({ message: banned ? '已禁止该用户评论' : '已解除禁止评论', icon: banned ? 'ban' : 'check' })
      setQueue((q) => ({ ...q, items: q.items.map((i) => (i.author.userId === userId ? { ...i, author: { ...i.author, banned } } : i)) }))
      setSettings(await commentSettingsFn())
    } catch (err) {
      toast({ message: errorMessage(err), icon: 'warn' })
    }
  }

  const ids = queue.items.map((i) => i.id)
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id))
  const sel = [...selected]
  const bulk: [ModerateAction, string][] =
    tab === 'deleted' ? [['restore', '批量恢复']] : tab === 'spam' ? [['approve', '批量通过'], ['delete', '批量删除']] : tab === 'published' ? [['spam', '批量垃圾'], ['delete', '批量删除']] : [['approve', '批量通过'], ['spam', '批量垃圾'], ['delete', '批量删除']]

  return (
    <>
      <link rel="stylesheet" href={commentsCss} precedence="default" />
      <div className="adm-h">
        <div>
          <h1>评论审核</h1>
          <p>新用户首评、含外链、命中屏蔽词或被举报的评论进入队列；其余直接公开</p>
        </div>
      </div>
      <Tabs
        label="评论状态"
        items={TABS.map((t) => ({ ...t, count: fmtCount(queue.counts[t.value]) }))}
        value={tab}
        onValueChange={(v) => void loadTab(v)}
      />
      <div className="cols-2">
        <section className="panel">
          <div className="panel-h">
            <h3>队列</h3>
            <div className="acts q-tools">
              <Check checked={allOn} onChange={(v) => setSelected(v ? new Set(ids) : new Set())} disabled={!ids.length}>
                全选
              </Check>
              {bulk.map(([a, label]) => (
                <Button key={a} size="xs" disabled={!sel.length || busy} onClick={() => void act(sel, a)}>
                  {label}
                  {sel.length ? ` ${sel.length}` : ''}
                </Button>
              ))}
            </div>
          </div>
          <div className="panel-b flush" aria-busy={busy || undefined}>
            {queue.items.length ? (
              queue.items.map((item) => (
                <QueueCard
                  key={item.id}
                  item={item}
                  tab={tab}
                  selected={selected.has(item.id)}
                  onSelect={(v) =>
                    setSelected((s) => {
                      const next = new Set(s)
                      if (v) next.add(item.id)
                      else next.delete(item.id)
                      return next
                    })
                  }
                  onAct={(a) => void act([item.id], a)}
                  onPin={() => void pin(item)}
                  onBan={(b) => item.author.userId && void ban(item.author.userId, b)}
                  canBan={!!item.author.userId && item.author.role !== 'admin' && (item.author.role !== 'manager' || viewerRole === 'admin')}
                  busy={busy}
                />
              ))
            ) : (
              <EmptyState className="q-empty" icon="check" title="这里没有评论">
                {tab === 'pending' ? '待审核的评论都处理完了。' : '换个标签页看看。'}
              </EmptyState>
            )}
            {queue.nextCursor ? (
              <div className="loadmore">
                <Button size="sm" disabled={busy} onClick={() => void loadTab(tab, queue.nextCursor)}>
                  加载更多
                </Button>
              </div>
            ) : null}
          </div>
        </section>
        <RulesPanel settings={settings} onChange={setSettings} onUnban={(id) => void ban(id, false)} />
      </div>
    </>
  )
}

interface QueueCardProps {
  item: QueueItem
  tab: QueueTab
  selected: boolean
  onSelect: (v: boolean) => void
  onAct: (a: ModerateAction) => void
  onPin: () => void
  onBan: (banned: boolean) => void
  canBan: boolean
  busy: boolean
}

function QueueCard({ item, tab, selected, onSelect, onAct, onPin, onBan, canBan, busy }: QueueCardProps) {
  const deleted = item.status === 'deleted' || item.deletedAt != null
  const acts: ReactNode[] = []
  const btn = (a: ModerateAction, label: string, icon: 'check' | 'ban' | 'trash' | 'refresh') => (
    <Button key={a} size="xs" icon={icon} disabled={busy} onClick={() => onAct(a)}>
      {label}
    </Button>
  )
  if (deleted) {
    if (!item.authorDeleted) acts.push(btn('restore', '恢复', 'refresh'))
  } else {
    if (item.status !== 'published' || item.reports.open > 0) acts.push(btn('approve', tab === 'reported' && item.status === 'published' ? '保留' : '通过', 'check'))
    if (item.status !== 'spam') acts.push(btn('spam', '垃圾', 'ban'))
    acts.push(btn('delete', '删除', 'trash'))
    if (item.status === 'published' && item.rootId == null) {
      acts.push(
        <Button key="pin" size="xs" icon="pin" variant={item.pinned ? 'sun' : 'default'} disabled={busy} onClick={onPin}>
          {item.pinned ? '取消置顶' : '置顶'}
        </Button>,
      )
    }
  }
  if (canBan) {
    acts.push(
      <Button key="ban" size="xs" variant="ghost" icon="ban" onClick={() => onBan(!item.author.banned)}>
        {item.author.banned ? '解除禁言' : '禁止评论'}
      </Button>,
    )
  }
  return (
    <div className={cx('qcard', selected && 'is-sel')}>
      <div className="head">
        <Check checked={selected} onChange={onSelect}>
          <span className="sr">选择这条评论</span>
        </Check>
        <Avatar name={item.author.name} src={item.author.avatarUrl} color={item.author.color} size="sm" />
      </div>
      <div>
        <div className="cmt-h">
          <b>{item.author.name}</b>
          {item.author.guest ? <span className="role guest">游客</span> : null}
          {item.badge ? <span className={cx('role', item.badge === 'artist' ? 'artist' : 'staff')}>{BADGE_LABELS[item.badge]}</span> : null}
          {item.author.banned ? <span className="role pend">已禁言</span> : null}
          <time dateTime={item.createdAt} title={fullTime(item.createdAt)}>
            {relTime(item.createdAt)}
          </time>
          <span className="where">
            {item.rootId ? '回复于' : '评论于'}「{item.thread.href ? <a href={`${item.thread.href}#c-${item.id}`}>{item.thread.title}</a> : item.thread.title}」
          </span>
        </div>
        <div className="cmt-b" style={{ marginTop: 4 }}>
          {/* server-rendered (src/server/comments/render.ts) */}
          <div dangerouslySetInnerHTML={{ __html: item.html }} />
        </div>
        {item.reasons.length ? (
          <div className="why">
            {item.reasons.map((r) => (
              <span key={r} className={r === 'reported' ? 'rep' : undefined}>
                {r === 'reported' ? `被举报 ${item.reports.open}` : HOLD_REASON_LABELS[r]}
              </span>
            ))}
          </div>
        ) : null}
        <div className="hint mono" style={{ marginTop: 4 }}>
          {item.ipHash ? `IP 哈希 ${item.ipHash} · ${item.ipHistory ? `此前 ${item.ipHistory} 条已公开` : '首次出现'}` : '无 IP 记录'}
          {item.reports.reasons.length ? ` · 举报原因：${item.reports.reasons.join('、')}` : ''}
          {item.editedAt ? ' · 已编辑' : ''}
          {item.authorDeleted ? ' · 作者已删除，不能恢复' : ''}
        </div>
      </div>
      <div className="acts">{acts}</div>
    </div>
  )
}

function RulesPanel({ settings, onChange, onUnban }: { settings: CommentSettingsView; onChange: (s: CommentSettingsView) => void; onUnban: (id: string) => void }) {
  const s = settings.settings
  const [word, setWord] = useState('')
  const [edit, setEdit] = useState(String(s.editWindowMinutes))
  const [threshold, setThreshold] = useState(String(s.reportThreshold))
  const [reactions, setReactions] = useState<Record<ReactionKey, string>>(
    () => Object.fromEntries(REACTION_KEYS.map((k) => [k, s.reactionStickers[k] ?? ''])) as Record<ReactionKey, string>,
  )

  async function save(patch: Parameters<typeof saveCommentSettingsFn>[0]['data'], ok = '已保存') {
    try {
      const next = await saveCommentSettingsFn({ data: patch })
      onChange(next)
      setEdit(String(next.settings.editWindowMinutes))
      setThreshold(String(next.settings.reportThreshold))
      toast({ message: ok, icon: 'check' })
    } catch (err) {
      toast({ message: errorMessage(err, '保存失败'), icon: 'warn' })
    }
  }

  function addWord() {
    const w = word.trim()
    if (!w) return
    setWord('')
    void save({ blocklist: [...s.blocklist, w] }, `已添加屏蔽词「${w}」`)
  }

  const num = (v: string, min: number, max: number) => {
    const n = Number(v)
    return Number.isInteger(n) && n >= min && n <= max ? n : null
  }

  return (
    <section className="panel">
      <div className="panel-h">
        <h3>审核规则</h3>
      </div>
      <div className="panel-b">
        <div className="rule-row">
          <div>
            <b>新用户首条评论需审核</b>
            <small>账号或游客 IP 第一次发言时进入队列</small>
          </div>
          <Switch checked={s.firstCommentReview} onCheckedChange={(v) => void save({ firstCommentReview: v })} />
        </div>
        <div className="rule-row">
          <div>
            <b>允许游客评论</b>
            <small>游客必须通过 Cap 人机验证；登录用户免验证</small>
          </div>
          <Switch checked={s.guestsAllowed} onCheckedChange={(v) => void save({ guestsAllowed: v })} />
        </div>
        <div className="rule-row">
          <div>
            <b>评论里可以发贴纸</b>
            <small>每条最多 {MAX_STICKERS} 张，只能用已发布的表情</small>
          </div>
          <Switch checked={s.stickersAllowed} onCheckedChange={(v) => void save({ stickersAllowed: v })} />
        </div>
        <div className="rule-row">
          <div>
            <b>含 2 个以上链接进入队列</b>
            <small>始终开启；链接一律加 nofollow ugc</small>
          </div>
          <Switch checked disabled />
        </div>
        <div className="rule-row">
          <div>
            <b>编辑时限</b>
            <small>作者在发布后多少分钟内可以修改；删除保留墓碑</small>
          </div>
          <span className="rule-num">
            <Input
              size="sm"
              inputMode="numeric"
              aria-label="编辑时限（分钟）"
              value={edit}
              onChange={(e) => setEdit(e.currentTarget.value)}
              onBlur={() => {
                const n = num(edit, 0, 1440)
                if (n == null) setEdit(String(s.editWindowMinutes))
                else if (n !== s.editWindowMinutes) void save({ editWindowMinutes: n })
              }}
            />
            分钟
          </span>
        </div>
        <div className="rule-row">
          <div>
            <b>举报阈值</b>
            <small>未处理的举报达到这个数，评论先隐藏、回到待审核</small>
          </div>
          <span className="rule-num">
            <Input
              size="sm"
              inputMode="numeric"
              aria-label="举报阈值"
              value={threshold}
              onChange={(e) => setThreshold(e.currentTarget.value)}
              onBlur={() => {
                const n = num(threshold, 1, 100)
                if (n == null) setThreshold(String(s.reportThreshold))
                else if (n !== s.reportThreshold) void save({ reportThreshold: n })
              }}
            />
            次
          </span>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <div className="lab">
            屏蔽词<small> 不区分大小写，忽略空格；* 匹配任意字符</small>
          </div>
          <Chips>
            {s.blocklist.map((w) => (
              <Chip key={w} size="sm" removable aria-label={`移除屏蔽词 ${w}`} onClick={() => void save({ blocklist: s.blocklist.filter((x) => x !== w) }, `已移除「${w}」`)}>
                {w}
              </Chip>
            ))}
            {!s.blocklist.length ? <span className="hint">还没有屏蔽词</span> : null}
          </Chips>
          <form
            className="blk-add"
            onSubmit={(e) => {
              e.preventDefault()
              addWord()
            }}
          >
            <Input size="sm" placeholder="例如：代练、加群*" aria-label="新的屏蔽词" maxLength={40} value={word} onChange={(e) => setWord(e.currentTarget.value)} />
            <Button size="sm" type="submit" icon="plus" disabled={!word.trim()}>
              添加
            </Button>
          </form>
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <div className="lab">
            回应贴纸<small> 评论下的 6 个回应；填表情 ID，留空显示文字</small>
          </div>
          <div className="react-cfg">
            {REACTION_KEYS.map((k) => {
              const st = settings.reactionStickers[k]
              return (
                <div className="row" key={k}>
                  <span>{REACTION_LABELS[k]}</span>
                  {st ? <img src={st.poster} alt="" width={32} height={32} /> : <span className="ph" />}
                  <Input
                    size="sm"
                    placeholder="r-…"
                    aria-label={`${REACTION_LABELS[k]} 的表情 ID`}
                    value={reactions[k]}
                    onChange={(e) => setReactions({ ...reactions, [k]: e.currentTarget.value.trim() })}
                  />
                </div>
              )
            })}
            <Button
              size="sm"
              onClick={() =>
                void save({ reactionStickers: Object.fromEntries(REACTION_KEYS.map((k) => [k, reactions[k] || null])) }, '回应贴纸已保存')
              }
            >
              保存回应贴纸
            </Button>
          </div>
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <div className="lab">
            禁止评论<small> 只禁评论；封禁账号在「用户与权限」由站长处理</small>
          </div>
          <div className="ban-list">
            {settings.banned.length ? (
              settings.banned.map((u) => (
                <Chip key={u.id} size="sm" removable aria-label={`解除 ${u.name} 的禁止评论`} onClick={() => onUnban(u.id)}>
                  {u.name}
                </Chip>
              ))
            ) : (
              <span className="hint">没有被禁止评论的用户</span>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
