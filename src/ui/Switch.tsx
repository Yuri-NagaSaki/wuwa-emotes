import { Switch as BaseSwitch } from '@base-ui/react/switch'
import type { ReactNode } from 'react'
import { cx } from './cx'

export interface SwitchProps {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  name?: string
  children?: ReactNode
  className?: string
}

/** Island switch (green when on). The label text is the children. */
export function Switch({ checked, defaultChecked, onCheckedChange, disabled, name, children, className }: SwitchProps) {
  return (
    <label className={cx('switch', className)}>
      <BaseSwitch.Root
        className="track"
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={(v) => onCheckedChange?.(v)}
        disabled={disabled}
        name={name}
      />
      {children}
    </label>
  )
}
