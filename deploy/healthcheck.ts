// Container health probe for the web service (Dockerfile HEALTHCHECK): exit 0 when this replica serves.
//
// Contract: GET /api/health returns 2xx when the replica can take traffic. The route is owned by the
// app; until a build ships it, a 404 there falls back to GET / so the container still reports whether
// the server answers. The proxy's active health check (deploy/caddy/Caddyfile) has no such fallback:
// it requires /api/health to return 2xx before it routes visitors to a replica.
const port = process.env.PORT ?? '3000'
const base = `http://127.0.0.1:${port}`

async function status(path: string): Promise<number> {
  const res = await fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(2500) })
  await res.body?.cancel()
  return res.status
}

try {
  let code = await status('/api/health')
  if (code === 404) code = await status('/')
  process.exit(code >= 200 && code < 400 ? 0 : 1)
} catch {
  process.exit(1)
}
