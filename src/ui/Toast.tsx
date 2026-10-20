import { useSyncExternalStore } from 'react'
import { Icon } from './Icon'
import { toasts, type ToastItem } from './toast-store'

export { toast } from './toast-store'
export type { ToastInput } from './toast-store'

const EMPTY: ToastItem[] = []

/** Renders queued toasts (bottom center, above the phone tab bar). Mount once, in the root layout. */
export function Toaster() {
  const items = useSyncExternalStore(toasts.subscribe, toasts.getSnapshot, () => EMPTY)
  return (
    <div className="toast-zone" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast" style={{ animationDuration: `${t.duration}ms` }}>
          <Icon name={t.icon} />
          <span>
            {t.message}
            {t.detail ? <small> {t.detail}</small> : null}
          </span>
        </div>
      ))}
    </div>
  )
}
