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
    if (askedFor) asked.add(key)
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

/** Most targets one favoriteStatusFn call carries (the server allows the same). */
export const STATUS_BATCH = 100

// Keys already asked about for `askedFor` (answered or on the way), so a page that grows (the next
// batch of a long pack, infinite scroll) only asks about what is new. Cleared when the viewer changes.
let asked = new Set<string>()
let askedFor: string | null = null

/** The targets not asked about yet, without duplicates, in calls of at most `size`. Pure. */
export function statusBatches<T>(targets: readonly T[], key: (t: T) => string, seen: ReadonlySet<string>, size = STATUS_BATCH): T[][] {
  const fresh: T[] = []
  const taken = new Set<string>()
  for (const t of targets) {
    const k = key(t)
    if (seen.has(k) || taken.has(k)) continue
    taken.add(k)
    fresh.push(t)
  }
  const out: T[][] = []
  for (let i = 0; i < fresh.length; i += size) out.push(fresh.slice(i, i + size))
  return out
}

/** Forget the hearts of the previous viewer (sign-out, another account). */
function resetFor(viewerId: string | null) {
  if (askedFor === viewerId) return
  asked = new Set()
  askedFor = viewerId
  if (favorited.size) {
    favorited = new Set()
    emit()
  }
}

/** Load the viewer's hearts for the targets on screen (signed-in viewers only; each target once). */
export function useFavoriteStatus(targets: readonly FavoriteTarget[]): void {
  const viewerId = useOptionalSiteConfig()?.viewer?.id ?? null
  const sig = targets.map(keyOf).join(',')
  useEffect(() => {
    resetFor(viewerId)
    if (!viewerId || !targets.length) return
    for (const batch of statusBatches(targets, keyOf, asked)) {
      const keys = batch.map(keyOf)
      for (const k of keys) asked.add(k)
      void fns()
        .then(({ favoriteStatusFn }) => favoriteStatusFn({ data: { targets: batch.map((t) => ({ type: t.type, id: String(t.id) })) } }))
        .then((on) => {
          if (askedFor !== viewerId) return
          const yes = new Set(on)
          const next = new Set(favorited)
          // a heart toggled while the answer was on its way keeps the toggle
          for (const k of keys) if (!pending.has(k)) (yes.has(k) ? next.add(k) : next.delete(k))
          favorited = next
          emit()
        })
        .catch(() => {
          // asked again the next time these targets are on screen
          if (askedFor === viewerId) for (const k of keys) asked.delete(k)
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sig covers the targets
  }, [viewerId, sig])
}
