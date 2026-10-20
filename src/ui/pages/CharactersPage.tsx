import { useNavigate } from '@tanstack/react-router'
import { type CSSProperties, Fragment, useMemo, useState } from 'react'
import type { CharacterCard } from '#/server/catalog/types'
import { characterCountText } from '#/shared/characters'
import { cx } from '../cx'
import { Input } from '../Field'
import { AppLink } from '../link'
import { Seg } from '../Seg'
import { CharacterCss, PortraitImg, RingAvatar } from './character-art'
import { characterHref, themeColor } from './model'

// 角色图鉴 /characters: every character with a public pack or an official portrait, like the official
// atlas. Cards are tall for the portrait (立绘); the character's own sticker rides in the corner, or
// stands in the middle when there is no portrait (its initial when there is no sticker either). The
// count line reads 「N 张 · M 包」 for stickers of its own and 「出现在 M 个合集包」 for a character only
// seen in group packs (catalog/attribution.ts, src/shared/characters.ts). Sort by sticker count, latest
// pack, or pinyin (slugs are pinyin); find by name, alias-free pinyin prefix, or the letter index.

export type CharacterSort = 'count' | 'recent' | 'pinyin'
const SORTS = [
  { value: 'count' as const, label: '表情最多' },
  { value: 'recent' as const, label: '最近更新' },
  { value: 'pinyin' as const, label: '拼音' },
]

const letterOf = (c: CharacterCard) => (/^[a-z]/i.test(c.slug) ? c.slug[0]!.toUpperCase() : '#')

/** Card width per breakpoint (characters.css .atlas), for the portrait srcset. */
const CARD_SIZES = '(max-width: 760px) 34vw, 200px'

export function AtlasCard({ c, eager }: { c: CharacterCard; eager?: boolean }) {
  return (
    <AppLink to={characterHref(c.slug)} className="acard" style={{ '--cc': themeColor(c.color) } as CSSProperties}>
      <span className="acard-art">
        {c.portrait ? (
          <>
            <PortraitImg p={c.portrait} sizes={CARD_SIZES} alt={`${c.name}的立绘`} eager={eager} />
            {c.avatar ? (
              <span className="acard-badge">
                <RingAvatar c={c} eager={eager} />
              </span>
            ) : null}
          </>
        ) : (
          <span className="acard-pool">
            <RingAvatar c={c} eager={eager} />
          </span>
        )}
      </span>
      <span className="acard-meta">
        <b>{c.name}</b>
        <span className={cx(!c.emojiCount && 'group-only')}>{characterCountText(c)}</span>
      </span>
    </AppLink>
  )
}

export function CharactersPage({ list, sort }: { list: CharacterCard[]; sort: CharacterSort }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return list
    return list.filter((c) => c.name.toLowerCase().includes(needle) || c.slug.toLowerCase().startsWith(needle))
  }, [list, q])
  const letters = useMemo(() => [...new Set(list.map(letterOf))].sort(), [list])

  const jump = (l: string) => {
    if (sort !== 'pinyin') void navigate({ to: '/characters', search: { sort: 'pinyin' }, hash: `letter-${l}` })
    else document.getElementById(`letter-${l}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  let prev = ''
  return (
    <div className="wrap">
      <CharacterCss />
      <div className="page-h">
        <h1>角色图鉴</h1>
        <div className="row">
          <span className="sub">{list.length} 位角色。立绘来自官方，角落里是一张只属于 TA 的表情。</span>
        </div>
      </div>
      <div className="toolbar" style={{ marginTop: 14 }}>
        <Input size="sm" icon="search" placeholder="找角色：中文或拼音" aria-label="找角色" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        <Seg size="sm" label="排序" options={SORTS} value={sort} onChange={(v) => void navigate({ to: '/characters', search: v === 'count' ? {} : { sort: v }, resetScroll: false })} />
        <span className="grow" />
        <div className="alpha" role="navigation" aria-label="按拼音首字母">
          {letters.map((l) => (
            <button key={l} type="button" onClick={() => jump(l)} aria-label={`拼音 ${l}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {shown.length ? (
        <div className="atlas">
          {shown.map((c, i) => {
            const l = letterOf(c)
            const head = sort === 'pinyin' && !q && l !== prev
            prev = l
            return (
              <Fragment key={c.slug}>
                {head ? (
                  <div className={cx('letter')} id={`letter-${l}`}>
                    {l}
                  </div>
                ) : null}
                <AtlasCard c={c} eager={i < 6} />
              </Fragment>
            )
          })}
        </div>
      ) : (
        <p className="muted" style={{ padding: '24px 0' }}>
          没有找到「{q}」。试试别的写法，或者用拼音首字母。
        </p>
      )}
    </div>
  )
}
