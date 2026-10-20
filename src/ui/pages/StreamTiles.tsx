import { useEffect, useMemo, type ReactNode } from 'react'
import type { EmojiTile } from '#/server/catalog/types'
import { TileGrid } from '../Tile'
import { copyImage } from './clipboard'
import { EmojiDialogHost, prefetchEmojiDialog } from './dialog-loader'
import { type DialogEmoji, fromTile } from './model'
import { useAddToBatch } from './useBatch'
import { useDownload } from './useDownload'
import { useEmojiParam } from './useEmojiParam'
import { favoriteKey, toggleFavorite, useFavoriteKeys, useFavoriteStatus } from './useFavorite'
import { TileItem, useStableActions } from './tile-items'

// A square grid of stickers from many packs, opening the single-emoji dialog (?e=, masked as /e/<id>).
// The dialog code is prefetched on the first press (these pages never render it on the server).


// one dialog item per catalog tile object: loading another page keeps the earlier items (and their
// memoized tiles) as they are
const asDialog = new WeakMap<EmojiTile, DialogEmoji>()
const dialogItem = (t: EmojiTile): DialogEmoji => {
  let d = asDialog.get(t)
  if (!d) asDialog.set(t, (d = fromTile(t)))
  return d
}

export interface StreamTilesProps {
  tiles: readonly EmojiTile[]
  /** the route's ?e= value */
  current: string | undefined
  size?: 96 | 110 | 120 | 132 | 150
  /** render the grid yourself (e.g. virtualized); gets one rendered tile per item */
  layout?: (tiles: ReactNode[]) => ReactNode
}

export function StreamTiles({ tiles, current, size = 120, layout }: StreamTilesProps) {
  const items = useMemo(() => tiles.map(dialogItem), [tiles])
  const ids = useMemo(() => tiles.map((t) => t.id), [tiles])
  const dlg = useEmojiParam(ids, current)
  const dl = useDownload()
  const add = useAddToBatch()
  const favKeys = useFavoriteKeys()
  useFavoriteStatus(useMemo(() => tiles.map((t) => ({ type: 'emoji' as const, id: t.id })), [tiles]))

  useEffect(() => prefetchEmojiDialog(), [])
  // stable handlers + memoized items: opening the dialog or a heart re-renders only what changed
  const actions = useStableActions({
    open: (i: number) => dlg.onOpen(i),
    copy: (e: (typeof items)[number]) => void copyImage(e),
    download: (id: string) => void dl.run({ kind: 'emoji', id, mode: 'save' }),
    add: (id: string) => add(id),
    favorite: (id: string) => void toggleFavorite({ type: 'emoji', id }),
  })
  const rendered = items.map((e, i) => (
    <TileItem
      key={e.id}
      e={e}
      index={i}
      alt={`${e.pack.title} 的表情`}
      previewOnly={!e.pack.downloadable}
      favorite={favKeys.has(favoriteKey({ type: 'emoji', id: e.id }))}
      actions={actions}
    />
  ))

  return (
    <>
      {layout ? layout(rendered) : <TileGrid size={size}>{rendered}</TileGrid>}
      {dlg.open != null && items[dlg.open] ? <EmojiDialogHost items={items} index={dlg.open} onIndex={dlg.onIndex} onClose={dlg.onClose} linkPack /> : null}
    </>
  )
}
