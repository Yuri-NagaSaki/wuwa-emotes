import { Link, useNavigate } from '@tanstack/react-router'
import { useState, type CSSProperties } from 'react'
import { galleryFn, packsFn } from '#/server/catalog/fns'
import type { CharacterDetail, EmojiTile, PackCard, Page } from '#/server/catalog/types'
import { Button } from '../Button'
import { cx } from '../cx'
import { fmtN } from '../format'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { WaveLoader } from '../Section'
import { Seg } from '../Seg'
import { toast } from '../Toast'
import { CharacterCss, PortraitImg, RingAvatar } from './character-art'
import { emojiHref, themeColor } from './model'
import { PackMasonry } from './PackMasonry'
import { ArtistTile } from './people'
import { StreamTiles } from './StreamTiles'
import { useCursorList } from './useCursorList'

// 角色详情 /characters/:slug: the character's color takes over the header (wave edge below) with its
// official portrait (立绘) when there is one, else its own sticker in the round pool; tabs for its
// packs (masonry), all its stickers (grid, animated/static filter), the group packs it appears in
// (合集包) and the artists who drew it. Tabs without content are left out; a character that only
// appears in group packs opens on 合集包. 张, 包 and 合集 follow catalog/attribution.ts.
// 随机来一张 opens one random sticker of the character.

export type CharacterTab = 'packs' | 'emojis' | 'groups' | 'artists'
export type EmojiTypeFilter = 'animated' | 'static' | undefined

export interface CharacterPageProps {
  detail: CharacterDetail
  tab: CharacterTab
  type: EmojiTypeFilter
  /** ?e= of the sticker dialog (emojis tab) */
  current: string | undefined
}

export function WaveEdge() {
  return (
    <div className="wave-edge" aria-hidden="true">
      <svg viewBox="0 0 1200 26" preserveAspectRatio="none">
        <path d="M0 14 Q50 0 100 14 T200 14 T300 14 T400 14 T500 14 T600 14 T700 14 T800 14 T900 14 T1000 14 T1100 14 T1200 14 V26 H0z" />
      </svg>
    </div>
  )
}

function PacksTab({ slug, page, groups }: { slug: string; page: Page<PackCard>; groups: boolean }) {
  const list = useCursorList(page, (cursor) => packsFn({ data: groups ? { groupOf: slug, sort: 'new', cursor } : { character: slug, sort: 'new', cursor } }))
  if (!list.items.length) return <p className="muted list-end">{groups ? '没有出现 TA 的合集包。' : '还没有这个角色的表情包。'}</p>
  return (
    <div style={{ marginTop: 18 }}>
      {groups ? (
        <div className="note-box" style={{ marginBottom: 14 }}>
          <Icon name="info" size="sm" />
          <span>合集包：多位角色同框的表情包，没有逐张标注谁是谁，所以不计入 TA 的表情数。</span>
        </div>
      ) : null}
      <PackMasonry
        cards={list.items}
        label={groups ? '合集包' : '表情包'}
        priority={2}
        onEndReached={list.loadMore}
        loading={list.loading}
        done={list.done}
        error={list.error}
        onRetry={list.loadMore}
      />
    </div>
  )
}

function EmojisTab({ slug, page, type, current }: { slug: string; page: Page<EmojiTile>; type: EmojiTypeFilter; current: string | undefined }) {
  const navigate = useNavigate()
  const list = useCursorList(page, (cursor) => galleryFn({ data: { character: slug, type, sort: 'new', cursor, limit: 60 } }))
  return (
    <>
      <div className="toolbar" style={{ marginTop: 16 }}>
        <Seg
          size="sm"
          label="类型"
          options={[
            { value: 'all', label: '全部' },
            { value: 'animated', label: '动态' },
            { value: 'static', label: '静态' },
          ]}
          value={type ?? 'all'}
          onChange={(v) =>
            void navigate({ to: '.', search: (p: Record<string, unknown>) => ({ ...p, type: v === 'all' ? undefined : v, e: undefined }), resetScroll: false } as never)
          }
        />
      </div>
      {list.items.length ? <StreamTiles tiles={list.items} current={current} size={120} /> : <p className="muted list-end">没有这一类表情。</p>}
      <div className="loadmore">
        {list.loading ? (
          <WaveLoader />
        ) : list.done ? (
          <span className="list-end">共 {list.items.length} 张</span>
        ) : (
          <Button size="sm" onClick={list.loadMore}>
            {list.error ? '加载失败，点此重试' : '加载更多'}
          </Button>
        )}
      </div>
    </>
  )
}

export function CharacterPage({ detail, tab, type, current }: CharacterPageProps) {
  const navigate = useNavigate()
  const c = detail.character
  const [rolling, setRolling] = useState(false)
  const tabs: { value: CharacterTab; label: string; n: number }[] = [
    { value: 'packs' as const, label: '表情包', n: c.packCount },
    { value: 'emojis' as const, label: '全部表情', n: c.emojiCount },
    { value: 'groups' as const, label: '合集包', n: c.groupCount },
  ].filter((t) => t.n > 0)
  tabs.push({ value: 'artists', label: '画过 TA 的画师', n: detail.artists.length })
  // what the loader fetched (a character without 包 gets its 合集包 for the default tab)
  const active: CharacterTab = tab === 'artists' ? 'artists' : detail.tab

  const random = async () => {
    setRolling(true)
    try {
      const page = await galleryFn({ data: { character: c.slug, sort: 'random', limit: 1 } })
      const pick = page.items[0]
      if (pick) {
        toast({ message: `从 ${fmtN(c.emojiCount)} 张里抽到一张`, icon: 'sparkle' })
        void navigate({ to: emojiHref(pick.id) as '/' })
      } else toast({ message: '这个角色还没有单独标注的表情', icon: 'info' })
    } catch {
      toast({ message: '抽取失败，请稍后再试', icon: 'warn' })
    } finally {
      setRolling(false)
    }
  }

  return (
    <>
      <section className={cx('char-hero', c.portrait && 'has-portrait')} style={{ '--cc': themeColor(c.color) } as CSSProperties}>
        <CharacterCss />
        <div className="wrap">
          {c.portrait ? (
            <span className="char-portrait">
              <PortraitImg p={c.portrait} sizes="(max-width: 760px) 96px, (max-width: 1100px) 150px, 186px" alt={`${c.name}的立绘`} priority />
              {c.avatar ? (
                <span className="badge">
                  <RingAvatar c={c} priority />
                </span>
              ) : null}
            </span>
          ) : (
            <span className="pool">
              <RingAvatar c={c} priority />
            </span>
          )}
          <div style={{ minWidth: 0 }}>
            <nav className="crumbs" aria-label="位置">
              <AppLink to="/characters">角色图鉴</AppLink>
              <Icon name="right" />
              <span aria-current="page">{c.name}</span>
            </nav>
            <h1>{c.name}</h1>
            <div className="alias">
              {c.aliases.length ? `别名：${c.aliases.join(' · ')} · ` : ''}
              <span className="mono">{c.slug}</span>
            </div>
            <div className="stats">
              {c.emojiCount ? (
                <>
                  <div className="stat">
                    <b>{fmtN(c.emojiCount)}</b>
                    <span>张表情</span>
                  </div>
                  <div className="stat">
                    <b>{fmtN(c.packCount)}</b>
                    <span>个表情包</span>
                  </div>
                </>
              ) : null}
              {c.groupCount ? (
                <div className="stat">
                  <b>{fmtN(c.groupCount)}</b>
                  <span>个合集包</span>
                </div>
              ) : null}
              {detail.artists.length ? (
                <div className="stat">
                  <b>{detail.artists.length}</b>
                  <span>位画师</span>
                </div>
              ) : null}
            </div>
          </div>
          {c.emojiCount ? (
            <div className="acts">
              <Button variant="sun" icon="sparkle" onClick={() => void random()} disabled={rolling}>
                随机来一张
              </Button>
              <AppLink to={`/packs?character=${encodeURIComponent(c.slug)}`} className="btn sm">
                <Icon name="filter" size="sm" />
                在目录里筛选
              </AppLink>
            </div>
          ) : null}
        </div>
      </section>
      <WaveEdge />
      <div className="wrap">
        <div className="tabs tabs-row" role="tablist" aria-label="角色内容">
          {tabs.map((t) => (
            <Link
              key={t.value}
              to="."
              search={(p: Record<string, unknown>) => ({ ...p, tab: t.value === 'packs' ? undefined : t.value, type: undefined, e: undefined })}
              resetScroll={false}
              role="tab"
              aria-selected={active === t.value}
            >
              {t.label}
              <span className="n">{fmtN(t.n)}</span>
            </Link>
          ))}
        </div>
        {active === 'artists' ? (
          detail.artists.length ? (
            <div className="links-grid" style={{ marginTop: 18 }}>
              {detail.artists.map((a, i) => (
                <ArtistTile key={a.slug} a={a} index={i} />
              ))}
            </div>
          ) : (
            <p className="muted list-end">还没有署名的画师。</p>
          )
        ) : detail.tab === 'emojis' ? (
          <EmojisTab slug={c.slug} page={detail.page} type={type} current={current} />
        ) : (
          <PacksTab key={detail.tab} slug={c.slug} page={detail.page} groups={detail.tab === 'groups'} />
        )}
      </div>
    </>
  )
}
