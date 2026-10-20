// Scroll lock for a fixed overlay (the single-emoji dialog) that leaves the root element alone.
// Toggling `overflow: hidden` on <html> tears down the page's composited scroller: on a 234-sticker
// pack that was a full repaint and re-layerization (~300 ms each on a 4× slowed CPU) for every open
// and close. Instead, vertical wheel, touch and keyboard scrolling is cancelled unless it would scroll
// some element (the overlay, a drawer, a list) that can still move in that direction.

const SCROLL_KEYS = new Set([' ', 'PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp'])
const INTERACTIVE = 'input, textarea, select, button, a[href], [contenteditable=""], [contenteditable="true"]'

/** Would this gesture scroll some element other than the page itself (the overlay, a drawer, a list)? */
function canScroll(target: EventTarget | null, dy: number): boolean {
  if (!(target instanceof Element)) return false
  const top = document.scrollingElement
  for (let n: Element | null = target; n && n !== top && n !== document.body; n = n.parentElement) {
    if (!(n instanceof HTMLElement) || n.scrollHeight <= n.clientHeight + 1) continue
    const oy = getComputedStyle(n).overflowY
    if (oy !== 'auto' && oy !== 'scroll') continue
    if (dy < 0 ? n.scrollTop > 0 : dy > 0 ? n.scrollTop + n.clientHeight < n.scrollHeight - 1 : true) return true
  }
  return false
}

/** Lock page scrolling while an overlay is open; scrolling inside the overlay still works. Returns the unlock. */
export function lockScroll(): () => void {
  let touchX = 0
  let touchY = 0
  // sideways gestures (the thumbnail strip) never scroll the page: leave them alone
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return // pinch zoom, sideways
    if (!canScroll(e.target, e.deltaY)) e.preventDefault()
  }
  const onTouchStart = (e: TouchEvent) => {
    touchX = e.touches[0]?.clientX ?? 0
    touchY = e.touches[0]?.clientY ?? 0
  }
  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length > 1) return
    const dx = touchX - (e.touches[0]?.clientX ?? touchX)
    const dy = touchY - (e.touches[0]?.clientY ?? touchY)
    if (Math.abs(dx) > Math.abs(dy)) return
    if (!canScroll(e.target, dy)) e.preventDefault()
  }
  const onKey = (e: KeyboardEvent) => {
    if (!SCROLL_KEYS.has(e.key) || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
    const t = e.target as Element | null
    if (t?.closest?.(INTERACTIVE)) return
    const dy = e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home' || (e.key === ' ' && e.shiftKey) ? -1 : 1
    if (!canScroll(t, dy)) e.preventDefault()
  }
  const opts = { passive: false, capture: true } as const
  document.addEventListener('wheel', onWheel, opts)
  document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true })
  document.addEventListener('touchmove', onTouchMove, opts)
  document.addEventListener('keydown', onKey)
  return () => {
    document.removeEventListener('wheel', onWheel, opts)
    document.removeEventListener('touchstart', onTouchStart, { capture: true })
    document.removeEventListener('touchmove', onTouchMove, opts)
    document.removeEventListener('keydown', onKey)
  }
}
