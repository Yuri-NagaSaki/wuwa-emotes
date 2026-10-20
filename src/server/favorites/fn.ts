import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { publicFn, requireUser } from '../perm/fn'

// 收藏 server functions. toggleFavoriteFn and favoriteStatusFn are meant for every page with heart
// buttons (tiles, pack cards, the emoji dialog); the rest back the 收藏夹 tab of /me.

const target = z.object({ type: z.enum(['pack', 'emoji']), id: z.string().min(1).max(40) })
const folderId = z.number().int().positive()

/** Heart button. Anonymous callers get 401 (请先登录). */
export const toggleFavoriteFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ target, folderId: folderId.optional() }))
  .handler(async ({ data, context }) => {
    const { toggleFavorite } = await import('./service')
    return toggleFavorite(context.viewer.id, data.target, data.folderId)
  })

/** Which of the given targets the viewer has favorited, as "pack:<id>" / "emoji:<id>"; [] when signed out. */
export const favoriteStatusFn = createServerFn({ method: 'GET' })
  .middleware([publicFn])
  .validator(z.object({ targets: z.array(target).max(200) }))
  .handler(async ({ data, context }) => {
    const { favoriteStatus } = await import('./service')
    return favoriteStatus(context.viewer?.id ?? null, data.targets)
  })

export const listFoldersFn = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const { listFolders } = await import('./service')
    return listFolders(context.viewer.id)
  })

export const listFavoritesFn = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ folderId, before: z.number().int().positive().optional() }))
  .handler(async ({ data, context }) => {
    const { listFavorites } = await import('./service')
    return listFavorites(context.viewer.id, data.folderId, data.before)
  })

export const createFolderFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ name: z.string().min(1).max(60) }))
  .handler(async ({ data, context }) => {
    const { createFolder } = await import('./service')
    return createFolder(context.viewer.id, data.name)
  })

export const renameFolderFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ folderId, name: z.string().min(1).max(60) }))
  .handler(async ({ data, context }) => {
    const { renameFolder } = await import('./service')
    await renameFolder(context.viewer.id, data.folderId, data.name)
    return { ok: true as const }
  })

export const deleteFolderFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ folderId }))
  .handler(async ({ data, context }) => {
    const { deleteFolder } = await import('./service')
    return deleteFolder(context.viewer.id, data.folderId)
  })

export const moveFavoriteFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ favoriteId: z.number().int().positive(), folderId }))
  .handler(async ({ data, context }) => {
    const { moveFavorite } = await import('./service')
    await moveFavorite(context.viewer.id, data.favoriteId, data.folderId)
    return { ok: true as const }
  })

export const removeFavoriteFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ favoriteId: z.number().int().positive() }))
  .handler(async ({ data, context }) => {
    const { removeFavorite } = await import('./service')
    await removeFavorite(context.viewer.id, data.favoriteId)
    return { ok: true as const }
  })
