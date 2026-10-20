import { useNavigate } from '@tanstack/react-router'
import { useState, type CSSProperties, type FormEvent } from 'react'
import type { SearchResult } from '#/server/catalog/types'
import { Button, buttonClass } from '../Button'
import { EmptyState } from '../EmptyState'
import { fmtN } from '../format'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { SectionHead } from '../Section'
import { Tabs } from '../Tabs'
import { characterCountText } from '#/shared/characters'
import { CharacterCss, RingAvatar } from './character-art'
import { artistHref, characterHref, tagHref, themeColor } from './model'
import { PackMasonry } from './PackMasonry'
import { ArtistTile, CharacterTile } from './people'

// 搜索结果 /search?q=: best match card, then results grouped by kind (tabs filter the groups).

type Group = 'all' | 'characters' | 'packs' | 'artists' | 'tags'

export function SearchPage({ result, q }: { result: SearchResult | null; q: string }) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Group>('all')
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const next = String(new FormData(e.currentTarget).get('q') ?? '').trim()
    void navigate({ to: '/search', search: next ? { q: next } : {} })
  }
  const r = result
  const c = r?.counts
  const total = c ? c.characters + c.packs + c.artists + c.tags : 0
  const show = (g: Group) => tab === 'all' || tab === g

  return (
    <div className="wrap">
      <div className="page-h">
        <form className="hero-search search-form" role="search" onSubmit={submit}>
          <label className="input">
            <Icon name="search" />
            <input name="q" defaultValue={q} key={q} placeholder="搜索表情包、角色、画师或标签" aria-label="搜索" enterKeyHint="search" />
          </label>
          <Button type="submit" variant="primary">
            搜索
          </Button>
        </form>
        {r && q ? (
          <span className="sub">
            {total
              ? `找到 ${[c!.characters ? `${c!.characters} 位角色` : '', c!.packs ? `${fmtN(c!.packs)} 个表情包` : '', c!.artists ? `${c!.artists} 位画师` : '', c!.tags ? `${c!.tags} 个标签` : ''].filter(Boolean).join('、')}`
              : `没有找到和「${r.q}」相关的内容`}
          </span>
        ) : (
          <span className="sub">输入角色名、别名、画师或表情包标题。也可以随时按 Ctrl K。</span>
        )}
      </div>

      {r && total ? (
        <>
          <Tabs<Group>
            label="结果分类"
            value={tab}
            onValueChange={setTab}
            items={[
              { value: 'all', label: '全部' },
              { value: 'characters', label: '角色', count: c!.characters },
              { value: 'packs', label: '表情包', count: c!.packs },
              { value: 'artists', label: '画师', count: c!.artists },
              { value: 'tags', label: '标签', count: c!.tags },
            ]}
          />

          {r.best && tab === 'all' ? <BestHit best={r.best} /> : null}

          {show('characters') && r.characters.length ? (
            <section className="sec">
              <SectionHead plain title="角色" sub={`${c!.characters} 位`} />
              <div className="cgrid">
                {r.characters.map((ch) => (
                  <CharacterTile key={ch.slug} c={ch} />
                ))}
              </div>
            </section>
          ) : null}
          {show('packs') && r.packs.length ? (
            <section className="sec">
              <SectionHead plain title="表情包" sub={c!.packs > r.packs.length ? `前 ${r.packs.length} 个，共 ${fmtN(c!.packs)} 个` : `${c!.packs} 个`} />
              <PackMasonry cards={r.packs} label="匹配的表情包" priority={4} />
            </section>
          ) : null}
          {show('artists') && r.artists.length ? (
            <section className="sec">
              <SectionHead plain title="画师" sub={`${c!.artists} 位`} />
              <div className="links-grid">
                {r.artists.map((a, i) => (
                  <ArtistTile key={a.slug} a={a} index={i} />
                ))}
              </div>
            </section>
          ) : null}
          {show('tags') && r.tags.length ? (
            <section className="sec">
              <SectionHead plain title="标签" sub={`${c!.tags} 个`} />
              <div className="cloud">
                {r.tags.map((t) => (
                  <AppLink key={`${t.dimension}:${t.slug}`} to={tagHref(t.dimension, t.slug)} style={{ '--tg': 'var(--c-yellow)' } as CSSProperties}>
                    {t.name}
                    <small>{t.packCount}</small>
                  </AppLink>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : q ? (
        <EmptyState
          icon="search"
          title="没有找到结果"
          actions={
            <AppLink to="/packs" className={buttonClass({ size: 'sm' })}>
              看看全部表情包
            </AppLink>
          }
        >
          换个说法试试：角色的别名、画师名，或者表情包标题里的一个词。
        </EmptyState>
      ) : null}
    </div>
  )
}

function BestHit({ best }: { best: NonNullable<SearchResult['best']> }) {
  if (best.type === 'character') {
    const ch = best.character
    return (
      <div className="top-hit" style={{ '--cc': themeColor(ch.color) } as CSSProperties}>
        <CharacterCss />
        <span className="pool">
          <RingAvatar c={ch} priority portraitFirst />
        </span>
        <div>
          <div className="eyebrow">最佳匹配 · 角色</div>
          <h3>{ch.name}</h3>
          <span className="muted">{characterCountText(ch)}</span>
        </div>
        <AppLink to={characterHref(ch.slug)} className={buttonClass({ variant: 'primary' })}>
          进入角色页
        </AppLink>
      </div>
    )
  }
  const a = best.artist
  return (
    <div className="top-hit">
      <span className="pool">
        <span className="initial">{Array.from(a.name)[0]}</span>
      </span>
      <div>
        <div className="eyebrow">最佳匹配 · 画师</div>
        <h3>{a.name}</h3>
        <span className="muted">
          {a.packCount} 个表情包 · {fmtN(a.emojiCount)} 张表情
        </span>
      </div>
      <AppLink to={artistHref(a.slug)} className={buttonClass({ variant: 'primary' })}>
        进入画师页
      </AppLink>
    </div>
  )
}
