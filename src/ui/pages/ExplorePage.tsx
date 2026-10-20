import { useRouter } from '@tanstack/react-router'
import type { CSSProperties } from 'react'
import type { CountedRef, ExploreData } from '#/server/catalog/types'
import { Button } from '../Button'
import { PackCard } from '../PackCard'
import { SectionHead } from '../Section'
import { artistHref, cardProps, characterHref, KIND_LABEL, SOURCE_LABEL, tagHref } from './model'
import { StreamTiles } from './StreamTiles'

// 探索 /explore: a random pack and sticker (再抽一次 reloads them), today's picks (stable for the
// Asia/Shanghai day) and every facet as a cloud linking into the /packs filters. Font size grows with
// the square root of the pack count so the most drawn characters don't swamp the rest.

const PALETTE = ['pink', 'purple', 'blue', 'yellow', 'orange', 'mint', 'green', 'red', 'lime', 'peach', 'teal', 'brown']
const size = (n: number) => `${Math.min(22, 12 + Math.sqrt(n) * 1.4).toFixed(1)}px`

function Cloud({ items, href, color }: { items: CountedRef[]; href: (slug: string) => string; color?: string }) {
  return (
    <div className="cloud">
      {items.map((v, i) => (
        <a key={v.slug} href={href(v.slug)} style={{ '--tg': color ?? `var(--c-${PALETTE[i % PALETTE.length]})`, fontSize: size(v.packCount) } as CSSProperties}>
          {v.name}
          <small>{v.packCount}</small>
        </a>
      ))}
    </div>
  )
}

export function ExplorePage({ data, current }: { data: ExploreData; current: string | undefined }) {
  const router = useRouter()
  const f = data.facets
  const tagGroups: [string, keyof typeof f.tags][] = [
    ['分组', 'group'],
    ['工具', 'tool'],
    ['企划', 'project'],
    ['原设', 'origin'],
    ['标签', 'custom'],
  ]
  const kinds: CountedRef[] = f.kinds.map((k) => ({ slug: k.kind, name: KIND_LABEL[k.kind] ?? k.kind, packCount: k.packCount }))
  const sources: CountedRef[] = f.sources.map((s) => ({ slug: s.sourceKind, name: SOURCE_LABEL[s.sourceKind] ?? s.sourceKind, packCount: s.packCount }))

  return (
    <div className="wrap">
      <div className="page-h">
        <h1>探索</h1>
        <span className="sub">随手抽一包，看看今天的推荐，或者按角色、画师、分组逛。字号代表表情包的数量。</span>
      </div>

      <div className="explore-top" style={{ marginTop: 18 }}>
        <div className="facet">
          <h3>
            随机一包
            <Button size="xs" icon="refresh" onClick={() => void router.invalidate()} style={{ marginLeft: 'auto' }}>
              再抽一次
            </Button>
          </h3>
          {data.randomPack ? <PackCard {...cardProps(data.randomPack, 0, { variant: 'four' })} /> : <p className="muted">还没有表情包。</p>}
        </div>
        <div className="facet">
          <h3>今日推荐 · {data.today.day}</h3>
          <StreamTiles tiles={data.today.emojis} current={current} size={96} />
          {data.today.packs.length ? (
            <div className="mini-packs">
              {data.today.packs.map((p) => (
                <a key={p.id} href={`/packs/${encodeURIComponent(p.slug)}`} className="mini-pack">
                  {p.cover ? <img src={p.cover.poster} width={56} height={56} alt="" loading="lazy" decoding="async" /> : <span />}
                  <span>
                    <b>{p.title}</b>
                    <small>{p.count} 张</small>
                  </span>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <section className="sec">
        <SectionHead title="按角色" plain sub={`${f.characters.length} 位`} />
        <div className="facet">
          <Cloud items={f.characters} href={(s) => characterHref(s)} />
        </div>
      </section>
      <section className="sec">
        <div className="facets-2">
          <div className="facet">
            <h3>
              画师 <small>{f.artists.length}</small>
            </h3>
            <Cloud items={f.artists} href={(s) => artistHref(s)} color="var(--c-purple)" />
          </div>
          {tagGroups
            .filter(([, dim]) => f.tags[dim].length)
            .map(([label, dim]) => (
              <div key={dim} className="facet">
                <h3>
                  {label} <small>{f.tags[dim].length}</small>
                </h3>
                <Cloud items={f.tags[dim]} href={(s) => tagHref(dim, s)} color="var(--c-yellow)" />
              </div>
            ))}
          <div className="facet">
            <h3>类型与来源</h3>
            <Cloud items={kinds} href={(s) => `/packs?kind=${s}`} color="var(--c-mint)" />
            <Cloud items={sources} href={(s) => `/packs?source=${s}`} color="var(--c-blue)" />
          </div>
        </div>
      </section>
    </div>
  )
}
