import { describe, expect, test } from 'bun:test'
import { STATUS_BATCH, statusBatches } from '#/ui/pages/useFavorite'

// src/ui/pages/useFavorite.ts: which hearts a page asks the server about. The answer to a call is
// capped at STATUS_BATCH targets (src/server/favorites/fn.ts allows the same), and a page that grows
// asks only about the new targets.

const key = (t: { id: string }) => `emoji:${t.id}`
const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `r-${from + i}` }))

describe('favorite status batches', () => {
  test('a long pack is asked about in calls of at most STATUS_BATCH', () => {
    const batches = statusBatches(ids(250), key, new Set())
    expect(batches.map((b) => b.length)).toEqual([STATUS_BATCH, STATUS_BATCH, 50])
    expect(STATUS_BATCH).toBe(100)
  })

  test('targets already asked about are skipped, duplicates asked once', () => {
    const seen = new Set(ids(120).map(key))
    const batches = statusBatches([...ids(130), ...ids(5, 125)], key, seen)
    expect(batches.flat().map((t) => t.id)).toEqual(ids(10, 120).map((t) => t.id))
  })

  test('nothing new, no call', () => {
    expect(statusBatches(ids(3), key, new Set(ids(3).map(key)))).toEqual([])
  })
})
