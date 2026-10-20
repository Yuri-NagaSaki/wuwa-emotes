import { createFileRoute } from '@tanstack/react-router'
import { downloadDeps } from '#/server/downloads/deps'
import { handlePackZip } from '#/server/downloads/handlers'

// /dl/p/<slug>.zip — whole-pack ZIP: 302 to a presigned link when built, else 202 { status: 'building' }.
export const Route = createFileRoute('/dl/p/{$slug}.zip')({
  server: {
    handlers: {
      GET: ({ request, params }) => handlePackZip(request, params.slug, downloadDeps),
      ANY: ({ request, params }) => handlePackZip(request, params.slug, downloadDeps),
    },
  },
})
