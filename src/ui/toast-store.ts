import type { IconName } from './icons'

// A tiny toast queue usable from anywhere (event handlers, mutation callbacks). <Toaster /> renders it.
// No React or DOM imports, so it can be unit-tested.

export interface ToastInput {
  message: string
  detail?: string
  icon?: IconName
  /** Milliseconds on screen (default 2500, matching the CSS fade). */
  duration?: number
}

export interface ToastItem extends Required<Pick<ToastInput, 'message' | 'duration'>> {
  id: number
  detail?: string
  icon: IconName
}

const MAX_VISIBLE = 3
type Listener = () => void

export function createToastStore(timers: { set: (fn: () => void, ms: number) => unknown } = { set: (fn, ms) => setTimeout(fn, ms) }) {
  let items: ToastItem[] = []
  let seq = 0
  const listeners = new Set<Listener>()
  const emit = () => listeners.forEach((l) => l())

  function dismiss(id: number) {
    const next = items.filter((t) => t.id !== id)
    if (next.length === items.length) return
    items = next
    emit()
  }

  function show(input: ToastInput | string): number {
    const t = typeof input === 'string' ? { message: input } : input
    const item: ToastItem = { id: ++seq, message: t.message, detail: t.detail, icon: t.icon ?? 'check', duration: t.duration ?? 2500 }
    items = [...items, item].slice(-MAX_VISIBLE)
    emit()
    timers.set(() => dismiss(item.id), item.duration)
    return item.id
  }

  return {
    show,
    dismiss,
    getSnapshot: () => items,
    subscribe(l: Listener) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

export const toasts = createToastStore()

/** Show a toast: `toast('已复制')` or `toast({ message, detail, icon })`. */
export const toast = (input: ToastInput | string) => toasts.show(input)
