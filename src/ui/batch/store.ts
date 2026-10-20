import { EMOJI_ID_RE } from '#/shared/ids'

// 打包清单 store: an ordered list of emoji ids kept in localStorage, shared by every component and kept
// in sync across tabs. Only ids live here; the tray UI, /batch, signing and zipping build on it
// (docs/ARCHITECTURE.md §6.1). No React or DOM imports: tests drive it with a fake storage.

export const BATCH_STORAGE_KEY = 'tp-batch-v1'
/** Hard cap on stored ids (a ZIP volume holds 200; this only stops runaway growth). */
export const BATCH_MAX = 2000

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface BatchStore {
  /** Ids in the order they were added. Same array until the list changes (useSyncExternalStore). */
  ids(): readonly string[]
  has(id: string): boolean
  count(): number
  /** Adds unknown, valid ids at the end; returns how many were added. */
  add(ids: string | readonly string[]): number
  /** Returns how many were removed. */
  remove(ids: string | readonly string[]): number
  clear(): void
  /** Re-read storage (another tab changed it). */
  reload(): void
  subscribe(listener: () => void): () => void
}

function parse(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return [...new Set(v.filter((x): x is string => typeof x === 'string' && EMOJI_ID_RE.test(x)))].slice(0, BATCH_MAX)
  } catch {
    return []
  }
}

/** A store over `storage`; null storage (server, blocked storage) keeps the list in memory only. */
export function createBatchStore(storage: StorageLike | null, key = BATCH_STORAGE_KEY): BatchStore {
  let list: readonly string[] = []
  let set = new Set<string>()
  const listeners = new Set<() => void>()

  const read = () => {
    let raw: string | null = null
    try {
      raw = storage?.getItem(key) ?? null
    } catch {
      raw = null
    }
    return parse(raw)
  }
  const commit = (next: string[], persist: boolean) => {
    list = next
    set = new Set(next)
    if (persist) {
      try {
        if (next.length) storage?.setItem(key, JSON.stringify(next))
        else storage?.removeItem(key)
      } catch {
        // quota or blocked storage: the list still works for this page
      }
    }
    listeners.forEach((l) => l())
  }
  const asList = (ids: string | readonly string[]) => (typeof ids === 'string' ? [ids] : ids)

  list = read()
  set = new Set(list)

  return {
    ids: () => list,
    has: (id) => set.has(id),
    count: () => list.length,
    add(ids) {
      const fresh = [...new Set(asList(ids))].filter((id) => EMOJI_ID_RE.test(id) && !set.has(id))
      const room = Math.max(0, BATCH_MAX - list.length)
      const added = fresh.slice(0, room)
      if (added.length) commit([...list, ...added], true)
      return added.length
    },
    remove(ids) {
      const drop = new Set(asList(ids))
      const next = list.filter((id) => !drop.has(id))
      const removed = list.length - next.length
      if (removed) commit(next, true)
      return removed
    },
    clear() {
      if (list.length) commit([], true)
    },
    reload() {
      const next = read()
      if (next.length !== list.length || next.some((id, i) => id !== list[i])) commit(next, false)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

let shared: BatchStore | null = null

/** The page-wide store (localStorage in the browser, memory on the server). */
export function batchStore(): BatchStore {
  if (shared) return shared
  if (typeof window === 'undefined') return (shared = createBatchStore(null))
  let storage: StorageLike | null = null
  try {
    storage = window.localStorage
  } catch {
    storage = null
  }
  const store = createBatchStore(storage)
  window.addEventListener('storage', (e) => {
    if (e.key === BATCH_STORAGE_KEY || e.key === null) store.reload()
  })
  return (shared = store)
}
