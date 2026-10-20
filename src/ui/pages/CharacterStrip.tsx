import type { CSSProperties } from 'react'
import type { CharacterCard } from '#/server/catalog/types'
import { fmtN } from '../format'
import { AppLink } from '../link'
import { SectionHead } from '../Section'
import { CharacterCss, RingAvatar } from './character-art'
import { characterHref, themeColor } from './model'

// 角色潮汐 on the home page: the top characters by sticker count, each as its own sticker clipped to
// a circle on the character colour (the avatars are unique, see catalog/characters.ts).

export function CharacterStrip({ characters, total }: { characters: CharacterCard[]; total: number }) {
  if (!characters.length) return null
  return (
    <section className="sec">
      <CharacterCss />
      <div className="wrap">
        <SectionHead title="角色潮汐" sub="按表情数量排序" more={{ label: `全部 ${total} 位`, to: '/characters' }} />
        <div className="cstrip">
          {characters.map((c) => (
            <AppLink key={c.slug} to={characterHref(c.slug)} className="cchip" style={{ '--cc': themeColor(c.color) } as CSSProperties}>
              <span className="pool">
                <RingAvatar c={c} />
              </span>
              <b>{c.name}</b>
              <small>{fmtN(c.emojiCount)} 张</small>
            </AppLink>
          ))}
        </div>
      </div>
    </section>
  )
}
