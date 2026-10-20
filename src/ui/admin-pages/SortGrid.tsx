import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { PackEmoji } from '#/server/admin/types'
import { cx } from '../cx'
import { Icon } from '../Icon'
import { Thumb } from './bits'

// 表情排序: drag the handle (mouse, pen or touch), or with the keyboard focus a sticker, press Space to
// pick it up, move it with the arrow keys (Home / End for the ends), Space to drop, Esc to cancel.
// The order is local until the editor saves it.

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]
  const [it] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(next.length, to)), 0, it!)
  return next
}

export function SortGrid({
  items,
  order,
  onOrder,
  coverId,
  selected,
  onToggle,
}: {
  items: Map<string, PackEmoji>
  order: string[]
  onOrder: (ids: string[]) => void
  coverId: string | null
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  const grid = useRef<HTMLDivElement>(null)
  const [grabbed, setGrabbed] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [before, setBefore] = useState<string[] | null>(null)
  const [say, setSay] = useState('')

  function columns(): number {
    const els = grid.current?.querySelectorAll<HTMLElement>('.sort-it')
    if (!els?.length) return 1
    const top = els[0]!.offsetTop
    let n = 0
    for (const el of els) if (el.offsetTop === top) n++
    return Math.max(1, n)
  }

  function focusItem(id: string) {
    requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus())
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>, id: string) {
    const i = order.indexOf(id)
    if (e.key === ' ' || e.key === 'Enter') {
      if ((e.target as HTMLElement).closest('.sel-box')) return
      e.preventDefault()
      if (grabbed === id) {
        setGrabbed(null)
        setBefore(null)
        setSay(`已放下，现在是第 ${i + 1} 张`)
      } else {
        setGrabbed(id)
        setBefore(order)
        setSay(`已拿起第 ${i + 1} 张。用方向键移动，空格放下，Esc 取消`)
      }
      return
    }
    if (e.key === 'Escape' && grabbed) {
      e.preventDefault()
      if (before) onOrder(before)
      setGrabbed(null)
      setBefore(null)
      setSay('已取消移动')
      focusItem(id)
      return
    }
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns(), ArrowDown: columns() }
    let to: number | null = null
    if (e.key in step) to = i + step[e.key]!
    if (e.key === 'Home') to = 0
    if (e.key === 'End') to = order.length - 1
    if (to == null) return
    e.preventDefault()
    to = Math.max(0, Math.min(order.length - 1, to))
    if (grabbed === id) {
      onOrder(move(order, i, to))
      setSay(`第 ${to + 1} 张`)
      focusItem(id)
    } else {
      focusItem(order[to]!)
    }
  }

  function onPointerDown(e: PointerEvent<HTMLButtonElement>, id: string) {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(id)
    setBefore(order)
  }

  function onPointerMove(e: PointerEvent<HTMLButtonElement>, id: string) {
    if (dragging !== id) return
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.sort-it[data-id]')
    const over = el?.dataset.id
    if (!over || over === id) return
    onOrder(move(order, order.indexOf(id), order.indexOf(over)))
  }

  function onPointerUp(id: string) {
    if (dragging !== id) return
    setDragging(null)
    setBefore(null)
    setSay(`已移动到第 ${order.indexOf(id) + 1} 张`)
  }

  return (
    <>
      <div className="sort-grid" ref={grid} role="list" aria-label="表情顺序">
        {order.map((id, i) => {
          const e = items.get(id)
          if (!e) return null
          return (
            <div
              key={id}
              role="listitem"
              data-id={id}
              tabIndex={0}
              aria-label={`第 ${i + 1} 张，${e.format.toUpperCase()}${e.status !== 'published' ? (e.status === 'pending' ? '，待审核' : '，已隐藏') : ''}${coverId === id ? '，封面' : ''}`}
              aria-grabbed={grabbed === id || dragging === id}
              className={cx(
                'sort-it',
                coverId === id && 'is-cover',
                (dragging === id || grabbed === id) && 'is-drag is-grab',
                selected.has(id) && 'is-sel',
                e.status === 'hidden' && 'is-hidden',
              )}
              onKeyDown={(ev) => onKey(ev, id)}
            >
              <button
                type="button"
                className="h"
                tabIndex={-1}
                aria-hidden="true"
                onPointerDown={(ev) => onPointerDown(ev, id)}
                onPointerMove={(ev) => onPointerMove(ev, id)}
                onPointerUp={() => onPointerUp(id)}
                onPointerCancel={() => onPointerUp(id)}
              >
                <Icon name="drag" />
              </button>
              {coverId === id ? (
                <span className="star" aria-hidden="true">
                  <Icon name="star" />
                </span>
              ) : null}
              <Thumb src={e.thumb} size={92} />
              {e.status !== 'published' ? <span className={cx('flag-st', e.status)}>{e.status === 'pending' ? '待审' : '隐藏'}</span> : null}
              <span className="ix">{i + 1}</span>
              <button type="button" className="sel-box" aria-pressed={selected.has(id)} aria-label={`选择第 ${i + 1} 张`} onClick={() => onToggle(id)}>
                <Icon name="check" />
              </button>
            </div>
          )
        })}
      </div>
      <span className="sr" aria-live="polite">
        {say}
      </span>
    </>
  )
}
