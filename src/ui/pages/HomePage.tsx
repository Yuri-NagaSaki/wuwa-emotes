import type { CSSProperties } from 'react'
import type { CharacterCard, ExploreData, HomeData } from '#/server/catalog/types'
import { Button, buttonClass } from '../Button'
import { Chip } from '../Chip'
import { fmtN, fmtW } from '../format'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { PackCard } from '../PackCard'
import { SectionHead } from '../Section'
import { cardProps, characterHref, packHref, tagHref, themeColor } from './model'
import { PackMasonry } from './PackMasonry'
import { palette } from './palette'
import { StreamTiles } from './StreamTiles'

// 首页: the tidepool hero (stats, floating stickers), 角色潮汐, 站长精选, 新上架, and teasers for the
// gallery and 探索. Only static WebP posters load up front; the hero art is inline SVG.

const SPOTS: [number, number, string][] = [
  [16, 20, '-0.4s'],
  [56, 12, '-1.8s'],
  [36, 44, '-3.1s'],
  [68, 52, '-0.9s'],
  [14, 58, '-2.4s'],
  [48, 72, '-4s'],
]

function PoolArt({ chars, today, downloads }: { chars: CharacterCard[]; today: number; downloads: number }) {
  return (
    <div className="pool-art" aria-hidden="true">
      <svg className="pool" viewBox="0 0 560 500">
        <defs>
          <radialGradient id="tp-pool-grad" cx="45%" cy="40%" r="65%">
            <stop offset="0" stopColor="#7fe6d9" />
            <stop offset="0.55" stopColor="#2cc7b8" />
            <stop offset="1" stopColor="#139a96" />
          </radialGradient>
        </defs>
        <path className="rim" d="M282 24c132 0 250 70 254 196 5 150-104 262-262 262C120 482 22 384 26 248 30 108 150 24 282 24z" />
        <path className="water" d="M282 50c116 0 222 60 226 172 4 132-94 232-234 232C140 454 52 368 56 248 60 124 166 50 282 50z" />
        <ellipse className="ring" cx="280" cy="250" rx="200" ry="170" />
        <ellipse className="ring r2" cx="280" cy="250" rx="200" ry="170" />
        <ellipse className="ring r3" cx="280" cy="250" rx="200" ry="170" />
        <circle className="pebble" cx="52" cy="140" r="16" />
        <circle className="pebble b" cx="78" cy="118" r="9" />
        <circle className="pebble c" cx="512" cy="356" r="14" />
        <circle className="pebble b" cx="488" cy="392" r="8" />
        <circle className="pebble c" cx="120" cy="452" r="11" />
        <path className="star" d="M476 70l9 20 22 2-16 15 5 22-20-11-19 11 4-22-16-15 22-2z" transform="rotate(12 476 92)" />
      </svg>
      {chars.slice(0, 6).map((c, k) => (
        <span key={c.slug} className="floaty" style={{ left: `${SPOTS[k]![0]}%`, top: `${SPOTS[k]![1]}%`, '--fd': SPOTS[k]![2] } as CSSProperties}>
          <img src={c.avatar!.poster} width={160} height={160} alt="" fetchPriority={k < 2 ? 'high' : undefined} decoding="async" />
        </span>
      ))}
      <span className="pool-tag" style={{ left: '-2%', top: '76%' }}>
        <Icon name="sparkle" size="sm" />
        今日新增 <b>{fmtN(today)}</b> 张
      </span>
      <span className="pool-tag" style={{ right: '2%', top: '2%' }}>
        <Icon name="download" size="sm" />
        累计下载 <b>{fmtW(downloads)}</b>
      </span>
    </div>
  )
}

export function HomePage({ home, explore, current }: { home: HomeData; explore: ExploreData | null; current: string | undefined }) {
  const s = home.stats
  const withAvatar = home.characters.filter((c) => c.avatar)
  const featured = home.featured.length ? home.featured : home.pinned.length ? home.pinned : home.latest.slice(0, 5)
  const hot = withAvatar.slice(0, 5).map((c) => c.name)

  return (
    <>
      <section className="hero">
        <div className="wrap">
          <div>
            <span className="eyebrow">Wuthering Waves Stickers</span>
            <h1>
              退潮后，
              <br />
              捡一枚<em>表情</em>
            </h1>
            <p className="lede">
              {fmtN(s.packs)} 个表情包、{fmtN(s.emojis)} 张表情，覆盖 {fmtN(s.characters)} 位角色。单张复制、跨包打包、整包下载，都在这里。
            </p>
            <div className="hero-search">
              <label className="input" onClick={() => palette.open()}>
                <Icon name="search" />
                <input readOnly placeholder="试试角色名、画师或「捏捏」" aria-label="搜索表情包、角色、画师" onFocus={() => palette.open()} />
              </label>
              <Button variant="primary" onClick={() => palette.open()}>
                搜索
              </Button>
            </div>
            {hot.length ? (
              <div className="hero-hot">
                <span>大家在搜</span>
                {hot.map((n) => (
                  <Chip key={n} size="sm" onClick={() => palette.open(n)}>
                    {n}
                  </Chip>
                ))}
              </div>
            ) : null}
            <div className="stats">
              <div className="stat">
                <b>{fmtN(s.emojis)}</b>
                <span>张表情</span>
              </div>
              <div className="stat">
                <b>{fmtN(s.packs)}</b>
                <span>个表情包</span>
              </div>
              <div className="stat">
                <b>{fmtN(s.characters)}</b>
                <span>位角色</span>
              </div>
              <div className="stat">
                <b>{fmtW(s.downloads)}</b>
                <span>次下载</span>
              </div>
            </div>
          </div>
          <PoolArt chars={withAvatar} today={s.todayEmojis} downloads={s.downloads} />
        </div>
      </section>

      {withAvatar.length ? (
        <section className="sec">
          <div className="wrap">
            <SectionHead title="角色潮汐" sub="按表情数量排序" more={{ label: `全部 ${s.characters} 位`, to: '/characters' }} />
            <div className="cstrip">
              {withAvatar.map((c) => (
                <AppLink key={c.slug} to={characterHref(c.slug)} className="cchip" style={{ '--cc': themeColor(c.color) } as CSSProperties}>
                  <span className="pool">
                    <img src={c.avatar!.poster} width={160} height={160} loading="lazy" decoding="async" alt="" />
                  </span>
                  <b>{c.name}</b>
                  <small>{fmtN(c.emojiCount)} 张</small>
                </AppLink>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {featured.length ? (
        <section className="sec">
          <div className="wrap">
            <SectionHead
              title={home.featuredCollection?.title ?? '站长精选'}
              tone="sun"
              sub={home.featuredCollection?.description ?? undefined}
              more={{ label: '全部表情包', to: '/packs' }}
            />
            <div className="feat">
              {featured.slice(0, 5).map((p, i) => (
                <PackCard key={p.id} {...cardProps(p, i, { variant: i === 0 ? 'four' : 'one', noExcerpt: i !== 0 })} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {home.latest.length ? (
        <section className="sec">
          <div className="wrap">
            <SectionHead title="新上架" tone="pink" more={{ label: '全部表情包', to: '/packs?sort=new' }} sub={s.todayEmojis ? `今天新增 ${fmtN(s.todayEmojis)} 张` : undefined} />
            <PackMasonry cards={home.latest.slice(0, 8)} label="新上架的表情包" options={(_c, i) => ({ isNew: i < 3 })} />
          </div>
        </section>
      ) : null}

      {explore?.today.emojis.length ? (
        <section className="sec">
          <div className="wrap">
            <SectionHead title="潮汐流" tone="mint" sub="今天冲上岸的表情，悬停播放" more={{ label: '进入画廊', to: '/gallery' }} />
            <StreamTiles tiles={explore.today.emojis} current={current} size={120} />
            <div className="stream-cta">
              <AppLink to="/gallery" className={buttonClass()}>
                <Icon name="wave" />
                进入潮汐画廊
              </AppLink>
            </div>
          </div>
        </section>
      ) : null}

      {explore ? (
        <section className="sec">
          <div className="wrap">
            {/* plain heading in the body font: 去探索 would pull three more display-font shards (~20 KB) */}
            <SectionHead title={<span className="dyn">去探索</span>} plain sub="按角色、画师、分组逛，或者随手抽一包" more={{ label: '探索', to: '/explore' }} />
            <div className="teasers">
              {explore.randomPack ? (
                <div className="teaser">
                  <h3>
                    <Icon name="sparkle" />
                    随机来一包
                  </h3>
                  <AppLink to={packHref(explore.randomPack.slug)} className="mini-pack">
                    {explore.randomPack.cover ? <img src={explore.randomPack.cover.poster} width={56} height={56} alt="" loading="lazy" decoding="async" /> : <span />}
                    <span>
                      <b>{explore.randomPack.title}</b>
                      <small>{explore.randomPack.count} 张</small>
                    </span>
                  </AppLink>
                  <p>每次打开都不一样。想再抽一次？去探索页。</p>
                </div>
              ) : null}
              <div className="teaser">
                <h3>
                  <Icon name="hash" />
                  按分组逛
                </h3>
                <div className="cloud">
                  {(['group', 'project', 'tool'] as const)
                    .flatMap((dim) => explore.facets.tags[dim].map((t) => ({ ...t, dim })))
                    .slice(0, 8)
                    .map((t) => (
                    <AppLink key={`${t.dim}:${t.slug}`} to={tagHref(t.dim, t.slug)} style={{ '--tg': 'var(--c-yellow)' } as CSSProperties}>
                      {t.name}
                      <small>{t.packCount}</small>
                    </AppLink>
                  ))}
                  {explore.facets.characters.slice(0, 6).map((c) => (
                    <AppLink key={c.slug} to={`/packs?character=${encodeURIComponent(c.slug)}`}>
                      {c.name}
                      <small>{c.packCount}</small>
                    </AppLink>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </>
  )
}
