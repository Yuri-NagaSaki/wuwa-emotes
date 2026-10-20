import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { galleryFn } from '#/server/catalog/fns'
import type { EmojiTile } from '#/server/catalog/types'
import { Button, buttonClass } from '../Button'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { SectionHead } from '../Section'
import { Tile, TileGrid } from '../Tile'
import { palette } from './palette'

// 404 inside the public layout (the prototype's empty tidepool): no dead end, three ways out (search,
// home, browse) and a few random stickers (也许你想看), fetched in the browser so the 404 HTML stays
// static. A sticker opens its own /e page.

export function NotFound({ what = '页面' }: { what?: string }) {
  const navigate = useNavigate()
  const [tiles, setTiles] = useState<readonly EmojiTile[]>([])
  useEffect(() => {
    let live = true
    galleryFn({ data: { sort: 'random', limit: 8 } }).then(
      (p) => live && setTiles(p.items),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [])
  return (
    <div className="wrap">
      <div className="nf">
        <span className="code" aria-hidden="true">
          404
        </span>
        <EmptyPool />
        <h1>这里没有你要找的{what}</h1>
        <p className="muted">链接可能已经失效，或者表情包被作者下架了。可以搜一下，或者随便看看。</p>
        <div className="nf-acts">
          <Button variant="primary" icon="search" onClick={() => palette.open()}>
            搜索表情
          </Button>
          <AppLink to="/" className={buttonClass()}>
            <Icon name="home" />
            回到首页
          </AppLink>
        </div>
      </div>
      {tiles.length ? (
        <section className="sec">
          <SectionHead plain title="也许你想看" more={{ label: '全部表情包', to: '/packs' }} />
          <TileGrid>
            {tiles.map((t) => (
              <Tile
                key={t.id}
                poster={t.poster}
                preview={t.preview}
                alt={`${t.pack.title} 的表情`}
                format={t.format}
                onOpen={() => void navigate({ to: '/e/$emojiId', params: { emojiId: t.id } })}
              />
            ))}
          </TileGrid>
        </section>
      ) : null}
    </div>
  )
}

/** The prototype's empty tidepool (emptyArt): sand rim, shallow water, a ripple, a starfish. */
export function EmptyPool() {
  return (
    <svg className="nf-art" viewBox="0 0 180 110" aria-hidden="true">
      <ellipse className="rim" cx="90" cy="70" rx="82" ry="34" />
      <ellipse className="water" cx="90" cy="68" rx="66" ry="24" />
      <path className="ripple" d="M60 66c6-5 12-5 18 0s12 5 18 0 12-5 18 0" />
      <path className="star" d="M128 26l4 9 10 1-7 7 2 10-9-5-9 5 2-10-7-7 10-1z" />
    </svg>
  )
}
