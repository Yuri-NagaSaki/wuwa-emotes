import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cx } from './cx'
import {
  allLayouts,
  containerVars,
  itemVars,
  lanesFor,
  laneCounts,
  laneWidthFor,
  MASONRY_MODES,
  type MasonryModeName,
  type Shape,
} from './masonry-layout'
import { PHONE_QUERY } from './useMediaQuery'

// useLayoutEffect warns during SSR; this is a no-op there.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface MasonryProps<T> {
  items: readonly T[]
  getKey: (item: T, index: number) => string | number
  /**
   * Exact item height as a function of the lane width: ratio × laneWidth + chrome (per mode). Media
   * sizes come from the database, text rows must have fixed heights (see packCardShape).
   */
  getShape: (item: T, index: number) => Shape
  renderItem: (item: T, index: number) => ReactNode
  /** Rendered off-screen margin, in viewport heights (client only; the server renders everything). */
  overscan?: number
  /** Only lists longer than this are windowed (default 48). */
  windowFrom?: number
  /** Called when the end of the list comes within ~1.5 viewports (infinite loading). */
  onEndReached?: () => void
  className?: string
  label?: string
}

interface Viewport {
  phone: boolean
  width: number
  /** container top relative to the viewport, and the viewport height */
  top: number
  height: number
}

/**
 * Window-scrolled masonry with a layout that is identical on the server and the client. Items are
 * absolutely positioned by CSS from per-item custom properties (masonry-layout.ts), so nothing shifts
 * on hydration, resize or image load. After mount, only items near the viewport are rendered.
 */
export function Masonry<T>({ items, getKey, getShape, renderItem, overscan = 1, windowFrom = 48, onEndReached, className, label }: MasonryProps<T>) {
  const ref = useRef<HTMLDivElement>(null)
  const [vp, setVp] = useState<Viewport | null>(null)
  const shapes = useMemo(() => items.map((it, i) => getShape(it, i)), [items, getShape])
  const layouts = useMemo(() => allLayouts(shapes), [shapes])

  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const mq = matchMedia(PHONE_QUERY)
    let frame = 0
    const read = () => {
      frame = 0
      const r = el.getBoundingClientRect()
      setVp((prev) => {
        const next = { phone: mq.matches, width: el.clientWidth, top: r.top, height: innerHeight }
        return prev && prev.phone === next.phone && prev.width === next.width && prev.top === next.top && prev.height === next.height ? prev : next
      })
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

  // which items are near the viewport, in the variant the CSS is showing right now (short lists are
  // rendered whole: windowing only pays off once infinite loading has grown the list)
  let visible: ((i: number) => boolean) | null = null
  const windowed = items.length > windowFrom
  let nearEnd = false
  if (vp && vp.width > 0) {
    const name: MasonryModeName = vp.phone ? 'phone' : 'desktop'
    const mode = MASONRY_MODES[name]
    const lanes = lanesFor(vp.width, mode)
    const layout = layouts[name][laneCounts(mode).indexOf(lanes)]
    if (layout) {
      const lw = laneWidthFor(vp.width, lanes, mode.gap)
      const keep = windowed
      const from = -vp.top - overscan * vp.height
      const to = -vp.top + (1 + overscan) * vp.height
      visible = (i) => {
        if (!keep) return true
        const p = layout.places[i]!
        const top = p.a * lw + p.b
        const bottom = top + shapes[i]!.ratio * lw + shapes[i]!.chrome[name]
        return bottom >= from && top <= to
      }
      const total = Math.max(0, ...layout.ends.map((e) => e.a * lw + e.b))
      nearEnd = items.length > 0 && total + vp.top < vp.height * 2.5
    }
  }

  useEffect(() => {
    if (nearEnd) onEndReached?.()
  }, [nearEnd, items.length, onEndReached])

  return (
    <div ref={ref} className={cx('vmasonry', className)}>
      <div className="vm-inner" style={containerVars(layouts) as CSSProperties} role="list" aria-label={label}>
        {items.map((item, i) =>
          visible && !visible(i) ? null : (
            <div key={getKey(item, i)} role="listitem" className="vm-it" style={itemVars(i, shapes[i]!, layouts) as CSSProperties}>
              {renderItem(item, i)}
            </div>
          ),
        )}
      </div>
    </div>
  )
}
