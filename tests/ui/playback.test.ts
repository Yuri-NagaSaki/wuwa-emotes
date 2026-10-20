import { describe, expect, test } from 'bun:test'
import { canPlayPreviews, createPlaybackLimiter } from '#/ui/playback'

function harness(max = 4) {
  const limiter = createPlaybackLimiter(max)
  const state = new Map<string, boolean>()
  const events: string[] = []
  const cb = (id: string) => (playing: boolean) => {
    state.set(id, playing)
    events.push(`${id}:${playing ? 'on' : 'off'}`)
  }
  const want = (id: string, source: 'hover' | 'view', on = true) => limiter.want(id, source, on, cb(id))
  const playing = () => [...state].filter(([, p]) => p).map(([id]) => id).sort()
  return { limiter, want, playing, events }
}

describe('playback limiter', () => {
  test('at most four play; the fifth waits for a free slot', () => {
    const h = harness()
    for (const id of ['a', 'b', 'c', 'd', 'e']) h.want(id, 'view')
    expect(h.playing()).toEqual(['a', 'b', 'c', 'd'])
    h.want('b', 'view', false)
    expect(h.playing()).toEqual(['a', 'c', 'd', 'e'])
  })

  test('a newly scrolled-in tile does not stop one already playing', () => {
    const h = harness()
    for (const id of ['a', 'b', 'c', 'd']) h.want(id, 'view')
    h.events.length = 0
    h.want('e', 'view')
    expect(h.events).toEqual([])
  })

  test('hover wins over viewport-center playback and gives the slot back afterwards', () => {
    const h = harness()
    for (const id of ['a', 'b', 'c', 'd']) h.want(id, 'view')
    h.want('x', 'hover')
    expect(h.playing()).toEqual(['a', 'b', 'c', 'x']) // the latest view entry yields
    h.want('x', 'hover', false)
    expect(h.playing()).toEqual(['a', 'b', 'c', 'd'])
  })

  test('the most recent hover ranks first when hovers overflow', () => {
    const h = harness(2)
    h.want('a', 'hover')
    h.want('b', 'hover')
    h.want('c', 'hover')
    expect(h.limiter.playing()).toEqual(['c', 'b'])
  })

  test('re-requesting keeps the original place in line', () => {
    const h = harness(2)
    h.want('a', 'view')
    h.want('b', 'view')
    h.want('c', 'view')
    h.want('a', 'view')
    expect(h.limiter.playing()).toEqual(['a', 'b'])
  })

  test('a tile both hovered and in view stays playing until both end', () => {
    const h = harness()
    h.want('a', 'view')
    h.want('a', 'hover')
    h.want('a', 'hover', false)
    expect(h.playing()).toEqual(['a'])
    h.want('a', 'view', false)
    expect(h.playing()).toEqual([])
  })

  test('forget and clear stop playback', () => {
    const h = harness()
    for (const id of ['a', 'b', 'c', 'd', 'e']) h.want(id, 'view')
    h.limiter.forget('a')
    expect(h.limiter.playing()).toEqual(['b', 'c', 'd', 'e'])
    h.limiter.clear()
    expect(h.playing()).toEqual([])
    expect(h.limiter.playing()).toEqual([])
  })

  test('withdrawing a wish that was never made is a no-op', () => {
    const h = harness()
    h.want('z', 'hover', false)
    expect(h.events).toEqual([])
  })
})

describe('canPlayPreviews', () => {
  const ok = { reducedMotion: false, saveData: false, pref: 'on' as const }
  test('plays by default', () => expect(canPlayPreviews(ok)).toBe(true))
  test('reduced motion turns previews off', () => expect(canPlayPreviews({ ...ok, reducedMotion: true })).toBe(false))
  test('Save-Data turns previews off', () => expect(canPlayPreviews({ ...ok, saveData: true })).toBe(false))
  test('the 自动播放 switch turns previews off', () => expect(canPlayPreviews({ ...ok, pref: 'off' })).toBe(false))
})
