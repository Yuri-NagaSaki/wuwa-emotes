import { lazy, Suspense, useState } from 'react'
import { cx } from '../cx'
import type { FilterPopoverProps } from '../FilterPopover'
import { Icon } from '../Icon'

// The filter bar's chips render as plain buttons; the panel machinery (Base UI Popover + floating
// positioning on desktop, the Sheet on phones, ~35 KB) loads on first hover/focus/press.

const load = () => import('../FilterPopover')
const FilterPopover = lazy(() => load().then((m) => ({ default: m.FilterPopover })))

function StaticChip({ label, value, onPress }: { label: string; value?: FilterPopoverProps['value']; onPress?: () => void }) {
  return (
    <button
      type="button"
      className={cx('fchip', value ? 'is-set' : null)}
      aria-haspopup="dialog"
      aria-expanded={false}
      onClick={onPress}
      onPointerEnter={() => void load()}
      onFocus={() => void load()}
    >
      {label}
      {value ? <b>{value}</b> : null}
      <Icon name="down" size="sm" />
    </button>
  )
}

export function LazyFilterPopover(props: FilterPopoverProps) {
  const [armed, setArmed] = useState(false)
  if (!armed && !props.open) {
    return (
      <StaticChip
        label={props.label}
        value={props.value}
        onPress={() => {
          setArmed(true)
          props.onOpenChange?.(true)
        }}
      />
    )
  }
  return (
    <Suspense fallback={<StaticChip label={props.label} value={props.value} />}>
      <FilterPopover {...props} />
    </Suspense>
  )
}
