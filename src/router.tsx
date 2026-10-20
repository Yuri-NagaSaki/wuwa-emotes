import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    // hover/touch preloads stay fresh for the router's default 30 s, so the click that follows uses
    // them instead of fetching again (catalog routes also set staleTime, see catalog-stale.ts)
    defaultPreload: 'intent',
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
