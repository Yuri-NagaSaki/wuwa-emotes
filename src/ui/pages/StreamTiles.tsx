import { lazy, Suspense, useMemo, type ReactNode } from 'react'
import type { EmojiTile } from '#/server/catalog/types'
import { Tile, TileGrid } from '../Tile'
import { copyImage } from './clipboard'
import { fromTile } from './model'
import { useAddToBatch } from './useBatch'
import { useDownload } from './useDownload'
import { useEmojiParam } from './useEmojiParam'
import { favoriteKey, toggleFavorite, useFavoriteKeys, useFavoriteStatus } from './useFavorite'

// A square grid of stickers from many packs, opening the single-emoji dialog (?e=, masked as /e/<id>).
// The dialog code loads on first open (these pages never render it on the server).

const EmojiDialog = lazy(() => import('./EmojiDialog').then((m) => ({ default: m.EmojiDialog })))

export interface StreamTilesProps {
  tiles: readonly EmojiTile[]
  /** the route's ?e= value */
  current: string | undefined
  size?: 96 | 110 | 120 | 132 | 150
  /** render the grid yourself (e.g. virtualized); gets one rendered tile per item */
  layout?: (tiles: ReactNode[]) => ReactNode
}

export function StreamTiles({ tiles, current, size = 120, layout }: StreamTilesProps) {
  const items = useMemo(() => tiles.map(fromTile), [tiles])
  const ids = useMemo(() => tiles.map((t) => t.id), [tiles])
  const dlg = useEmojiParam(ids, current)
  const dl = useDownload()
  const add = useAddToBatch()
  const favKeys = useFavoriteKeys()
  useFavoriteStatus(useMemo(() => tiles.map((t) => ({ type: 'emoji' as const, id: t.id })), [tiles]))

  const rendered = items.map((e, i) => {
    const pv = !e.pack.downloadable
    return (
      <Tile
        key={e.id}
        poster={e.poster}
        preview={e.preview}
        alt={`${e.pack.title} 的表情`}
        format={e.format}
        previewOnly={pv}
        onOpen={() => dlg.onOpen(i)}
        onCopy={pv ? undefined : () => void copyImage(e)}
        onDownload={pv ? undefined : () => void dl.run({ kind: 'emoji', id: e.id, mode: 'save' })}
        onAdd={pv ? undefined : () => add(e.id)}
        favorite={favKeys.has(favoriteKey({ type: 'emoji', id: e.id }))}
        onFavorite={() => void toggleFavorite({ type: 'emoji', id: e.id })}
      />
    )
  })

  return (
    <>
      {layout ? layout(rendered) : <TileGrid size={size}>{rendered}</TileGrid>}
      {dlg.open != null && items[dlg.open] ? (
        <Suspense fallback={null}>
          <EmojiDialog items={items} index={dlg.open} onIndex={dlg.onIndex} onClose={dlg.onClose} linkPack />
        </Suspense>
      ) : null}
    </>
  )
}
