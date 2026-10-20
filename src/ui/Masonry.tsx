import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { cx } from './cx'
import { useHydrating } from './hydration'
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
 * on hydration, resize or image load.
 *
 * Short lists (≤ windowFrom) render every item and never read layout: no viewport state, no second
 * render, no forced layout inside the commit. Longer lists (infinite loading) render only the items
 * near the viewport; mounted by client navigation (e.g. Back to a long list) they start with none and
 * measure once in the same commit, which is cheap because the container's height comes from CSS.
 * The end of the list is watched with a sentinel (onEndReached ~1.5 viewports ahead).
 */
export function Masonry<T>({ items, getKey, getShape, renderItem, overscan = 1, windowFrom = 48, onEndReached, className, label }: MasonryProps<T>) {
  const ref = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const [vp, setVp] = useState<Viewport | null>(null)
  const shapes = useMemo(() => items.map((it, i) => getShape(it, i)), [items, getShape])
  const layouts = useMemo(() => allLayouts(shapes), [shapes])
  const itemStyles = useMemo(() => shapes.map((sh, i) => itemVars(i, sh, layouts) as CSSProperties), [shapes, layouts])
  const innerStyle = useMemo(() => containerVars(layouts) as CSSProperties, [layouts])
  const windowed = items.length > windowFrom
  // a long list mounted by client navigation renders nothing until it has measured (same commit)
  const hydrating = useHydrating()
  const [startEmpty] = useState(() => !hydrating && items.length > windowFrom)

  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el || !windowed) return
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
    // scroll/resize: render the new window before this frame paints (a restored scroll position on
    // Back jumps far past the overscan, and a deferred render would paint one empty frame)
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => flushSync(read))
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
  }, [windowed])

  // which items are near the viewport, in the variant the CSS is showing right now
  let visible: ((i: number) => boolean) | null = null
  if (windowed && vp && vp.width > 0) {
    const name: MasonryModeName = vp.phone ? 'phone' : 'desktop'
    const mode = MASONRY_MODES[name]
    const lanes = lanesFor(vp.width, mode)
    const layout = layouts[name][laneCounts(mode).indexOf(lanes)]
    if (layout) {
      const lw = laneWidthFor(vp.width, lanes, mode.gap)
      const from = -vp.top - overscan * vp.height
      const to = -vp.top + (1 + overscan) * vp.height
      visible = (i) => {
        const p = layout.places[i]!
        const top = p.a * lw + p.b
        const bottom = top + shapes[i]!.ratio * lw + shapes[i]!.chrome[name]
        return bottom >= from && top <= to
      }
    }
  } else if (windowed && startEmpty && !vp) visible = () => false

  // infinite loading: a sentinel after the list. "Near the end" = the sentinel is less than 2.5
  // viewport heights below the viewport top, including anywhere above it (a tall footer can leave the
  // end of the list above the screen at the bottom of the page).
  const endReached = useRef(onEndReached)
  endReached.current = onEndReached
  const hasEnd = Boolean(onEndReached)
  useEffect(() => {
    const el = endRef.current
    if (!el || !hasEnd) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && endReached.current?.(), {
      rootMargin: '1000000px 0px 150% 0px',
    })
    io.observe(el)
    return () => io.disconnect()
  }, [hasEnd])
  // after a page has loaded (or on mount): still near the end → the next page. One read, after paint.
  useEffect(() => {
    const el = endRef.current
    if (el && items.length && el.getBoundingClientRect().top < innerHeight * 2.5) endReached.current?.()
  }, [items.length])

  return (
    <div ref={ref} className={cx('vmasonry', className)}>
      <div className="vm-inner" style={innerStyle} role="list" aria-label={label}>
        {items.map((item, i) =>
          visible && !visible(i) ? null : (
            <div key={getKey(item, i)} role="listitem" className="vm-it" style={itemStyles[i]}>
              {renderItem(item, i)}
            </div>
          ),
        )}
      </div>
      {hasEnd ? <div ref={endRef} aria-hidden="true" /> : null}
    </div>
  )
}
