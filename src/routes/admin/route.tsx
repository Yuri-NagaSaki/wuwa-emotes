import { createFileRoute, Outlet, useLocation, useNavigate, useRouter } from '@tanstack/react-router'
import { getAdminViewer, type PublicConfig, type ViewerSummary } from '#/server/ui/public-config'
import { AdminShell } from '#/ui/admin/AdminShell'
import { useSiteConfig } from '#/ui/site-config'
import adminCss from '#/ui/styles/admin.css?url'
import { toast } from '#/ui/Toast'

/** 401 from requireUser: an HttpError on the server, a serialized error after an RPC round trip. */
function isUnauthorized(err: unknown): boolean {
  const e = err as { status?: unknown; message?: unknown } | null
  return e?.status === 401 || (typeof e?.message === 'string' && e.message.includes('请先登录'))
}

// Admin layout. The role comes from the session (requireUser); the shell filters the sidebar with
// can(role, perm) and shows the 403 / sign-in states. Child routes check permissions themselves.
export const Route = createFileRoute('/admin')({
  loader: async (): Promise<{ viewer: ViewerSummary | null }> => {
    try {
      return { viewer: await getAdminViewer() }
    } catch (err) {
      if (isUnauthorized(err)) return { viewer: null }
      throw err
    }
  },
  staleTime: 30_000,
  head: ({ matches }) => {
    const root = matches[0]?.loaderData as PublicConfig | undefined
    return {
      meta: [{ title: root ? `管理台 · ${root.site.name}` : '管理台' }, { name: 'robots', content: 'noindex' }],
      links: [{ rel: 'stylesheet', href: adminCss }],
    }
  },
  component: AdminLayout,
})

function AdminLayout() {
  const { viewer } = Route.useLoaderData()
  const { site } = useSiteConfig()
  const pathname = useLocation({ select: (l) => l.pathname })
  const router = useRouter()
  const navigate = useNavigate()

  async function signOut() {
    try {
      const res = await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      if (!res.ok) throw new Error(String(res.status))
      await router.invalidate()
      await navigate({ to: '/' })
    } catch {
      toast({ message: '退出登录失败，请稍后再试', icon: 'warn' })
    }
  }

  return (
    <AdminShell siteName={site.name} viewer={viewer} pathname={pathname} onSignOut={viewer ? signOut : undefined}>
      <Outlet />
    </AdminShell>
  )
}
