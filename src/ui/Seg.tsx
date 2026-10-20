import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'

export interface SegOption<T extends string> {
  value: T
  label: ReactNode
  icon?: IconName
}

export interface SegProps<T extends string> {
  options: readonly SegOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  label?: string
  className?: string
}

/** Segmented control (single choice). Arrow keys move the choice, like a radio group. */
export function Seg<T extends string>({ options, value, onChange, size = 'md', label, className }: SegProps<T>) {
  const ref = useRef<HTMLDivElement>(null)
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const i = options.findIndex((o) => o.value === value)
    const next = options[(i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length]
    if (!next) return
    e.preventDefault()
    onChange(next.value)
    ref.current?.querySelector<HTMLButtonElement>(`[data-v="${CSS.escape(next.value)}"]`)?.focus()
  }
  return (
    <div ref={ref} className={cx('seg', size === 'sm' && 'sm', className)} role="group" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-v={o.value}
          aria-pressed={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
        >
          {o.icon ? <Icon name={o.icon} size="sm" /> : null}
          {o.label}
        </button>
      ))}
    </div>
  )
}
