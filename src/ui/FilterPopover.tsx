import { Popover } from '@base-ui/react/popover'
import { useState, type ReactNode, type RefObject } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { PHONE_QUERY, useMediaQuery } from './useMediaQuery'

export interface FilterPopoverProps {
  /** Facet name on the chip, e.g. 角色. */
  label: string
  /** Current selection summary (bold on the chip); marks the chip as set. */
  value?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Position the panel under this element (the whole filter bar) instead of the chip. */
  anchor?: RefObject<HTMLElement | null>
  /** Extra panel class: fpop-type / fpop-source / fpop-group size the panel to its content. */
  panelClassName?: string
  /** Panel header row (search field, quick toggles). */
  header?: ReactNode
  children: ReactNode
  /** Panel footer (counts, 清除 / 完成). */
  footer?: ReactNode
}

/**
 * Filter-bar chip with its panel. Desktop: a popover sized to its content (no inner scroll, no frame
 * line). Phones (≤760px): the same content in a bottom sheet.
 */
export function FilterPopover({ label, value, open: openProp, onOpenChange, anchor, panelClassName, header, children, footer }: FilterPopoverProps) {
  const [own, setOwn] = useState(false)
  const open = openProp ?? own
  const setOpen = (v: boolean) => {
    setOwn(v)
    onOpenChange?.(v)
  }
  const phone = useMediaQuery(PHONE_QUERY)
  const chip = (
    <>
      {label}
      {value ? <b>{value}</b> : null}
      <Icon name="down" size="sm" />
    </>
  )
  const chipClass = cx('fchip', value ? 'is-set' : null)

  if (phone) {
    return (
      <>
        <button type="button" className={cx(chipClass, open && 'is-open')} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
          {chip}
        </button>
        <Sheet open={open} onOpenChange={setOpen} title={label} footer={footer} className="fpop-sheet">
          {header ? <div className="fpop-h">{header}</div> : null}
          {children}
        </Sheet>
      </>
    )
  }

  return (
    <Popover.Root open={open} onOpenChange={(v) => setOpen(v)}>
      <Popover.Trigger className={chipClass}>{chip}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="pop-layer" anchor={anchor} side="bottom" align="start" sideOffset={10} collisionPadding={16}>
          <Popover.Popup className={cx('fpop', anchor && 'is-anchored', panelClassName)}>
            <Popover.Title className="sr">{label}</Popover.Title>
            {header ? <div className="fpop-h">{header}</div> : null}
            {children}
            {footer ? <div className="fpop-f">{footer}</div> : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
