import type { CSSProperties } from 'react'
import type { ArtistCard, CharacterCard } from '#/server/catalog/types'
import { fmtN } from '../format'
import { AppLink } from '../link'
import { artistHref, characterHref, themeColor } from './model'

// Character and artist cards shared by 角色图鉴, 画师名录, search and the character page.

const ARTIST_COLORS = ['purple', 'pink', 'blue', 'mint', 'yellow', 'orange', 'green', 'peach', 'teal', 'lime', 'red', 'brown']

export function CharacterTile({ c, eager }: { c: CharacterCard; eager?: boolean }) {
  return (
    <AppLink to={characterHref(c.slug)} className="ccard" style={{ '--cc': themeColor(c.color) } as CSSProperties}>
      <span className="pool">
        {c.avatar ? <img src={c.avatar.poster} width={160} height={160} loading={eager ? 'eager' : 'lazy'} decoding="async" alt="" /> : null}
      </span>
      <b>{c.name}</b>
      <span>
        {fmtN(c.emojiCount)} 张 · {c.packCount} 包
      </span>
    </AppLink>
  )
}

export function ArtistTile({ a, index }: { a: Pick<ArtistCard, 'slug' | 'name' | 'packCount'> & Partial<ArtistCard>; index: number }) {
  const first = Array.from(a.name.trim())[0] ?? '?'
  const sub = a.commissionedCount && !a.drawnCount ? `约稿 ${a.commissionedCount} 个包` : `${a.packCount} 个表情包${a.emojiCount ? ` · ${fmtN(a.emojiCount)} 张` : ''}`
  return (
    <AppLink to={artistHref(a.slug)} className="lcard" style={{ '--acc': `var(--c-${ARTIST_COLORS[index % ARTIST_COLORS.length]})` } as CSSProperties}>
      <span className="ico" aria-hidden="true">
        {first}
      </span>
      <div>
        <b>{a.name}</b>
        <small>{sub}</small>
      </div>
    </AppLink>
  )
}
