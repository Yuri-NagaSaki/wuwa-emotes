import { Popover } from '@base-ui/react/popover'
import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { PHONE_QUERY, useMediaQuery } from './useMediaQuery'

// The kit's dropdown. A native select element opens the OS menu (on macOS over the control, in the
// OS colours, so night-theme text can vanish); this one is the input pill as a button and a themed
// listbox under it. Desktop: Base UI's anchored positioner (the one Menu and FilterPopover use), left
// edge on the trigger's, at least as wide, above the trigger when it does not fit below. Phones
// (≤760px): the same list in a bottom sheet.

export interface SelectOption<V extends string> {
  value: V
  label: string
  disabled?: boolean
}

export interface SelectProps<V extends string> {
  value: V
  options: readonly SelectOption<V>[]
  onChange: (value: V) => void
  /** Accessible name; also the title of the phone sheet. */
  label: string
  /** Visible label inside the pill, before the value (the admin filters: 状态 全部). */
  prefix?: ReactNode
  size?: 'sm' | 'md'
  /** Trigger id, e.g. for a <Field id> label. */
  id?: string
  disabled?: boolean
  /** Extra classes on the trigger. */
  className?: string
}

/** Space between the trigger and the list, and the least distance kept from the viewport edge. */
const GAP = 6
const EDGE = 8
/** The list's height cap (.sel-pop max-height in components.css). */
const LIST_MAX = 360
/** Keys typed within this long form one type-ahead query. */
const TYPEAHEAD_MS = 500

/**
 * The option a navigation key moves to: ArrowDown / ArrowUp step over disabled options and stop at
 * the ends (no wrap, like a native select); Home / End jump to the first / last enabled option.
 * From -1 (nothing active), ArrowDown starts at the top and ArrowUp at the bottom. null: not a
 * navigation key.
 */
export function moveIndex(key: string, from: number, disabled: readonly boolean[]): number | null {
  const n = disabled.length
  const first = () => disabled.findIndex((d) => !d)
  const last = () => disabled.findLastIndex((d) => !d)
  switch (key) {
    case 'Home':
      return first()
    case 'End':
      return last()
    case 'ArrowDown': {
      if (from < 0) return first()
      for (let i = from + 1; i < n; i++) if (!disabled[i]) return i
      return from
    }
    case 'ArrowUp': {
      if (from < 0) return last()
      for (let i = from - 1; i >= 0; i--) if (!disabled[i]) return i
      return from
    }
    default:
      return null
  }
}

/**
 * Type-ahead: the option to jump to for `query`, the keys typed in quick succession. One key
 * pressed again and again cycles through the labels starting with it (from the option after
 * `from`); a longer query stays on the current option while it still matches. Case-insensitive
 * prefix match, disabled options skipped; -1 when nothing matches.
 */
export function typeaheadIndex(labels: readonly string[], query: string, from: number, disabled: readonly boolean[] = []): number {
  const chars = [...query.toLocaleLowerCase()]
  if (!chars.length || !labels.length) return -1
  const cycle = chars.every((c) => c === chars[0])
  const needle = cycle ? chars[0]! : chars.join('')
  const n = labels.length
  const start = cycle ? from + 1 : Math.max(from, 0)
  for (let k = 0; k < n; k++) {
    const i = (((start + k) % n) + n) % n
    if (!disabled[i] && labels[i]!.toLocaleLowerCase().startsWith(needle)) return i
  }
  return -1
}

/** Which side the list opens on: below, unless it does not fit there and there is more room above. */
export function chooseSide({ below, above, needed }: { below: number; above: number; needed: number }): 'bottom' | 'top' {
  return needed <= below || below >= above ? 'bottom' : 'top'
}

/** Scroll the list (not the page) so the option is in view. */
function keepInView(el: HTMLElement | null) {
  let box = el?.parentElement ?? null
  while (box && box.scrollHeight <= box.clientHeight) box = box.parentElement
  if (!el || !box || box === document.body || box === document.documentElement) return
  const r = el.getBoundingClientRect()
  const b = box.getBoundingClientRect()
  if (r.top < b.top) box.scrollTop -= b.top - r.top + 6
  else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 6
}

/**
 * Single choice from a short list. Keyboard: ArrowDown / ArrowUp on the trigger open the list;
 * inside it ArrowUp / ArrowDown / Home / End move, Enter or Space choose, typing jumps to a label,
 * Escape closes (focus back on the trigger), Tab closes and moves on. Click outside closes.
 */
export function Select<V extends string>({ value, options, onChange, label, prefix, size = 'md', id, disabled, className }: SelectProps<V>) {
  const auto = useId()
  const base = id ?? `sel${auto.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const labelId = `${base}-l`
  const valueId = `${base}-v`
  const listId = `${base}-list`
  const optId = (i: number) => `${base}-o${i}`

  const [open, setOpenState] = useState(false)
  const [active, setActive] = useState(-1)
  const [side, setSide] = useState<'bottom' | 'top'>('bottom')
  const phone = useMediaQuery(PHONE_QUERY)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: -Infinity })

  const selected = options.findIndex((o) => o.value === value)
  const current = selected >= 0 ? options[selected] : undefined
  const off = options.map((o) => Boolean(o.disabled))

  function setOpen(next: boolean) {
    if (next === open) return
    if (next) {
      setActive(selected >= 0 && !off[selected] ? selected : moveIndex('Home', -1, off)!)
      setSide('bottom')
      typed.current = { text: '', at: -Infinity }
    }
    setOpenState(next)
  }

  function choose(i: number) {
    const o = options[i]
    if (!o || o.disabled) return
    setOpenState(false)
    if (o.value !== value) onChange(o.value)
  }

  function onTriggerKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setOpen(true)
    }
  }

  function onListKey(e: KeyboardEvent<HTMLDivElement>) {
    const next = moveIndex(e.key, active, off)
    if (next != null) {
      e.preventDefault()
      setActive(next)
      return
    }
    const t = typed.current
    const typing = t.text !== '' && e.timeStamp - t.at <= TYPEAHEAD_MS
    if (e.key === 'Enter' || (e.key === ' ' && !typing)) {
      e.preventDefault()
      choose(active)
      return
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      typed.current = { text: typing ? t.text + e.key : e.key, at: e.timeStamp }
      const hit = typeaheadIndex(
        options.map((o) => o.label),
        typed.current.text,
        active,
        off,
      )
      if (hit >= 0) setActive(hit)
    }
  }

  // the panel mounts: open on the side with room for it
  const measure = useCallback((panel: HTMLDivElement | null) => {
    const t = trigger.current?.getBoundingClientRect()
    if (!panel || !t) return
    const needed = Math.min(panel.scrollHeight, LIST_MAX)
    setSide(chooseSide({ below: window.innerHeight - t.bottom - GAP - EDGE, above: t.top - GAP - EDGE, needed }))
  }, [])

  useLayoutEffect(() => {
    if (open && active >= 0) keepInView(document.getElementById(`${base}-o${active}`))
  }, [open, active, side, phone, base])

  const listbox = (
    <div
      ref={list}
      id={listId}
      role="listbox"
      tabIndex={phone ? 0 : -1}
      aria-labelledby={labelId}
      aria-activedescendant={active >= 0 ? optId(active) : undefined}
      className="sel-list"
      onKeyDown={onListKey}
    >
      {options.map((o, i) => (
        <div
          key={o.value}
          id={optId(i)}
          role="option"
          aria-selected={o.value === value}
          aria-disabled={o.disabled || undefined}
          className={cx('sel-opt', i === active && 'is-active')}
          onPointerMove={() => {
            if (i !== active && !o.disabled) setActive(i)
          }}
          onClick={() => choose(i)}
        >
          <span>{o.label}</span>
          {o.value === value ? <Icon name="check" size="sm" /> : null}
        </div>
      ))}
    </div>
  )

  return (
    <>
      <Popover.Root open={open && !phone} onOpenChange={(next) => setOpen(next)} triggerId={base}>
        <Popover.Trigger
          ref={trigger}
          id={base}
          disabled={disabled}
          className={cx('input select', size === 'sm' && 'sm', className)}
          aria-haspopup={phone ? 'dialog' : 'listbox'}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-labelledby={`${labelId} ${valueId}`}
          onKeyDown={onTriggerKey}
        >
          {prefix != null ? (
            <span className="sel-l" id={labelId}>
              {prefix}
            </span>
          ) : (
            <span className="sr" id={labelId}>
              {label}
            </span>
          )}
          {/* every label is laid out in one grid cell, so the pill keeps the width of the longest */}
          <span className="sel-v" id={valueId}>
            <span>{current?.label ?? ''}</span>
            {options.map((o, i) =>
              i === selected ? null : (
                <span key={o.value} className="sel-size" aria-hidden="true">
                  {o.label}
                </span>
              ),
            )}
          </span>
          <Icon name="down" size="sm" className="sel-chev" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            className="pop-layer sel-layer"
            side={side}
            align="start"
            sideOffset={GAP}
            collisionPadding={EDGE}
            collisionAvoidance={{ side: 'none', align: 'shift', fallbackAxisSide: 'none' }}
          >
            <Popover.Popup ref={measure} role="presentation" className="sel-pop" initialFocus={list}>
              {listbox}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <Sheet open={open && phone} onOpenChange={setOpen} title={label} className="sel-sheet">
        {listbox}
      </Sheet>
    </>
  )
}
