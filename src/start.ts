import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { env } from './server/env'
import { securityConfig, withFinalHeaders, type SecurityConfig } from './server/http/security'

// Close the pg pool and pg-boss sender after the server has drained on SIGTERM (see server/shutdown.ts).
// This module is in the browser bundle too: a static import of server/shutdown would pull pg and
// pg-boss into it, and pages would throw before hydrating. The SSR branch is removed from that bundle.
if (import.meta.env.SSR) void import('./server/shutdown').then((m) => m.registerShutdown())

// Request middleware for every request Start handles (pages, server routes, server functions).
// A custom start.ts replaces Start's default CSRF middleware, so it is added back here.

let config: SecurityConfig | undefined

/**
 * Security headers + HTML cache rule (docs/ARCHITECTURE.md §2.1). Outermost, so responses produced by
 * the CSRF check get them too. Only reads the Cookie header: never calls the session API, so /img
 * stays cookie-free.
 */
const securityHeaders = createMiddleware().server(async ({ request, pathname, handlerType, next }) => {
  const result = await next()
  config ??= securityConfig(env())
  const response = withFinalHeaders(
    { method: request.method, pathname, handlerType, cookieHeader: request.headers.get('cookie') },
    result.response,
    config,
  )
  return response === result.response ? result : { ...result, response }
})

const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' })

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeaders, csrf],
}))
