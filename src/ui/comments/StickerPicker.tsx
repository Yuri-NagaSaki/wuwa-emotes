import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { suggestFn } from '#/server/catalog/fns'
import type { Suggestion } from '#/server/catalog/types'
import { MAX_STICKERS } from '#/server/comments/constants'
import { stickerSourceFn } from '#/server/comments/fns'
import type { Sticker } from '#/server/comments/types'
import { Chip } from '../Chip'
import { cx } from '../cx'
import { Input } from '../Field'
import { Icon } from '../Icon'
import { Sheet } from '../Sheet'
import { errorMessage, recentStickers, replaceRecent } from './util'

// 插入贴纸: 最近使用 (this browser), 本包 (the current pack), 搜索 (catalog suggestions → a pack's or a
// character's stickers). Every list comes from stickerSourceFn, which applies the same filter as the
// server-side check, so whatever is offered can be posted. A popover on desktop, a bottom sheet on phones.

type Tab = 'recent' | 'pack' | 'search'

export interface StickerPickerProps {
  open: boolean
  onClose: () => void
  onPick: (sticker: Sticker) => void
  /** Stickers already chosen (marked in the grid). */
  picked: readonly Sticker[]
  /** How many more fit (MAX_STICKERS minus chosen and typed markers). */
  remaining: number
  /** The pack behind the thread (本包), if any. */
  packId?: number | null
  /** Its stickers when the page already has them (skips a request). */
  packStickers?: readonly Sticker[] | null
  phone: boolean
  /** The toggle button: clicks on it are not "outside". */
  anchorRef?: RefObject<HTMLElement | null>
}

const SEARCH_TYPES = new Set(['pack', 'character'])

export function StickerPicker(props: StickerPickerProps) {
  const { open, onClose, phone } = props
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || phone) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || props.anchorRef?.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, phone, onClose, props.anchorRef])

  if (!open) return null
  if (phone) {
    return (
      <Sheet open onOpenChange={(v) => !v && onClose()} title="插入贴纸" subtitle={`点选插入，每条最多 ${MAX_STICKERS} 张`} className="picker-sheet">
        <PickerBody {...props} />
      </Sheet>
    )
  }
  return (
    <div ref={ref} className="pop picker is-pop" role="dialog" aria-label="插入贴纸">
      <PickerBody {...props} />
      <div className="picker-f">
        <span>点选插入，每条最多 {MAX_STICKERS} 张</span>
        <span>贴纸按表情 ID 保存</span>
      </div>
    </div>
  )
}

function PickerBody({ onPick, picked, remaining, packId, packStickers }: StickerPickerProps) {
  const hasPack = !!(packStickers?.length || packId)
  const [recent, setRecent] = useState<Sticker[]>(() => recentStickers())
  const [tab, setTab] = useState<Tab>(() => (recent.length ? 'recent' : hasPack ? 'pack' : 'search'))
  const [pack, setPack] = useState<Sticker[] | null>(packStickers?.length ? [...packStickers] : null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Suggestion[] | null>(null)
  const [hit, setHit] = useState<Suggestion | null>(null)
  const [found, setFound] = useState<Sticker[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const checkedRecent = useRef(false)

  // 最近使用: re-validate once per open (a sticker may have been hidden since)
  useEffect(() => {
    if (tab !== 'recent' || checkedRecent.current || !recent.length) return
    checkedRecent.current = true
    stickerSourceFn({ data: { kind: 'ids', ids: recent.map((s) => s.id) } })
      .then((list) => {
        setRecent(list)
        replaceRecent(list)
      })
      .catch(() => undefined)
  }, [tab, recent])

  useEffect(() => {
    if (tab !== 'pack' || pack || !packId) return
    stickerSourceFn({ data: { kind: 'pack', packId } })
      .then(setPack)
      .catch((err) => setError(errorMessage(err)))
  }, [tab, pack, packId])

  useEffect(() => {
    const query = q.trim()
    if (tab !== 'search' || !query) {
      setHits(null)
      return
    }
    let alive = true
    const timer = setTimeout(() => {
      suggestFn({ data: { q: query, limit: 8 } })
        .then((list) => {
          if (!alive) return
          const usable = list.filter((s) => SEARCH_TYPES.has(s.type))
          setHits(usable)
          if (usable[0]) choose(usable[0])
          else setFound([])
        })
        .catch((err) => alive && setError(errorMessage(err)))
    }, 250)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [q, tab])

  function choose(s: Suggestion) {
    setHit(s)
    setFound(null)
    const data = s.type === 'pack' ? ({ kind: 'pack', slug: s.slug } as const) : ({ kind: 'character', slug: s.slug } as const)
    stickerSourceFn({ data })
      .then(setFound)
      .catch((err) => setError(errorMessage(err)))
  }

  const list: Sticker[] | null = tab === 'recent' ? recent : tab === 'pack' ? pack : found
  const pickedIds = new Set(picked.map((s) => s.id))

  let note: ReactNode = null
  if (error) note = error
  else if (tab === 'recent' && !recent.length) note = '还没有用过贴纸。去「本包」或「搜索」挑一张吧'
  else if (tab === 'search' && !q.trim()) note = '输入角色名或表情包名，例如：爱弥斯、守岸人'
  else if (tab === 'search' && hits && !hits.length) note = '没有找到相关的表情包或角色'
  else if (list === null) note = '加载中…'
  else if (!list.length) note = '这里还没有可用的贴纸'

  return (
    <>
      <div className="picker-h">
        {tab === 'search' ? (
          <Input
            size="sm"
            icon="search"
            placeholder="搜索贴纸：角色、表情包"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            aria-label="搜索贴纸"
            autoFocus
          />
        ) : null}
        <div className="picker-tabs" role="tablist" aria-label="贴纸来源">
          <TabButton on={tab === 'recent'} onClick={() => setTab('recent')} icon={<Icon name="clock" size="sm" />}>
            最近使用
          </TabButton>
          {hasPack ? (
            <TabButton on={tab === 'pack'} onClick={() => setTab('pack')} icon={pack?.[0] ? <img src={pack[0].poster} alt="" /> : <Icon name="box" size="sm" />}>
              本包
            </TabButton>
          ) : null}
          <TabButton on={tab === 'search'} onClick={() => setTab('search')} icon={<Icon name="search" size="sm" />}>
            搜索
          </TabButton>
        </div>
      </div>
      {tab === 'search' && hits?.length ? (
        <div className="picker-hits">
          {hits.map((h) => (
            <Chip
              key={`${h.type}:${h.slug}`}
              size="sm"
              on={hit?.slug === h.slug && hit.type === h.type}
              avatar={h.image ? { src: h.image, color: h.color ?? undefined } : null}
              onClick={() => choose(h)}
            >
              {h.label}
            </Chip>
          ))}
        </div>
      ) : null}
      {note ? (
        <div className="picker-note">{note}</div>
      ) : (
        <div className="picker-grid">
          {list!.map((s) => (
            <button
              key={s.id}
              type="button"
              className={cx(pickedIds.has(s.id) && 'is-picked')}
              disabled={remaining <= 0}
              onClick={() => onPick(s)}
              aria-label="插入贴纸"
              title={remaining <= 0 ? `每条最多 ${MAX_STICKERS} 张` : undefined}
            >
              <img src={s.poster} width={s.width} height={s.height} loading="lazy" decoding="async" alt="" />
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function TabButton({ on, onClick, icon, children }: { on: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={on} className={cx(on && 'is-on')} onClick={onClick}>
      {icon}
      {children}
    </button>
  )
}
