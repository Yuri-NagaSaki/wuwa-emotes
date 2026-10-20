import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useHydrating } from '../hydration'
import { Tile } from '../Tile'
import type { DialogEmoji } from './model'

// Sticker grids with many tiles (pack pages, streams): one memoized item per sticker with stable
// handlers, so opening the dialog, ←/→, closing it or a favorite change re-renders only the tiles whose
// props changed instead of every tile; and progressive mounting for long pack grids.

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface TileActions {
  open(index: number): void
  copy(e: DialogEmoji): void
  download(id: string): void
  add(id: string): void
  favorite(id: string): void
}

/** An object with the same methods as `impl` whose identity never changes; calls go to the latest impl. */
export function useStableActions<T extends { [K in keyof T]: (...args: never[]) => unknown }>(impl: T): T {
  const ref = useRef(impl)
  useIsoLayoutEffect(() => {
    ref.current = impl
  })
  const [stable] = useState(() => {
    const out = {} as Record<string, unknown>
    for (const k of Object.keys(impl)) out[k] = (...args: unknown[]) => (ref.current[k as keyof T] as unknown as (...a: unknown[]) => unknown)(...args)
    return out as T
  })
  return stable
}

export interface TileItemProps {
  e: DialogEmoji
  index: number
  alt: string
  favorite: boolean
  previewOnly: boolean
  selecting?: boolean
  selected?: boolean
  actions: TileActions
}

export const TileItem = memo(function TileItem({ e, index, alt, favorite, previewOnly, selecting, selected, actions }: TileItemProps) {
  return (
    <Tile
      poster={e.poster}
      preview={e.preview}
      alt={alt}
      format={e.format}
      selecting={selecting}
      selected={selected}
      previewOnly={previewOnly}
      onOpen={() => actions.open(index)}
      onCopy={previewOnly ? undefined : () => actions.copy(e)}
      onDownload={previewOnly ? undefined : () => actions.download(e.id)}
      onAdd={previewOnly ? undefined : () => actions.add(e.id)}
      favorite={favorite}
      onFavorite={() => actions.favorite(e.id)}
    />
  )
})

/** Tiles fully rendered on a client-side mount before the rest come near the viewport. */
export const INITIAL_LIVE_TILES = 48

export interface LiveTiles {
  isLive(index: number): boolean
  /** Ref for a placeholder cell (`data-i` = its index): it turns live when it comes within a screen. */
  observe(el: HTMLElement | null): (() => void) | undefined
}

/**
 * Progressive mounting for a long tile grid. The server and the hydrating render show every tile.
 * A client-side mount (navigation, Back) renders the first INITIAL_LIVE_TILES tiles and a plain
 * `.tile` cell for each of the others: same grid cell, same size, so the page height and scroll
 * restoration are exact. A cell becomes a real tile (with its image) once it comes within one viewport
 * of the screen, and stays one. `key` identifies the list (a new pack starts over).
 */
export function useLiveTiles(key: string | number, count: number): LiveTiles {
  const hydrating = useHydrating()
  const [state, setState] = useState(() => initial(key, count, hydrating))
  // another pack in the same page instance (prev/next links): a client-side start
  const current = state.key === key ? state : initial(key, count, false)
  if (current !== state) setState(current)

  const io = useRef<IntersectionObserver | null>(null)
  const ioFor = useRef<string | number | null>(null)
  useEffect(() => () => io.current?.disconnect(), [])

  const observe = useCallback(
    (el: HTMLElement | null) => {
      if (!el || typeof IntersectionObserver === 'undefined') return undefined
      if (!io.current || ioFor.current !== key) {
        io.current?.disconnect()
        ioFor.current = key
        io.current = new IntersectionObserver(
          (entries) => {
            const add: number[] = []
            for (const en of entries) {
              if (!en.isIntersecting) continue
              add.push(Number((en.target as HTMLElement).dataset.i))
              io.current?.unobserve(en.target)
            }
            if (add.length)
              setState((s) => {
                if (s.key !== key || s.all) return s
                const live = new Set(s.live)
                for (const i of add) live.add(i)
                return { ...s, live }
              })
          },
          { rootMargin: '100% 0px' },
        )
      }
      const obs = io.current
      obs.observe(el)
      return () => obs.unobserve(el)
    },
    [key],
  )

  return {
    isLive: (i) => current.all || i < INITIAL_LIVE_TILES || current.live.has(i),
    observe,
  }
}

interface LiveState {
  key: string | number
  all: boolean
  live: ReadonlySet<number>
}

function initial(key: string | number, count: number, hydrating: boolean): LiveState {
  return { key, all: hydrating || count <= INITIAL_LIVE_TILES, live: new Set() }
}
