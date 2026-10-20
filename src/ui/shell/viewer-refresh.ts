import { rootRouteId, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { getPublicConfig } from '#/server/ui/public-config'
import { hasSignedInHint, refreshOutcome, SIGNED_IN_HINT, VIEWER_PENDING_ATTR, viewerRefreshNeeded } from '#/shared/signed-in-hint'

// The page may be anonymous HTML from the edge cache while this browser is signed in (Cloudflare's cache
// key ignores cookies; src/shared/signed-in-hint.ts). After hydration, with the signed-in hint present
// and no viewer in the root loader, ask getPublicConfig() once (never shared: private, no-store). If it
// knows the viewer, reload the root match so the header, 模拟登录 bar and everything else reading the
// root config (useSiteConfig) re-render. If not, the hint is stale: drop it. Visitors without the hint
// make no request at all.

/** Once per page load: later loader results (sign-out, other invalidations) are the truth. */
let attempted = false

export function useViewerRefresh(viewer: unknown) {
  const router = useRouter()
  useEffect(() => {
    const settle = () => document.documentElement.removeAttribute(VIEWER_PENDING_ATTR)
    if (!viewerRefreshNeeded({ viewer, hint: hasSignedInHint(document.cookie), attempted })) {
      settle()
      return
    }
    attempted = true
    void (async () => {
      let fresh: { viewer: unknown } | null = null
      try {
        fresh = await getPublicConfig()
      } catch {
        // offline or a server error: keep the anonymous chrome and the hint
      }
      const outcome = refreshOutcome(fresh)
      if (outcome === 'apply') {
        // The root match keeps its data and reloads in the background, so invalidate() resolves
        // before the new viewer is rendered. Don't settle here (登录 would show for a few frames):
        // this effect runs again with the viewer once the header has it, and settles then. If the
        // reload brings no viewer after all, the boot script's timeout drops the attribute.
        try {
          await router.invalidate({ filter: (m) => m.routeId === rootRouteId })
        } catch {
          settle()
        }
        return
      }
      if (outcome === 'clear-hint') clearSignedInHint()
      settle()
    })()
  }, [viewer, router])
}

function clearSignedInHint() {
  document.cookie = `${SIGNED_IN_HINT}=; Path=/; Max-Age=0; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
}
