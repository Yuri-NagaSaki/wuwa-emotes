import { describe, expect, test } from 'bun:test'
import { BATCH_MAX, BATCH_STORAGE_KEY, createBatchStore, type StorageLike } from '#/ui/batch/store'

const id = (n: number) => `r-${n.toString(16).padStart(20, '0')}`

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const s: StorageLike & { data: Map<string, string>; failWrites: boolean } = {
    data,
    failWrites: false,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (s.failWrites) throw new Error('QuotaExceededError')
      data.set(k, v)
    },
    removeItem: (k) => void data.delete(k),
  }
  return s
}

describe('打包清单 store', () => {
  test('add / has / count / ids keep insertion order and persist', () => {
    const storage = memoryStorage()
    const s = createBatchStore(storage)
    expect(s.count()).toBe(0)
    expect(s.add(id(1))).toBe(1)
    expect(s.add([id(2), id(3)])).toBe(2)
    expect(s.ids()).toEqual([id(1), id(2), id(3)])
    expect(s.has(id(2))).toBe(true)
    expect(s.has(id(9))).toBe(false)
    expect(JSON.parse(storage.data.get(BATCH_STORAGE_KEY)!)).toEqual([id(1), id(2), id(3)])
    // a second store on the same storage (another page load) sees the same list
    expect(createBatchStore(storage).ids()).toEqual([id(1), id(2), id(3)])
  })

  test('duplicates and malformed ids are ignored', () => {
    const s = createBatchStore(memoryStorage())
    expect(s.add([id(1), id(1), 'r-XYZ', '../etc', ''])).toBe(1)
    expect(s.add(id(1))).toBe(0)
    expect(s.count()).toBe(1)
  })

  test('remove and clear; an empty list leaves nothing in storage', () => {
    const storage = memoryStorage()
    const s = createBatchStore(storage)
    s.add([id(1), id(2), id(3)])
    expect(s.remove(id(2))).toBe(1)
    expect(s.remove([id(2), id(7)])).toBe(0)
    expect(s.ids()).toEqual([id(1), id(3)])
    s.clear()
    expect(s.count()).toBe(0)
    expect(storage.data.has(BATCH_STORAGE_KEY)).toBe(false)
  })

  test('the snapshot array is stable until the list changes (useSyncExternalStore)', () => {
    const s = createBatchStore(memoryStorage())
    s.add(id(1))
    const a = s.ids()
    expect(s.ids()).toBe(a)
    s.add(id(1)) // no change
    expect(s.ids()).toBe(a)
    s.add(id(2))
    expect(s.ids()).not.toBe(a)
  })

  test('subscribers hear every change, and can unsubscribe', () => {
    const s = createBatchStore(memoryStorage())
    let calls = 0
    const off = s.subscribe(() => calls++)
    s.add(id(1))
    s.add(id(1))
    s.remove(id(1))
    expect(calls).toBe(2)
    off()
    s.add(id(3))
    expect(calls).toBe(2)
  })

  test('reload picks up another tab’s writes', () => {
    const storage = memoryStorage()
    const a = createBatchStore(storage)
    const b = createBatchStore(storage)
    let heard = 0
    b.subscribe(() => heard++)
    a.add([id(1), id(2)])
    b.reload()
    expect(b.ids()).toEqual([id(1), id(2)])
    expect(heard).toBe(1)
    b.reload() // unchanged: no notification
    expect(heard).toBe(1)
  })

  test('corrupt or foreign storage content is tolerated', () => {
    expect(createBatchStore(memoryStorage({ [BATCH_STORAGE_KEY]: '{not json' })).ids()).toEqual([])
    expect(createBatchStore(memoryStorage({ [BATCH_STORAGE_KEY]: '{"a":1}' })).ids()).toEqual([])
    expect(createBatchStore(memoryStorage({ [BATCH_STORAGE_KEY]: JSON.stringify([id(1), 5, 'x', id(1), id(2)]) })).ids()).toEqual([id(1), id(2)])
  })

  test('storage failures keep the in-memory list working; no storage at all = memory only', () => {
    const storage = memoryStorage()
    storage.failWrites = true
    const s = createBatchStore(storage)
    expect(s.add(id(1))).toBe(1)
    expect(s.has(id(1))).toBe(true)
    const mem = createBatchStore(null)
    mem.add(id(4))
    expect(mem.ids()).toEqual([id(4)])
  })

  test('the list is capped', () => {
    const s = createBatchStore(memoryStorage())
    expect(s.add(Array.from({ length: BATCH_MAX + 50 }, (_, i) => id(i)))).toBe(BATCH_MAX)
    expect(s.count()).toBe(BATCH_MAX)
    expect(s.add(id(BATCH_MAX + 100))).toBe(0)
  })
})
