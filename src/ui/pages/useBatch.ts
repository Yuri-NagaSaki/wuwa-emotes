import { useCallback, useSyncExternalStore } from 'react'
import { batchStore } from '../batch/store'
import { toast } from '../Toast'

// React side of the 打包清单 store. Server snapshots are empty: the list lives in localStorage, and
// anonymous HTML must not depend on the visitor.

const NONE: readonly string[] = []
const subscribe = (l: () => void) => batchStore().subscribe(l)

export function useBatchIds(): readonly string[] {
  return useSyncExternalStore(subscribe, () => batchStore().ids(), () => NONE)
}

export function useBatchCount(): number {
  return useSyncExternalStore(subscribe, () => batchStore().count(), () => 0)
}

export function useInBatch(id: string): boolean {
  return useSyncExternalStore(subscribe, () => batchStore().has(id), () => false)
}

/** Add stickers and confirm with a toast. */
export function useAddToBatch() {
  return useCallback((ids: string | readonly string[]) => {
    const list = typeof ids === 'string' ? [ids] : ids
    const added = batchStore().add(list)
    const total = batchStore().count()
    if (added) toast({ message: added > 1 ? `已加入打包 ${added} 张` : '已加入打包清单', detail: `共 ${total} 张`, icon: 'box' })
    else toast({ message: list.length > 1 ? '这些表情都已在打包清单里' : '已经在打包清单里了', detail: `共 ${total} 张`, icon: 'box' })
    return added
  }, [])
}
