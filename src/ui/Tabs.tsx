import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import type { ReactNode } from 'react'
import { cx } from './cx'

export interface TabItem<T extends string> {
  value: T
  label: ReactNode
  count?: number | string | null
}

export interface TabsProps<T extends string> {
  items: readonly TabItem<T>[]
  value?: T
  defaultValue?: T
  onValueChange?: (value: T) => void
  /** Accessible name of the tab list. */
  label?: string
  className?: string
  /** <TabPanel value="…"> elements. */
  children?: ReactNode
}

/** Underlined tabs (the teal "leaf" indicator swings in on change). */
export function Tabs<T extends string>({ items, value, defaultValue, onValueChange, label, className, children }: TabsProps<T>) {
  return (
    <BaseTabs.Root value={value} defaultValue={defaultValue ?? items[0]?.value} onValueChange={(v) => onValueChange?.(v as T)}>
      <BaseTabs.List className={cx('tabs', className)} aria-label={label}>
        {items.map((it) => (
          <BaseTabs.Tab key={it.value} value={it.value}>
            {it.label}
            {it.count != null ? <span className="n">{it.count}</span> : null}
          </BaseTabs.Tab>
        ))}
      </BaseTabs.List>
      {children}
    </BaseTabs.Root>
  )
}

export function TabPanel({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <BaseTabs.Panel value={value} className={className}>
      {children}
    </BaseTabs.Panel>
  )
}
