import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { env } from './server/env'
import { securityConfig, withFinalHeaders, type SecurityConfig } from './server/http/security'

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
