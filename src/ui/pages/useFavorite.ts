import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useOptionalSiteConfig } from '../site-config'
import { toast } from '../Toast'

// 收藏 for every public page (pack header, tiles, the single-emoji dialog), over the favorites server
// functions (src/server/favorites/fn.ts, loaded on first use). Per-viewer state lives only in this
// client store: the HTML is shared through the CDN and never knows who is looking. Hearts start
// empty, then useFavoriteStatus() fills them in for signed-in viewers.

export type FavoriteTarget = { type: 'pack'; id: number } | { type: 'emoji'; id: string }

export interface FavoriteState {
  favorited: boolean
  toggle: () => void
}

const keyOf = (t: FavoriteTarget) => `${t.type}:${t.id}`
const fns = () => import('#/server/favorites/fn')

let favorited = new Set<string>()
const pending = new Set<string>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

function set(key: string, on: boolean) {
  const next = new Set(favorited)
  if (on) next.add(key)
  else next.delete(key)
  favorited = next
  emit()
}

function isUnauthorized(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | null
  return e?.status === 401 || /请先登录|401/.test(e?.message ?? '')
}

/** Toggle without a hook (tiles in long grids). Optimistic; reverted when the server says no. */
export async function toggleFavorite(target: FavoriteTarget): Promise<void> {
  const key = keyOf(target)
  if (pending.has(key)) return
  const was = favorited.has(key)
  pending.add(key)
  set(key, !was)
  try {
    const { toggleFavoriteFn } = await fns()
    const r = await toggleFavoriteFn({ data: { target: { type: target.type, id: String(target.id) } } })
    set(key, r.favorited)
    toast({ message: r.favorited ? '已收藏' : '已取消收藏', detail: r.favorited ? '在「我的 · 收藏夹」里查看' : undefined, icon: 'heart' })
  } catch (err) {
    set(key, was)
    if (isUnauthorized(err)) toast({ message: '登录后才能收藏', detail: '右上角「登录」，下载不需要账号', icon: 'user', duration: 3500 })
    else toast({ message: '收藏失败，请稍后再试', icon: 'warn' })
  } finally {
    pending.delete(key)
  }
}

export function useFavorite(target: FavoriteTarget): FavoriteState {
  const key = keyOf(target)
  const on = useSyncExternalStore(subscribe, () => favorited.has(key), () => false)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the key identifies the target
  const toggle = useCallback(() => void toggleFavorite(target), [key])
  return { favorited: on, toggle }
}

/** Whether a sticker or pack is favorited (for tiles rendered in a loop). */
export function useFavoriteKeys(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => favorited, () => EMPTY)
}
const EMPTY: ReadonlySet<string> = new Set()
export { keyOf as favoriteKey }

/** Load the viewer's hearts for the targets on screen (signed-in viewers only, once per target set). */
export function useFavoriteStatus(targets: readonly FavoriteTarget[]): void {
  const signedIn = Boolean(useOptionalSiteConfig()?.viewer)
  const sig = targets.map(keyOf).join(',')
  useEffect(() => {
    if (!signedIn || !targets.length) return
    let stale = false
    void fns()
      .then(({ favoriteStatusFn }) => favoriteStatusFn({ data: { targets: targets.slice(0, 200).map((t) => ({ type: t.type, id: String(t.id) })) } }))
      .then((keys) => {
        if (stale) return
        const next = new Set(favorited)
        for (const t of targets) next.delete(keyOf(t))
        for (const k of keys) next.add(k)
        favorited = next
        emit()
      })
      .catch(() => undefined)
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sig covers the targets
  }, [signedIn, sig])
}
