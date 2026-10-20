import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cx } from '../cx'

// A square-tile CSS grid (.grid-tiles) that only mounts the rows near the viewport once the page is
// interactive. CSS keeps doing the layout (auto-fill columns, square tiles); the script reads the
// column count and row height from the rendered grid and pads the skipped rows, so the rows it keeps
// sit exactly where the full grid would put them. The server renders every item of the first page.

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

interface Geometry {
  cols: number
  rowH: number
  /** grid top relative to the viewport, and the viewport height */
  top: number
  vh: number
}

export interface WindowedGridProps {
  items: readonly ReactNode[]
  className?: string
  /** rows kept above and below the viewport */
  overscanRows?: number
  onEndReached?: () => void
  label?: string
}

export function WindowedGrid({ items, className, overscanRows = 4, onEndReached, label }: WindowedGridProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [geo, setGeo] = useState<Geometry | null>(null)

  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let frame = 0
    const read = () => {
      frame = 0
      const cs = getComputedStyle(el)
      const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length || 1
      const gap = parseFloat(cs.rowGap) || 0
      const inner = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
      const tile = (inner - gap * (cols - 1)) / cols
      const r = el.getBoundingClientRect()
      const next = { cols, rowH: tile + gap, top: r.top, vh: innerHeight }
      setGeo((p) => (p && p.cols === next.cols && Math.abs(p.rowH - next.rowH) < 0.01 && p.top === next.top && p.vh === next.vh ? p : next))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }
    read()
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    addEventListener('scroll', schedule, { passive: true })
    addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      removeEventListener('scroll', schedule)
      removeEventListener('resize', schedule)
    }
  }, [])

  let from = 0
  let to = items.length
  let padTop = 0
  let padBottom = 0
  let nearEnd = false
  if (geo && geo.rowH > 0) {
    const rows = Math.ceil(items.length / geo.cols)
    const r0 = Math.max(0, Math.floor(-geo.top / geo.rowH) - overscanRows)
    const r1 = Math.min(rows - 1, Math.ceil((-geo.top + geo.vh) / geo.rowH) + overscanRows)
    from = r0 * geo.cols
    to = Math.min(items.length, (r1 + 1) * geo.cols)
    padTop = r0 * geo.rowH
    padBottom = Math.max(0, (rows - 1 - r1) * geo.rowH)
    nearEnd = r1 >= rows - 3
  }

  useEffect(() => {
    if (nearEnd) onEndReached?.()
  }, [nearEnd, items.length, onEndReached])

  return (
    <div ref={ref} className={cx('grid-tiles', className)} style={{ paddingTop: padTop, paddingBottom: padBottom } as CSSProperties} role="list" aria-label={label}>
      {items.slice(from, to).map((node, k) => (
        <div role="listitem" key={from + k} style={{ display: 'contents' }}>
          {node}
        </div>
      ))}
    </div>
  )
}
