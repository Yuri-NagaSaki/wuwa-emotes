// 白昼 / 夜潮 theme. The preference ('system' by default, i.e. 跟随系统) lives in localStorage
// `tp-theme`; the effective theme is html[data-theme="night"] (tokens.css) plus the theme-color meta.
// THEME_BOOT runs inline in <head> before first paint (src/routes/__root.tsx), so a night page never
// flashes light; the store below keeps the attribute in sync afterwards (toggle, other tabs, system).
// The theme-color meta is owned here, not by the route head (which would re-add the light value).

export type ThemePref = 'system' | 'light' | 'night'

export const THEME_KEY = 'tp-theme'
/** theme-color meta per theme (the page background). */
export const THEME_COLORS = { light: '#f8f8f0', night: '#0f2228' } as const
const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Inline boot script: set data-theme and the theme-color meta before first paint. */
export const THEME_BOOT = `(function(){var n=false;try{var p=localStorage.getItem(${JSON.stringify(THEME_KEY)});n=p==="night"||(p!=="light"&&matchMedia(${JSON.stringify(DARK_QUERY)}).matches)}catch(e){}if(n)document.documentElement.setAttribute("data-theme","night");var m=document.createElement("meta");m.name="theme-color";m.content=n?${JSON.stringify(THEME_COLORS.night)}:${JSON.stringify(THEME_COLORS.light)};document.head.appendChild(m)})()`

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'night' ? v : 'system'
  } catch {
    return 'system'
  }
}

function systemNight(): boolean {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches
}

/** Whether 夜潮 is in effect for a preference. */
export function nightFor(pref: ThemePref, system = systemNight()): boolean {
  return pref === 'night' || (pref === 'system' && system)
}

function apply(night: boolean) {
  const root = document.documentElement
  if (night) root.setAttribute('data-theme', 'night')
  else root.removeAttribute('data-theme')
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = night ? THEME_COLORS.night : THEME_COLORS.light
}

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Is 夜潮 in effect right now (client snapshot for useSyncExternalStore). */
export function isNight(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'night'
}

export function setPref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, pref)
  } catch {
    // storage blocked: the choice holds for this page only
  }
  apply(nightFor(pref))
  emit()
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) attach()
  return () => {
    listeners.delete(listener)
    if (!listeners.size) detach()
  }
}

let detach = () => {}
function attach() {
  const mq = matchMedia(DARK_QUERY)
  const onSystem = () => {
    if (readPref() === 'system') {
      apply(mq.matches)
      emit()
    }
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY && e.key !== null) return
    apply(nightFor(readPref(), mq.matches))
    emit()
  }
  mq.addEventListener('change', onSystem)
  window.addEventListener('storage', onStorage)
  detach = () => {
    mq.removeEventListener('change', onSystem)
    window.removeEventListener('storage', onStorage)
  }
}
