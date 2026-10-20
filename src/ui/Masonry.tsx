import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from './cx'
import { laneLeft, masonryColumns } from './masonry-layout'

// useLayoutEffect warns during SSR; this is a no-op there.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
// Container width at the 760px breakpoint (viewport minus the 16px phone gutters).
const PHONE_MAX_WIDTH = 760 - 32

export interface MasonryProps<T> {
  items: readonly T[]
  getKey: (item: T, index: number) => string | number
  /** Exact item height for a lane width: stored media width/height × lane width + fixed chrome. */
  getHeight: (item: T, laneWidth: number) => number
  renderItem: (item: T, index: number, laneWidth: number) => ReactNode
  minColumnWidth?: number
  /** Phone (≤760px) minimum lane width. */
  minColumnWidthPhone?: number
  maxLanes?: number
  gap?: number
  gapPhone?: number
  /**
   * Container width assumed on the server and in the first client render, so the server HTML and the
   * hydrated markup agree. The real width is measured right after mount; if it gives a different lane
   * count the grid is laid out again once.
   */
  ssrWidth?: number
  overscan?: number
  /** Called when the last rows come into range (infinite loading). */
  onEndReached?: () => void
  /** Let the DOM correct heights (for cards whose text height varies). Can shift once per item. */
  measure?: boolean
  className?: string
  label?: string
}

/** Window-virtualized masonry (TanStack Virtual `lanes`). Items are absolutely positioned. */
export function Masonry<T>({
  items,
  getKey,
  getHeight,
  renderItem,
  minColumnWidth = 248,
  minColumnWidthPhone = 150,
  maxLanes = 6,
  gap = 20,
  gapPhone = 12,
  ssrWidth = 1176,
  overscan = 6,
  onEndReached,
  measure = false,
  className,
  label,
}: MasonryProps<T>) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(ssrWidth)
  const [scrollMargin, setScrollMargin] = useState(0)

  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      setWidth(el.clientWidth)
      setScrollMargin(el.getBoundingClientRect().top + window.scrollY)
    }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const phone = width <= PHONE_MAX_WIDTH
  const g = phone ? gapPhone : gap
  const { lanes, laneWidth } = masonryColumns(width, { minColumnWidth: phone ? minColumnWidthPhone : minColumnWidth, gap: g, maxLanes })

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: (i) => getHeight(items[i]!, laneWidth),
    getItemKey: (i) => getKey(items[i]!, i),
    lanes,
    gap: g,
    overscan,
    scrollMargin,
    laneAssignmentMode: 'estimate',
    initialRect: { width: ssrWidth, height: 900 },
  })

  // Heights depend on the lane width: recompute every position when it changes.
  useIsoLayoutEffect(() => {
    virtualizer.measure()
  }, [virtualizer, laneWidth, lanes, items])

  const virtualItems = virtualizer.getVirtualItems()
  const last = virtualItems[virtualItems.length - 1]
  const nearEnd = last != null && last.index >= items.length - lanes * 2
  useEffect(() => {
    if (nearEnd) onEndReached?.()
  }, [nearEnd, items.length, onEndReached])

  return (
    <div
      ref={ref}
      className={cx('vmasonry', className)}
      style={{ position: 'relative', height: virtualizer.getTotalSize() }}
      role="list"
      aria-label={label}
    >
      {virtualItems.map((vi) => {
        const item = items[vi.index]!
        return (
          <div
            key={vi.key}
            role="listitem"
            data-index={vi.index}
            ref={measure ? virtualizer.measureElement : undefined}
            style={{
              position: 'absolute',
              top: 0,
              left: laneLeft(vi.lane, laneWidth, g),
              width: laneWidth,
              height: measure ? undefined : vi.size,
              transform: `translateY(${vi.start - scrollMargin}px)`,
            }}
          >
            {renderItem(item, vi.index, laneWidth)}
          </div>
        )
      })}
    </div>
  )
}
