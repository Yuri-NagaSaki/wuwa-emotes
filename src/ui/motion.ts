import { useSyncExternalStore } from 'react'
import { canPlayPreviews, type MotionEnv } from './playback'

// Browser side of the playback policy: reduced motion, Save-Data, and the user's 自动播放 switch
// (stored in localStorage). The server snapshot is "no previews", so SSR always renders posters.

const PREF_KEY = 'tp-autoplay'
type Connection = EventTarget & { saveData?: boolean }

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

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

function subscribe(listener: () => void) {
  listeners.add(listener)
  const queries = ['(prefers-reduced-motion: reduce)', '(prefers-reduced-data: reduce)'].map((q) => matchMedia(q))
  queries.forEach((q) => q.addEventListener('change', emit))
  const conn = (navigator as Navigator & { connection?: Connection }).connection
  conn?.addEventListener?.('change', emit)
  const onStorage = (e: StorageEvent) => e.key === PREF_KEY && emit()
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    queries.forEach((q) => q.removeEventListener('change', emit))
    conn?.removeEventListener?.('change', emit)
    window.removeEventListener('storage', onStorage)
  }
}

/** Whether animated previews may play (false on the server and until hydration). */
export function usePreviewsAllowed(): boolean {
  return useSyncExternalStore(subscribe, () => canPlayPreviews(readEnv()), () => false)
}

/** The 自动播放 preference ('on' unless the user turned it off). */
export function useAutoplayPref(): boolean {
  return useSyncExternalStore(subscribe, () => readEnv().pref === 'on', () => true)
}

export function setAutoplayPref(on: boolean) {
  try {
    if (on) localStorage.removeItem(PREF_KEY)
    else localStorage.setItem(PREF_KEY, 'off')
  } catch {
    /* storage blocked: the switch resets on reload */
  }
  emit()
}
