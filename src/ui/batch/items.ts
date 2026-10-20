import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { batchItemsFn } from '#/server/catalog/fns'
import type { BatchItem } from '#/server/catalog/types'
import { batchView, chunks, ITEMS_PAGE, type BatchView } from './plan'

// Details of the ids in the 打包清单 (thumbnail, size, pack), fetched once per id for the page's lifetime
// and shared by the tray and /batch. An id the server does not return is not public: cached as null.

const known = new Map<string, BatchItem | null>()
const inflight = new Set<string>()
let version = 0
let failed: string | null = null
const listeners = new Set<() => void>()
const emit = () => {
  version++
  listeners.forEach((l) => l())
}

async function load(ids: readonly string[]) {
  const todo = ids.filter((id) => !known.has(id) && !inflight.has(id))
  if (!todo.length) return
  todo.forEach((id) => inflight.add(id))
  try {
    for (const page of chunks(todo, ITEMS_PAGE)) {
      const items = await batchItemsFn({ data: { ids: page } })
      const got = new Map(items.map((i) => [i.id, i]))
      for (const id of page) known.set(id, got.get(id) ?? null)
      failed = null
      emit()
    }
  } catch {
    failed = '清单里的表情没有读取成功'
    emit()
  } finally {
    todo.forEach((id) => inflight.delete(id))
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export interface BatchItems {
  view: BatchView
  error: string | null
  retry: () => void
}

/** The list sorted for display; loads what is not known yet. */
export function useBatchItems(ids: readonly string[]): BatchItems {
  const v = useSyncExternalStore(subscribe, () => version, () => 0)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    void load(ids)
  }, [ids, attempt])
  // `v` changes whenever the cache does
  const view = useMemo(() => batchView(ids, known), [ids, v])
  return {
    view,
    error: failed && view.loading.length ? failed : null,
    retry: () => {
      failed = null
      setAttempt((a) => a + 1)
    },
  }
}
