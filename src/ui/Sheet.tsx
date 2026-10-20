import { Dialog } from '@base-ui/react/dialog'
import type { ReactNode } from 'react'
import { IconButton } from './Button'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'

export interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  subtitle?: ReactNode
  icon?: IconName
  children: ReactNode
  /** Sticky footer (primary action, hints). */
  footer?: ReactNode
  /** Render only `children` inside the panel (no header/body/footer); `title` becomes the aria-label. */
  bare?: boolean
  className?: string
}

/**
 * Side drawer on desktop (right edge, 440px), bottom sheet on phones (≤760px, rounded top, grab
 * handle, at most 88% of the screen). Body scrolls inside without a visible scrollbar.
 */
export function Sheet({ open, onOpenChange, title, subtitle, icon, children, footer, bare, className }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="scrim" />
        <Dialog.Popup className={cx('drawer', className)} aria-label={bare && typeof title === 'string' ? title : undefined}>
          {bare ? (
            children
          ) : (
            <>
              <span className="grab" aria-hidden="true" />
              <div className="drawer-h">
                {icon ? <Icon name={icon} size="lg" /> : null}
                <div>
                  <Dialog.Title render={<h3 />}>{title}</Dialog.Title>
                  {subtitle ? <Dialog.Description render={<span className="hint" />}>{subtitle}</Dialog.Description> : null}
                </div>
                <Dialog.Close render={<IconButton icon="close" label="关闭" className="x" />} />
              </div>
              <div className="drawer-b">{children}</div>
              {footer ? <div className="drawer-f">{footer}</div> : null}
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
