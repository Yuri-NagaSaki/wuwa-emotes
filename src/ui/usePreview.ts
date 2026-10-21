import { useEffect, useId, useRef, useState, type FocusEvent, type PointerEvent, type RefObject } from 'react'
import { usePreviewsAllowed } from './motion'
import { createPlaybackLimiter } from './playback'

// One limiter for the whole page: at most 4 animated previews at once.
const limiter = createPlaybackLimiter(4)

// One IntersectionObserver for every tile. The band is the middle 30% of the viewport height.
let band: IntersectionObserver | null = null
const bandCallbacks = new WeakMap<Element, (inBand: boolean) => void>()

function observeBand(el: Element, cb: (inBand: boolean) => void) {
  band ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) bandCallbacks.get(e.target)?.(e.isIntersecting)
    },
    { rootMargin: '-35% 0px -35% 0px', threshold: 0 },
  )
  bandCallbacks.set(el, cb)
  band.observe(el)
  return () => {
    band?.unobserve(el)
    bandCallbacks.delete(el)
  }
}

// Autoplay (the middle band) waits until the posters on screen have loaded: an a160 preview is 60–130 KB,
// about ten posters' worth, and starting four of them right after a navigation took 35–45% of the
// image bytes while the page's own posters were still arriving. Hover and focus never wait.
// It also waits until scrolling pauses: a tile crosses the band in a fraction of a second during a fast
// scroll, and starting previews on the way loaded ~120 a160 files (≈ 10 MB at production sizes) for one
// scroll down a 330-sticker pack and back on desktop, with frames of 150–220 ms at 4× CPU.
const SETTLE_MAX_MS = 6000
const SCROLL_IDLE_MS = 200
const settleWaiters = new Set<() => void>()
let settleTimer: ReturnType<typeof setTimeout> | undefined
let settleSince = 0
let lastScroll = -Infinity
let scrollTracked = false

function trackScroll() {
  if (scrollTracked) return
  scrollTracked = true
  addEventListener(
    'scroll',
    () => {
      lastScroll = performance.now()
    },
    { passive: true, capture: true },
  )
}

function scrolling(): boolean {
  return performance.now() - lastScroll < SCROLL_IDLE_MS
}

function postersPendingInView(): boolean {
  const vh = innerHeight
  for (const img of document.images) {
    if (img.complete) continue
    const r = img.getBoundingClientRect()
    if (r.width > 0 && r.bottom > 0 && r.top < vh) return true
  }
  return false
}

function checkSettled() {
  settleTimer = undefined
  if (!settleWaiters.size) return
  // still scrolling: the band's tiles are passing through, not being looked at (no time limit)
  if (scrolling()) {
    settleSince = performance.now()
    settleTimer = setTimeout(checkSettled, SCROLL_IDLE_MS)
    return
  }
  if (postersPendingInView() && performance.now() - settleSince < SETTLE_MAX_MS) {
    settleTimer = setTimeout(checkSettled, 250)
    return
  }
  const run = [...settleWaiters]
  settleWaiters.clear()
  for (const fn of run) fn()
}

/**
 * Run `fn` once scrolling has paused and the posters in the viewport have loaded (or SETTLE_MAX_MS after
 * scrolling paused); returns a cancel.
 */
function whenPostersLoaded(fn: () => void): () => void {
  trackScroll()
  if (!settleWaiters.size) settleSince = performance.now()
  settleWaiters.add(fn)
  settleTimer ??= setTimeout(checkSettled, 120)
  return () => {
    settleWaiters.delete(fn)
  }
}

export interface AnimatedPreview<E extends HTMLElement> {
  ref: RefObject<E | null>
  /** The poster, or the preview once it is granted a slot and decoded. */
  src: string
  playing: boolean
  handlers: {
    onPointerEnter: (e: PointerEvent<E>) => void
    onPointerLeave: () => void
    onFocus: () => void
    onBlur: (e: FocusEvent<E>) => void
  }
}

/**
 * Swap a static poster (p240) for its animated preview (a160) on hover/focus or while the element is in
 * the middle of the viewport, within the page-wide limit. The preview is fetched and decoded off-DOM
 * before it replaces the poster, so the tile never flashes blank. Items without a preview never swap.
 */
export function useAnimatedPreview<E extends HTMLElement>(poster: string, preview?: string | null): AnimatedPreview<E> {
  const id = useId()
  const ref = useRef<E>(null)
  const allowed = usePreviewsAllowed()
  const enabled = allowed && Boolean(preview)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState<string | null>(null)
  const hovered = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    let cancelWait: (() => void) | null = null
    const stop = observeBand(el, (inBand) => {
      cancelWait?.()
      cancelWait = null
      if (inBand) cancelWait = whenPostersLoaded(() => limiter.want(id, 'view', true, setPlaying))
      else limiter.want(id, 'view', false, setPlaying)
    })
    return () => {
      cancelWait?.()
      stop()
      limiter.forget(id)
      setPlaying(false)
    }
  }, [enabled, id])

  useEffect(() => {
    if (!playing || !preview || ready === preview) return
    let cancelled = false
    const img = new Image()
    img.decoding = 'async'
    // autoplay stays below the page's posters and the dialog image; a hovered tile asks normally
    img.fetchPriority = hovered.current ? 'auto' : 'low'
    img.src = preview
    img.decode().then(
      () => !cancelled && setReady(preview),
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [playing, preview, ready])

  const hover = (on: boolean) => {
    hovered.current = on
    if (enabled) limiter.want(id, 'hover', on, setPlaying)
  }

  return {
    ref,
    src: enabled && playing && preview && ready === preview ? preview : poster,
    playing: enabled && playing,
    handlers: {
      onPointerEnter: (e) => {
        if (e.pointerType === 'mouse') hover(true)
      },
      onPointerLeave: () => hover(false),
      onFocus: () => hover(true),
      onBlur: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hover(false)
      },
    },
  }
}
