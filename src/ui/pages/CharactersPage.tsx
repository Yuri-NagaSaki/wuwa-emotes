import { useNavigate } from '@tanstack/react-router'
import { Fragment, useMemo, useState } from 'react'
import type { CharacterCard } from '#/server/catalog/types'
import { cx } from '../cx'
import { Input } from '../Field'
import { fmtN } from '../format'
import { Seg } from '../Seg'
import { CharacterTile } from './people'

// 角色图鉴 /characters: every character with public stickers, avatar = one of its stickers. Sort by
// sticker count, latest pack, or pinyin (slugs are pinyin); find by name, alias-free pinyin prefix,
// or the letter index.

export type CharacterSort = 'count' | 'recent' | 'pinyin'
const SORTS = [
  { value: 'count' as const, label: '表情最多' },
  { value: 'recent' as const, label: '最近更新' },
  { value: 'pinyin' as const, label: '拼音' },
]

const letterOf = (c: CharacterCard) => (/^[a-z]/i.test(c.slug) ? c.slug[0]!.toUpperCase() : '#')

export function CharactersPage({ list, sort }: { list: CharacterCard[]; sort: CharacterSort }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return list
    return list.filter((c) => c.name.toLowerCase().includes(needle) || c.slug.toLowerCase().startsWith(needle))
  }, [list, q])
  const letters = useMemo(() => [...new Set(list.map(letterOf))].sort(), [list])
  const emojis = list.reduce((s, c) => s + c.emojiCount, 0)

  const jump = (l: string) => {
    if (sort !== 'pinyin') void navigate({ to: '/characters', search: { sort: 'pinyin' }, hash: `letter-${l}` })
    else document.getElementById(`letter-${l}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  let prev = ''
  return (
    <div className="wrap">
      <div className="page-h">
        <h1>角色图鉴</h1>
        <div className="row">
          <span className="sub">
            {list.length} 位角色，{fmtN(emojis)} 张表情。头像是该角色的一张表情。
          </span>
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
        <div className="cgrid">
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
                <CharacterTile c={c} eager={i < 6} />
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
