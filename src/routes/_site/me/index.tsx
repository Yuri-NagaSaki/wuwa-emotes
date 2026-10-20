import { createFileRoute } from '@tanstack/react-router'
import { listFavoritesFn, listFoldersFn } from '#/server/favorites/fn'
import { FavoritesPanel, type FavoritesData } from '#/ui/account/FavoritesPanel'
import { errorStatus } from '#/ui/account/text'

// 个人中心 › 收藏夹 (?folder=<id>, default folder otherwise).
export const Route = createFileRoute('/_site/me/')({
  validateSearch: (s: Record<string, unknown>): { folder?: number } => {
    const n = Number(s.folder)
    return Number.isInteger(n) && n > 0 ? { folder: n } : {}
  },
  loaderDeps: ({ search }) => ({ folder: search.folder }),
  loader: async ({ deps }): Promise<FavoritesData> => {
    try {
      const folders = await listFoldersFn()
      const current = folders.find((f) => f.id === deps.folder) ?? folders[0]
      const page = current ? await listFavoritesFn({ data: { folderId: current.id } }) : { items: [], more: false }
      return { folders, current: current?.id ?? null, ...page }
    } catch (err) {
      // the /me layout redirects anonymous visitors
      if (errorStatus(err) === 401) return { folders: [], current: null, items: [], more: false }
      throw err
    }
  },
  component: function Favorites() {
    const data = Route.useLoaderData()
    return <FavoritesPanel key={data.current ?? 0} data={data} />
  },
})
