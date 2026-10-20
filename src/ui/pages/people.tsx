import type { CSSProperties } from 'react'
import type { ArtistCard, CharacterCard } from '#/server/catalog/types'
import { characterCountText } from '#/shared/characters'
import { CharacterCss, RingAvatar } from './character-art'
import { fmtN } from '../format'
import { AppLink } from '../link'
import { artistHref, characterColor, characterHref } from './model'

// Character and artist cards shared by 画师名录, search and the character page. A character's round
// avatar is its portrait's face, else its own sticker, else its initial (character-art.tsx).

const ARTIST_COLORS = ['purple', 'pink', 'blue', 'mint', 'yellow', 'orange', 'green', 'peach', 'teal', 'lime', 'red', 'brown']

export function CharacterTile({ c, eager }: { c: CharacterCard; eager?: boolean }) {
  return (
    <AppLink to={characterHref(c.slug)} className="ccard" style={{ '--cc': characterColor(c) } as CSSProperties}>
      <CharacterCss />
      <span className="pool">
        <RingAvatar c={c} eager={eager} portraitFirst />
      </span>
      <b>{c.name}</b>
      <span>{characterCountText(c)}</span>
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
