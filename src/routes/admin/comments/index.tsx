import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import type { PublicConfig } from '#/server/ui/public-config'
import type { CommentSettingsView } from '#/server/comments/admin'
import { commentQueueFn, commentSettingsFn } from '#/server/comments/admin-fns'
import type { QueuePage } from '#/server/comments/types'
import { CommentQueue } from '#/ui/comments/CommentQueue'

const adminRoute = getRouteApi('/admin')

// 评论审核. 站长 and 管理员 (permission `comments`); everyone else gets the shell's 403 state, so the
// loader swallows 401/403 instead of throwing into the error boundary.

interface LoaderData {
  queue: QueuePage
  settings: CommentSettingsView
}

function isDenied(err: unknown): boolean {
  const e = err as { status?: unknown; message?: unknown } | null
  if (e?.status === 401 || e?.status === 403) return true
  return typeof e?.message === 'string' && (e.message.includes('请先登录') || e.message.includes('没有权限'))
}

export const Route = createFileRoute('/admin/comments/')({
  loader: async (): Promise<LoaderData | null> => {
    try {
      const [queue, settings] = await Promise.all([commentQueueFn({ data: { tab: 'pending' } }), commentSettingsFn()])
      return { queue, settings }
    } catch (err) {
      if (isDenied(err)) return null
      throw err
    }
  },
  staleTime: 0,
  head: ({ matches }) => {
    const root = matches[0]?.loaderData as PublicConfig | undefined
    return { meta: [{ title: root ? `评论审核 · ${root.site.name}` : '评论审核' }] }
  },
  component: CommentsAdminPage,
})

function CommentsAdminPage() {
  const data = Route.useLoaderData()
  const { viewer } = adminRoute.useLoaderData()
  if (!data || !viewer || viewer.role === 'user') return null
  return <CommentQueue initialQueue={data.queue} initialSettings={data.settings} viewerRole={viewer.role} />
}
