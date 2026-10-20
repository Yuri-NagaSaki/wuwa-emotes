import { createFileRoute } from '@tanstack/react-router'
import { auth } from '#/server/auth/auth'

// Better Auth: sign-up/in, sessions, passkeys and the admin endpoints (/api/auth/*).
// Cap checks and permissions are enforced inside the auth config (src/server/auth/auth.ts).
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => auth().handler(request),
      POST: ({ request }) => auth().handler(request),
    },
  },
})
