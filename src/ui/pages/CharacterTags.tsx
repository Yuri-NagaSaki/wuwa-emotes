import { type CSSProperties, useState } from 'react'
import type { CharacterRef } from '#/server/catalog/types'
import { Tag } from '../Chip'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { characterHref, themeColor } from './model'

// 「角色 · 名字」 chips for a pack or a sticker (pack detail, the sticker dialog). Group packs list
// every character on every sticker (24 on all-characters-pipa); more than COLLAPSE_AFTER collapse into
// one 「24 位角色」 chip that opens the full list.

export const COLLAPSE_AFTER = 4

const BUTTON: CSSProperties = { fontFamily: 'inherit', cursor: 'pointer' }

/** Whether a list of this length shows as one collapsed chip. */
export function collapsesCharacters(n: number, max = COLLAPSE_AFTER): boolean {
  return n > max
}

export function CharacterTags({ chars, max = COLLAPSE_AFTER }: { chars: CharacterRef[]; max?: number }) {
  const [open, setOpen] = useState(false)
  if (collapsesCharacters(chars.length, max) && !open) {
    return (
      <button type="button" className="tag" style={BUTTON} aria-expanded={false} title={chars.map((c) => c.name).join('、')} onClick={() => setOpen(true)}>
        {chars.length} 位角色
        <Icon name="down" size="sm" />
      </button>
    )
  }
  return (
    <>
      {chars.map((c) => (
        <AppLink key={c.slug} to={characterHref(c.slug)}>
          <Tag color={themeColor(c.color)}>角色 · {c.name}</Tag>
        </AppLink>
      ))}
      {open ? (
        <button type="button" className="tag" style={BUTTON} aria-expanded onClick={() => setOpen(false)}>
          收起
          <Icon name="up" size="sm" />
        </button>
      ) : null}
    </>
  )
}
