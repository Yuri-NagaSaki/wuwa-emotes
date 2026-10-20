import { useCallback, useRef, useState } from 'react'
import type { Page } from '#/server/catalog/types'

// Infinite loading over a catalog cursor: the route loader supplies page 1 (SSR), later pages come
// from `load(cursor)`. A new first page (filters changed) starts a new list.
//
// Loaded pages are remembered in the browser for a while, keyed by the first page's content, so
// coming Back to a list (or the router refreshing page 1 in the background) shows every page that was
// loaded before and the scroll position can be restored, instead of falling back to page 1.

export interface CursorList<T> {
  items: T[]
  loading: boolean
  done: boolean
  error: boolean
  loadMore: () => void
}

interface State<T> {
  first: Page<T>
  key: string
  items: T[]
  cursor: string | null
  loading: boolean
  error: boolean
}

const TTL_MS = 15 * 60_000
const MAX_LISTS = 12
const remembered = new Map<string, { at: number; items: unknown[]; cursor: string | null }>()

/** The list a first page starts: its item ids and the cursor after it. */
function listKey(first: Page<unknown>): string {
  const ids = first.items.map((x) => String((x as { id?: unknown }).id ?? '')).join(',')
  return `${first.nextCursor ?? ''}|${ids}`
}

function remember(key: string, items: unknown[], cursor: string | null) {
  if (typeof window === 'undefined') return
  remembered.delete(key)
  remembered.set(key, { at: Date.now(), items, cursor })
  while (remembered.size > MAX_LISTS) remembered.delete(remembered.keys().next().value!)
}

function fresh<T>(first: Page<T>): State<T> {
  const key = listKey(first)
  const hit = typeof window === 'undefined' ? undefined : remembered.get(key)
  if (hit && Date.now() - hit.at < TTL_MS && hit.items.length > first.items.length)
    return { first, key, items: hit.items as T[], cursor: hit.cursor, loading: false, error: false }
  return { first, key, items: first.items, cursor: first.nextCursor, loading: false, error: false }
}

export function useCursorList<T>(first: Page<T>, load: (cursor: string) => Promise<Page<T>>): CursorList<T> {
  const [raw, setState] = useState<State<T>>(() => fresh(first))
  // a new page-1 object: the same list (Back, a background refresh) keeps what was loaded
  const state = raw.first === first ? raw : raw.key === listKey(first) ? { ...raw, first } : fresh(first)
  if (state !== raw) setState(state)
  const loadRef = useRef(load)
  loadRef.current = load
  const stateRef = useRef(state)
  stateRef.current = state

  const loadMore = useCallback(() => {
    const s = stateRef.current
    if (!s.cursor || s.loading) return
    const cursor = s.cursor
    const key = s.key
    setState({ ...s, loading: true, error: false })
    loadRef.current(cursor).then(
      (page) =>
        setState((p) => {
          if (p.key !== key || p.cursor !== cursor) return p
          const items = [...p.items, ...page.items]
          remember(key, items, page.nextCursor)
          return { ...p, items, cursor: page.nextCursor, loading: false }
        }),
      () => setState((p) => (p.key !== key ? p : { ...p, loading: false, error: true })),
    )
  }, [])

  return { items: state.items, loading: state.loading, done: !state.cursor, error: state.error, loadMore }
}
