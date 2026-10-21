import type { CSSProperties } from 'react'
import type { PackCard } from '#/server/catalog/types'
import { Flag } from '../Chip'
import { AppLink } from '../link'
import { packAccent, packHref } from './model'

// 相关推荐 on the pack page (PackDetail.related, ranked in src/server/catalog/related.ts). It comes with
// the loader data, so the server renders it and the browser fetches nothing for it. Desktop: the right
// column next to the comments, one row per pack (cover well, two-line title, 画师 · N 张). Below 1100
// px: a row of small cards that scrolls sideways, above the comments (pages.css .pack-lower).

function Flags({ pack }: { pack: PackCard }) {
  if (pack.sourceKind === 'official') return <Flag kind="official" />
  if (!pack.downloadable) return <Flag kind="static">仅预览</Flag>
  return null
}

export function RelatedPacks({ packs }: { packs: readonly PackCard[] }) {
  if (!packs.length) return null
  return (
    <aside className="pack-related" aria-labelledby="related-h">
      <div className="rel-head">
        <h2 id="related-h">相关推荐</h2>
      </div>
      <ul className="rel-list" role="list">
        {packs.map((p) => (
          <li key={p.id}>
            <AppLink to={packHref(p.slug)} className="rel-item" style={{ '--acc': packAccent(p) } as CSSProperties}>
              <span className="rel-cover">
                {p.cover ? <img src={p.cover.poster} width={240} height={240} loading="lazy" decoding="async" alt="" /> : null}
              </span>
              <span className="rel-body">
                <span className="rel-t">{p.title}</span>
                <span className="rel-meta">
                  <Flags pack={p} />
                  {p.artists.length ? <span className="rel-by">画师 {p.artists.map((a) => a.name).join('、')}</span> : null}
                  <span className="rel-n">{p.count} 张</span>
                </span>
              </span>
            </AppLink>
          </li>
        ))}
      </ul>
    </aside>
  )
}
