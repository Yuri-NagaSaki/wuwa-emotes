import { lazy, Suspense, useState, type ComponentType } from 'react'
import type { EmojiDialogProps } from './EmojiDialog'

// The single-emoji dialog's code is loaded on demand. Pages prefetch it (idle, first press); once it is
// in, the dialog renders directly. React.lazy alone would still suspend on the first open even with the
// module already loaded, and React holds a revealed Suspense boundary back by up to 300 ms.

let loaded: ComponentType<EmojiDialogProps> | null = null
let pending: Promise<ComponentType<EmojiDialogProps>> | null = null

export function loadEmojiDialog(): Promise<ComponentType<EmojiDialogProps>> {
  pending ??= import('./EmojiDialog').then((m) => (loaded = m.EmojiDialog))
  return pending
}

const LazyEmojiDialog = lazy(() => loadEmojiDialog().then((c) => ({ default: c })))

/** The dialog, loaded on demand. The component is chosen once per opening, so it never remounts. */
export function EmojiDialogHost(props: EmojiDialogProps) {
  const [Dialog] = useState(() => loaded ?? LazyEmojiDialog)
  return (
    <Suspense fallback={null}>
      <Dialog {...props} />
    </Suspense>
  )
}

/**
 * Prefetch the dialog when a sticker tile is pressed (before the click completes) and, with `idle`
 * (pages where opening it is the main thing to do, like a pack), as soon as the browser is idle.
 * Presses elsewhere (a link to another page) do not load it. Returns the cleanup.
 */
export function prefetchEmojiDialog({ idle = false }: { idle?: boolean } = {}): () => void {
  if (loaded) return () => {}
  const load = () => void loadEmojiDialog()
  const onPress = (e: PointerEvent) => {
    if ((e.target as Element | null)?.closest?.('.tile')) load()
  }
  const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void }
  const handle = !idle ? null : w.requestIdleCallback ? w.requestIdleCallback(load) : window.setTimeout(load, 1500)
  document.addEventListener('pointerdown', onPress, { capture: true, passive: true })
  return () => {
    if (handle != null) {
      if (w.cancelIdleCallback) w.cancelIdleCallback(handle)
      else window.clearTimeout(handle)
    }
    document.removeEventListener('pointerdown', onPress, { capture: true })
  }
}
