import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cx } from '../cx'
import { PHONE_QUERY } from '../useMediaQuery'
import { type CellKind, placeDense, spanOf } from './stream-layout'

// The 潮汐画廊 stream: square sticker tiles with 2×2 focus tiles, pack cards and a note, in a dense grid
// (stream-layout.ts). The server HTML lets CSS place the cells (.sgrid, pages.css). Once mounted, the
// grid reads its column count and track size and places the cells itself, at the same positions, so
// it can mount only the rows near the viewport and pad the rest.

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface StreamCell {
  key: string
  kind: CellKind
  node: ReactNode
}

interface Geometry {
  cols: number
  phone: boolean
  /** track size (a square tile) and the gap */
  track: number
  gap: number
  top: number
  vh: number
}

export interface StreamGridProps {
  cells: readonly StreamCell[]
  className?: string
  overscanRows?: number
  onEndReached?: () => void
  label?: string
}

export function StreamGrid({ cells, className, overscanRows = 4, onEndReached, label }: StreamGridProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [geo, setGeo] = useState<Geometry | null>(null)

  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const mq = matchMedia(PHONE_QUERY)
    let frame = 0
    const read = () => {
      frame = 0
      const cs = getComputedStyle(el)
      const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length || 1
      const gap = parseFloat(cs.columnGap) || 0
      const inner = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
      const track = (inner - gap * (cols - 1)) / cols
      const r = el.getBoundingClientRect()
      const next = { cols, phone: mq.matches, track, gap, top: r.top, vh: innerHeight }
      setGeo((p) => (p && p.cols === next.cols && p.phone === next.phone && Math.abs(p.track - next.track) < 0.01 && p.gap === next.gap && p.top === next.top && p.vh === next.vh ? p : next))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }
    read()
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    addEventListener('scroll', schedule, { passive: true })
    addEventListener('resize', schedule)
    mq.addEventListener('change', schedule)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      removeEventListener('scroll', schedule)
      removeEventListener('resize', schedule)
      mq.removeEventListener('change', schedule)
    }
  }, [])

  const cols = geo?.cols ?? 0
  const phone = geo?.phone ?? false
  const layout = useMemo(() => {
    if (!cols) return null
    const spans = cells.map((c) => spanOf(c.kind, cols, phone))
    return { spans, ...placeDense(spans, cols) }
  }, [cells, cols, phone])

  let content: ReactNode
  let style: CSSProperties | undefined
  let nearEnd = false
  if (geo && layout && geo.track > 0) {
    const rowH = geo.track + geo.gap
    const first = Math.max(0, Math.floor(-geo.top / rowH) - overscanRows)
    const last = Math.min(layout.rows - 1, Math.ceil((-geo.top + geo.vh) / rowH) + overscanRows)
    // cells that reach into the window; the window starts at the highest of their first rows
    const shown: number[] = []
    let r0 = first
    layout.places.forEach((p, i) => {
      const s = layout.spans[i]!
      if (p.row + s.h - 1 >= first && p.row <= last) {
        shown.push(i)
        r0 = Math.min(r0, p.row)
      }
    })
    style = { paddingTop: r0 * rowH, paddingBottom: Math.max(0, (layout.rows - 1 - last) * rowH), gridAutoRows: `${geo.track}px`, gridAutoFlow: 'row' }
    nearEnd = last >= layout.rows - 3
    content = shown.map((i) => {
      const c = cells[i]!
      const p = layout.places[i]!
      const s = layout.spans[i]!
      return (
        <div key={c.key} role="listitem" className={cx('sg-cell', `sg-${c.kind}`)} style={{ gridRow: `${p.row - r0 + 1} / span ${s.h}`, gridColumn: `${p.col + 1} / span ${s.w}` }}>
          {c.node}
        </div>
      )
    })
  } else {
    content = cells.map((c) => (
      <div key={c.key} role="listitem" className={cx('sg-cell', `sg-${c.kind}`)}>
        {c.node}
      </div>
    ))
  }

  useEffect(() => {
    if (nearEnd) onEndReached?.()
  }, [nearEnd, cells.length, onEndReached])

  return (
    <div ref={ref} className={cx('grid-tiles sgrid', className)} style={style} role="list" aria-label={label}>
      {content}
    </div>
  )
}
