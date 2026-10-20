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

  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const stop = observeBand(el, (inBand) => limiter.want(id, 'view', inBand, setPlaying))
    return () => {
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
