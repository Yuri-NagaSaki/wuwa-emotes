// Fail the build when server-only code reaches the browser bundle (.output/public). A top-level side
// effect in a module both bundles share (src/start.ts, route files) can pull the db client, pg-boss
// or the env schema into it; pages then throw before hydrating (`Buffer is not defined`).
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pub = join(root, '.output', 'public')
// Not AUTH_SECRET: better-auth's own client code reads that name through its env helper.
const MARKERS = ['pg-boss', 'DATABASE_URL', 'IP_HASH_SALT', 'S3_SECRET_ACCESS_KEY', 'CAP_SECRET_KEY']

const scripts = (readdirSync(pub, { recursive: true }) as string[]).filter((f) => /\.m?js$/.test(f))
if (!scripts.length) {
  console.error(`check-client-bundle: no scripts under ${relative(root, pub)}; build first`)
  process.exit(1)
}
const hits: string[] = []
for (const f of scripts) {
  const text = readFileSync(join(pub, f), 'utf8')
  const found = MARKERS.filter((m) => text.includes(m))
  if (found.length) hits.push(`${f}: ${found.join(', ')}`)
}
if (hits.length) {
  console.error(`check-client-bundle: server-only code in the browser bundle\n  ${hits.join('\n  ')}`)
  process.exit(1)
}
console.log(`check-client-bundle: ${scripts.length} scripts, no server-only code`)
