import { useSyncExternalStore } from 'react'
import { canPlayPreviews, type MotionEnv } from './playback'

// Browser side of the playback policy: reduced motion, Save-Data, and the user's 自动播放 switch
// (stored in localStorage). The server snapshot is "no previews", so SSR always renders posters.

const PREF_KEY = 'tp-autoplay'
type Connection = EventTarget & { saveData?: boolean }

const listeners = new Set<() => void>()

function readEnv(): MotionEnv {
  const mm = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches
  const conn = (navigator as Navigator & { connection?: Connection }).connection
  let pref: MotionEnv['pref'] = 'on'
  try {
    if (localStorage.getItem(PREF_KEY) === 'off') pref = 'off'
  } catch {
    /* storage blocked: keep the default */
  }
  return {
    reducedMotion: mm('(prefers-reduced-motion: reduce)'),
    saveData: Boolean(conn?.saveData) || mm('(prefers-reduced-data: reduce)'),
    pref,
  }
}

// The environment is read once and cached while anything subscribes: every tile and pack card asks for
// it on every render, and reading it (two matchMedia queries and a localStorage read) per call cost
// ~1,400 matchMedia calls and ~700 listeners for one 234-sticker pack page. One shared set of change
// listeners refreshes the cache and notifies every subscriber.
let cached: MotionEnv | null = null
let detach: (() => void) | null = null

function current(): MotionEnv {
  cached ??= readEnv()
  return cached
}

function refresh() {
  cached = readEnv()
  listeners.forEach((l) => l())
}

function attach(): () => void {
  const queries = ['(prefers-reduced-motion: reduce)', '(prefers-reduced-data: reduce)'].map((q) => matchMedia(q))
  queries.forEach((q) => q.addEventListener('change', refresh))
  const conn = (navigator as Navigator & { connection?: Connection }).connection
  conn?.addEventListener?.('change', refresh)
  const onStorage = (e: StorageEvent) => e.key === PREF_KEY && refresh()
  window.addEventListener('storage', onStorage)
  return () => {
    queries.forEach((q) => q.removeEventListener('change', refresh))
    conn?.removeEventListener?.('change', refresh)
    window.removeEventListener('storage', onStorage)
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  detach ??= attach()
  return () => {
    listeners.delete(listener)
    if (!listeners.size && detach) {
      detach()
      detach = null
      // nothing listens for changes any more: read afresh next time
      cached = null
    }
  }
}

/** Whether animated previews may play (false on the server and until hydration). */
export function usePreviewsAllowed(): boolean {
  return useSyncExternalStore(subscribe, () => canPlayPreviews(current()), () => false)
}

/** The 自动播放 preference ('on' unless the user turned it off). */
export function useAutoplayPref(): boolean {
  return useSyncExternalStore(subscribe, () => current().pref === 'on', () => true)
}

export function setAutoplayPref(on: boolean) {
  try {
    if (on) localStorage.removeItem(PREF_KEY)
    else localStorage.setItem(PREF_KEY, 'off')
  } catch {
    /* storage blocked: the switch resets on reload */
  }
  refresh()
}
