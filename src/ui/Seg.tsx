import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
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
  /** `form`: a form control beside inputs (46 px tall, full width, equal buttons). */
  size?: 'sm' | 'md' | 'form'
  label?: string
  className?: string
}

/**
 * Width of the widest label in em of the button font: CJK and full-width characters take 1em, other
 * characters about 0.62em, an icon 1.6em. CSS uses it to fold a form Seg that does not fit in one row.
 */
export function segLabelEm(options: readonly SegOption<string>[]): number {
  let widest = 0
  for (const o of options) {
    let em = o.icon ? 1.6 : 0
    if (typeof o.label === 'string' || typeof o.label === 'number') {
      for (const ch of String(o.label)) em += /[⺀-鿿가-힯豈-﫿＀-￯]/.test(ch) ? 1 : 0.62
    } else em += 4
    widest = Math.max(widest, em)
  }
  return Math.ceil(widest * 10) / 10
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
  // form: equal columns in one row when every label fits, otherwise two columns (components.css)
  const style = size === 'form' ? ({ '--n': options.length, '--seg-em': segLabelEm(options) } as CSSProperties) : undefined
  return (
    <div ref={ref} className={cx('seg', size === 'sm' && 'sm', size === 'form' && 'form', className)} style={style} role="group" aria-label={label} onKeyDown={onKeyDown}>
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
