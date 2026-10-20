import { createFileRoute } from '@tanstack/react-router'
import { downloadDeps } from '#/server/downloads/deps'
import { handleBatchSign } from '#/server/downloads/handlers'

// POST /api/batch/sign — presigned links for one chunk (≤ 20) of a browser-built batch ZIP.
// Same-origin is checked in the handler: Start's CSRF middleware only covers server functions.
export const Route = createFileRoute('/api/batch/sign')({
  server: {
    handlers: {
      POST: ({ request }) => handleBatchSign(request, downloadDeps),
      ANY: ({ request }) => handleBatchSign(request, downloadDeps),
    },
  },
})
