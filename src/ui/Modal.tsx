import { Dialog } from '@base-ui/react/dialog'
import type { ReactElement, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /** Icon in the well above the title. */
  icon?: IconName
  /** Body copy (rendered as the dialog description). */
  children?: ReactNode
  /** Buttons; use <ModalClose render={<Button …/>}> for the dismiss action. */
  actions?: ReactNode
  /** Outside press and Esc close the modal (default true). */
  dismissible?: boolean
}

/** Confirmation / notice dialog on the sand "blob" (clip-path #tp-blob, see BlobDefs). */
export function Modal({ open, onOpenChange, title, icon, children, actions, dismissible = true }: ModalProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next, details) => {
        if (!next && !dismissible && details.reason === 'escape-key') {
          details.cancel()
          return
        }
        onOpenChange(next)
      }}
      disablePointerDismissal={!dismissible}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="scrim" />
        <Dialog.Viewport className="modal-wrap">
          <Dialog.Popup className="modal">
            <div className="modal-body">
              {icon ? (
                <span className="modal-ico">
                  <Icon name={icon} size="lg" />
                </span>
              ) : null}
              <Dialog.Title render={<h3 />}>{title}</Dialog.Title>
              {children ? <Dialog.Description render={<p />}>{children}</Dialog.Description> : null}
              {actions ? <div className="acts">{actions}</div> : null}
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Closes the surrounding Modal or Sheet. Pass the visible element via `render`. */
export function ModalClose({ render, children }: { render: ReactElement; children?: ReactNode }) {
  return <Dialog.Close render={render}>{children}</Dialog.Close>
}
