// Animated-preview playback rules for emoji tiles (pure logic, no React or DOM, unit-tested).
//
// Grids show the static p240 poster. A tile swaps to its a160 animated preview while the pointer (or
// keyboard focus) is on it, or while it sits in the middle band of the viewport. At most `max` tiles
// (4) play at once: hovered tiles first (most recent first), then tiles in view in the order they
// entered, so a newly scrolled-in tile waits instead of stopping one that is already playing.

export type PlaySource = 'hover' | 'view'

export interface PlaybackLimiter {
  /** Declare (or withdraw) a tile's wish to play for a given reason. */
  want(id: string, source: PlaySource, on: boolean, onChange: (playing: boolean) => void): void
  /** Forget a tile entirely (unmount). */
  forget(id: string): void
  /** Ids currently playing, in priority order. */
  playing(): string[]
  /** Drop every wish (e.g. when the user turns playback off). */
  clear(): void
}

interface Entry {
  hover: number // 0 = not hovered, else the request sequence number
  view: number // 0 = not in view
  playing: boolean
  onChange: (playing: boolean) => void
}

export function createPlaybackLimiter(max = 4): PlaybackLimiter {
  const entries = new Map<string, Entry>()
  let seq = 0

  function order(): string[] {
    const hovered: [string, number][] = []
    const viewed: [string, number][] = []
    for (const [id, e] of entries) {
      if (e.hover) hovered.push([id, e.hover])
      else if (e.view) viewed.push([id, e.view])
    }
    hovered.sort((a, b) => b[1] - a[1])
    viewed.sort((a, b) => a[1] - b[1])
    return [...hovered, ...viewed].map(([id]) => id)
  }

  function rebalance() {
    const winners = new Set(order().slice(0, max))
    for (const [id, e] of entries) {
      const next = winners.has(id)
      if (next !== e.playing) {
        e.playing = next
        e.onChange(next)
      }
    }
    for (const [id, e] of entries) if (!e.hover && !e.view && !e.playing) entries.delete(id)
  }

  return {
    want(id, source, on, onChange) {
      let e = entries.get(id)
      if (!e) {
        if (!on) return
        e = { hover: 0, view: 0, playing: false, onChange }
        entries.set(id, e)
      }
      e.onChange = onChange
      if (on) {
        if (!e[source]) e[source] = ++seq
      } else {
        e[source] = 0
      }
      rebalance()
    },
    forget(id) {
      const e = entries.get(id)
      if (!e) return
      entries.delete(id)
      if (e.playing) e.onChange(false)
      rebalance()
    },
    playing: () => order().slice(0, max),
    clear() {
      for (const e of entries.values()) {
        e.hover = 0
        e.view = 0
      }
      rebalance()
    },
  }
}

export interface MotionEnv {
  /** prefers-reduced-motion: reduce */
  reducedMotion: boolean
  /** navigator.connection.saveData or prefers-reduced-data: reduce */
  saveData: boolean
  /** The site setting: 'off' means posters only. */
  pref: 'on' | 'off'
}

/** Whether animated previews may play at all. Opening a sticker's dialog still shows it animated. */
export function canPlayPreviews(env: MotionEnv): boolean {
  return !env.reducedMotion && !env.saveData && env.pref === 'on'
}
