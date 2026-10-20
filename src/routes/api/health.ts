import { createFileRoute } from '@tanstack/react-router'
import { checkHealth } from '#/server/http/health'

// Container health check and the zero-downtime proxy's readiness probe.
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        const result = await checkHealth()
        return Response.json(result, { status: result.ok ? 200 : 503, headers: { 'cache-control': 'no-store' } })
      },
    },
  },
})
