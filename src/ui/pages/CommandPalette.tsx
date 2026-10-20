import { Dialog } from '@base-ui/react/dialog'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { suggestFn } from '#/server/catalog/fns'
import type { Suggestion, SuggestionType } from '#/server/catalog/types'
import { cx } from '../cx'
import { tray as trayState } from '../batch/tray'
import { Icon, type IconName } from '../Icon'
import { characterColor } from './model'
import { useBatchCount } from './useBatch'

// Ctrl K command palette: instant suggestions from the in-process index (suggestFn), grouped by type,
// ↑/↓ to move, Enter to open, plus a few actions. Loaded on first open, so it costs nothing until then.

const GROUP: Record<SuggestionType, string> = { character: '角色', artist: '画师', pack: '表情包', tag: '标签' }
const ORDER: SuggestionType[] = ['character', 'artist', 'pack', 'tag']

interface Row {
  key: string
  href: string
  /** an action instead of navigating to href */
  run?: () => void
  label: ReactNode
  sub: string | null
  thumb: ReactNode
  right?: string
}

function highlight(text: string, q: string): ReactNode {
  const needle = q.trim()
  if (!needle) return text
  const i = text.toLowerCase().indexOf(needle.toLowerCase())
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + needle.length)}</mark>
      {text.slice(i + needle.length)}
    </>
  )
}

function thumbOf(s: Suggestion): ReactNode {
  if (s.image) return <img src={s.image} alt="" width={240} height={240} loading="lazy" decoding="async" />
  const icon: IconName = s.type === 'artist' ? 'edit' : s.type === 'tag' ? 'tag' : 'grid'
  return <Icon name={icon} />
}

export default function CommandPalette({ initialQuery = '', onClose }: { initialQuery?: string; onClose: () => void }) {
  const navigate = useNavigate()
  const [q, setQ] = useState(initialQuery)
  const [results, setResults] = useState<Suggestion[]>([])
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const tray = useBatchCount()

  useEffect(() => {
    const query = q.trim()
    if (!query) {
      setResults([])
      return
    }
    let stale = false
    const t = setTimeout(() => {
      suggestFn({ data: { q: query, limit: 8 } }).then(
        (r) => !stale && (setResults(r), setActive(0)),
        () => !stale && setResults([]),
      )
    }, 120)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [q])

  const groups = useMemo(() => {
    const out: { title: string; rows: Row[] }[] = []
    for (const type of ORDER) {
      const rows = results
        .filter((s) => s.type === type)
        .map((s) => ({
          key: `${s.type}:${s.slug}`,
          href: s.href,
          label: highlight(s.label, q),
          sub: s.sub,
          thumb: <span className="th" style={s.type === 'character' ? { background: `color-mix(in srgb, ${characterColor(s)} 30%, var(--tp-input))` } : undefined}>{thumbOf(s)}</span>,
          right: '↵ 打开',
        }))
      if (rows.length) out.push({ title: GROUP[type], rows })
    }
    const actions: Row[] = []
    if (q.trim()) {
      actions.push({ key: 'search', href: `/search?q=${encodeURIComponent(q.trim())}`, label: <>查看「{q.trim()}」的全部结果</>, sub: '角色、画师、表情包与标签', thumb: <span className="th"><Icon name="search" /></span> })
    }
    actions.push({ key: 'random', href: '/explore', label: '随机来一张', sub: '去探索页抽一个表情包和一张表情', thumb: <span className="th"><Icon name="sparkle" /></span> })
    actions.push({ key: 'batch', href: '/batch', run: () => trayState.open(), label: '打开打包清单', sub: `已选 ${tray} 张`, thumb: <span className="th"><Icon name="box" /></span> })
    out.push({ title: '操作', rows: actions })
    return out
  }, [results, q, tray])

  const flat = groups.flatMap((g) => g.rows)
  const go = (row: Row | undefined) => {
    if (!row) return
    onClose()
    if (row.run) row.run()
    else void navigate({ to: row.href as '/' })
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = (active + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length
      setActive(next)
      listRef.current?.querySelector(`[data-i="${next}"]`)?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(flat[active])
    }
  }

  let i = -1
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="scrim" />
        <Dialog.Viewport className="cmdk-wrap">
          <Dialog.Popup className="cmdk" aria-label="搜索">
            <Dialog.Title className="sr">搜索</Dialog.Title>
            <div className="cmdk-in">
              <Icon name="search" size="lg" />
              <input
                className="q"
                value={q}
                onChange={(e) => setQ(e.currentTarget.value)}
                onKeyDown={onKey}
                placeholder="搜索表情包、角色、画师"
                aria-label="搜索表情包、角色、画师"
                aria-controls="cmdk-list"
                aria-activedescendant={flat[active] ? `cmdk-${active}` : undefined}
                autoComplete="off"
                autoFocus
              />
              <span className="kbd">Esc</span>
            </div>
            <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
              {groups.map((g) => (
                <div key={g.title} role="group" aria-label={g.title}>
                  <div className="cmdk-g">{g.title}</div>
                  {g.rows.map((r) => {
                    i++
                    const idx = i
                    return (
                      <div
                        key={r.key}
                        id={`cmdk-${idx}`}
                        data-i={idx}
                        role="option"
                        aria-selected={idx === active}
                        className={cx('cmdk-it', idx === active && 'is-act')}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => go(r)}
                      >
                        {r.thumb}
                        <div style={{ minWidth: 0 }}>
                          {r.label}
                          {r.sub ? <small>{r.sub}</small> : null}
                        </div>
                        {r.right ? <span className="r">{r.right}</span> : null}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            <div className="cmdk-f">
              <span>
                <span className="kbd">↑</span>
                <span className="kbd">↓</span> 选择
              </span>
              <span>
                <span className="kbd">↵</span> 打开
              </span>
              <span>
                <span className="kbd">Esc</span> 关闭
              </span>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
