import { useCallback, useRef, useState } from 'react'
import type { Page } from '#/server/catalog/types'

// Infinite loading over a catalog cursor: the route loader supplies page 1 (SSR), later pages come
// from `load(cursor)`. A new first page (filters changed) starts a new list.

export interface CursorList<T> {
  items: T[]
  loading: boolean
  done: boolean
  error: boolean
  loadMore: () => void
}

interface State<T> {
  first: Page<T>
  items: T[]
  cursor: string | null
  loading: boolean
  error: boolean
}

const fresh = <T,>(first: Page<T>): State<T> => ({ first, items: first.items, cursor: first.nextCursor, loading: false, error: false })

export function useCursorList<T>(first: Page<T>, load: (cursor: string) => Promise<Page<T>>): CursorList<T> {
  const [raw, setState] = useState<State<T>>(() => fresh(first))
  const state = raw.first === first ? raw : fresh(first)
  if (raw.first !== first) setState(state)
  const loadRef = useRef(load)
  loadRef.current = load
  const stateRef = useRef(state)
  stateRef.current = state

  const loadMore = useCallback(() => {
    const s = stateRef.current
    if (!s.cursor || s.loading) return
    const cursor = s.cursor
    const list = s.first
    setState({ ...s, loading: true, error: false })
    loadRef.current(cursor).then(
      (page) =>
        setState((p) => (p.first !== list || p.cursor !== cursor ? p : { ...p, items: [...p.items, ...page.items], cursor: page.nextCursor, loading: false })),
      () => setState((p) => (p.first !== list ? p : { ...p, loading: false, error: true })),
    )
  }, [])

  return { items: state.items, loading: state.loading, done: !state.cursor, error: state.error, loadMore }
}
