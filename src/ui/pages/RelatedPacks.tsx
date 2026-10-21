import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { PackCard } from '#/server/catalog/types'
import { Flag } from '../Chip'
import { useHydrating } from '../hydration'
import { AppLink } from '../link'
import { packAccent, packHref } from './model'

// 相关推荐 on the pack page (PackDetail.related, ranked in src/server/catalog/related.ts). It comes with
// the loader data, so the server renders it and the browser fetches nothing for it. Desktop: the right
// column next to the comments, one row per pack (cover well, two-line title, 画师 · N 张). Below 1100
// px: a row of small cards that scrolls sideways, above the comments (pages.css .pack-lower).
//
// The server and the hydrating render show the list. A pack page opened by client navigation renders
// it once the column comes within a screen of the viewport, so the ten links cost the route change
// nothing; the column keeps its exact height meanwhile (pages.css), so nothing moves.

function Flags({ pack }: { pack: PackCard }) {
  if (pack.sourceKind === 'official') return <Flag kind="official" />
  if (!pack.downloadable) return <Flag kind="static">仅预览</Flag>
  return null
}

export function RelatedPacks({ packs }: { packs: readonly PackCard[] }) {
  const ref = useRef<HTMLElement>(null)
  const hydrating = useHydrating()
  const [near, setNear] = useState(hydrating)
  useEffect(() => {
    const el = ref.current
    if (near || !el) return
    if (typeof IntersectionObserver === 'undefined') return setNear(true)
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '100% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])
  if (!packs.length) return null
  return (
    <aside ref={ref} className="pack-related" aria-labelledby="related-h" style={{ '--rel-n': packs.length } as CSSProperties}>
      <div className="rel-head">
        <h2 id="related-h">相关推荐</h2>
      </div>
      <ul className="rel-list" role="list">
        {near
          ? packs.map((p) => (
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
            ))
          : null}
      </ul>
    </aside>
  )
}
