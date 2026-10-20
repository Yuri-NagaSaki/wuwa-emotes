import { Menu as BaseMenu } from '@base-ui/react/menu'
import type { ReactElement } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'
import { AppLink } from './link'

export type MenuEntry =
  | { kind?: 'item'; label: string; icon?: IconName; onSelect: () => void; danger?: boolean; disabled?: boolean }
  | { kind: 'link'; label: string; icon?: IconName; to: string }
  | { kind: 'separator' }

export interface MenuProps {
  /** The trigger element, e.g. <button className="avatar">. */
  trigger: ReactElement
  items: readonly MenuEntry[]
  align?: 'start' | 'center' | 'end'
}

/** Dropdown menu: a lifted sheet sized to its items (no frame line, no inner scroll). */
export function Menu({ trigger, items, align = 'end' }: MenuProps) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner className="pop-layer" side="bottom" align={align} sideOffset={8}>
          <BaseMenu.Popup className="menu">
            {items.map((it, i) => {
              if (it.kind === 'separator') return <BaseMenu.Separator key={i} className="menu-sep" />
              const inner = (
                <>
                  {it.icon ? <Icon name={it.icon} /> : null}
                  {it.label}
                </>
              )
              if (it.kind === 'link') {
                return (
                  <BaseMenu.LinkItem key={i} className="menu-it" closeOnClick render={<AppLink to={it.to} />}>
                    {inner}
                  </BaseMenu.LinkItem>
                )
              }
              return (
                <BaseMenu.Item key={i} className={cx('menu-it', it.danger && 'danger')} disabled={it.disabled} onClick={() => it.onSelect()}>
                  {inner}
                </BaseMenu.Item>
              )
            })}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}
