// Continuous request loader: proves a rollout or restart drops nothing.
//
//   bun deploy/loadcheck.ts [--url https://sparxie.moe] [--concurrency 8] [--pause 0] [--duration 0]
//                           [--post] [--insecure] [--expect-upstream]
//
// For every path it runs `concurrency` loops: GET /, GET /api/health and, with --post, POST /api/health.
// Each loop waits --pause ms between requests (0 = back to back, which saturates the replicas and
// measures capacity rather than the deploy). It stops on Ctrl-C / SIGTERM (or after --duration
// seconds) and prints totals.
// A failure is a connection error, a timeout, or a status outside 2xx/3xx. Exit code 1 on any failure.
//   --insecure          accept any certificate (Caddy's internal CA, or a loopback test)
//   --expect-upstream   abort unless the first response carries X-Chaochi-Upstream, i.e. it really came
//                       from the local proxy over loopback (guards a test against hitting the live site)
const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1]! : dflt
}

const base = opt('url', 'https://sparxie.moe').replace(/\/$/, '')
const concurrency = Number(opt('concurrency', '8'))
const duration = Number(opt('duration', '0'))
const pause = Number(opt('pause', '0'))
const insecure = flag('insecure')
const targets: { name: string; method: string; path: string }[] = [
  { name: 'GET /', method: 'GET', path: '/' },
  { name: 'GET /api/health', method: 'GET', path: '/api/health' },
  ...(flag('post') ? [{ name: 'POST /api/health', method: 'POST', path: '/api/health' }] : []),
]

interface Stats { sent: number; ok: number; failed: number; latencies: number[] }
const stats = new Map(targets.map((t) => [t.name, { sent: 0, ok: 0, failed: 0, latencies: [] } as Stats]))
const upstreams = new Map<string, number>()
const builds = new Map<string, number>()
const failures: string[] = []
const failSeconds = new Map<number, number>()
const started = Date.now()
let stopping = false

async function once(t: (typeof targets)[number]) {
  const s = stats.get(t.name)!
  s.sent++
  const t0 = performance.now()
  try {
    const res = await fetch(base + t.path, {
      method: t.method,
      body: t.method === 'POST' ? '{}' : undefined,
      headers: t.method === 'POST' ? { 'content-type': 'application/json' } : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      ...(insecure ? { tls: { rejectUnauthorized: false } } : {}),
    } as RequestInit)
    const body = await res.text()
    s.latencies.push(performance.now() - t0)
    const up = res.headers.get('x-chaochi-upstream')
    if (up) upstreams.set(up, (upstreams.get(up) ?? 0) + 1)
    if (t.path === '/api/health' && res.ok) {
      try {
        const build = (JSON.parse(body) as { build?: string }).build
        if (build) builds.set(build, (builds.get(build) ?? 0) + 1)
      } catch {}
    }
    if (res.status >= 200 && res.status < 400) s.ok++
    else fail(s, `${t.name} -> HTTP ${res.status} ${body.slice(0, 80).replace(/\s+/g, ' ')}`)
  } catch (err) {
    s.latencies.push(performance.now() - t0)
    fail(s, `${t.name} -> ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`)
  }
}

function fail(s: Stats, msg: string) {
  s.failed++
  const sec = Math.floor((Date.now() - started) / 1000)
  failSeconds.set(sec, (failSeconds.get(sec) ?? 0) + 1)
  if (failures.length < 20) failures.push(`+${sec}s ${msg}`)
}

async function loop(t: (typeof targets)[number]) {
  while (!stopping) {
    await once(t)
    if (pause > 0) await Bun.sleep(pause)
  }
}

// Safety check before generating load.
const first = await fetch(base + '/api/health', insecure ? ({ tls: { rejectUnauthorized: false } } as RequestInit) : {})
await first.text()
if (flag('expect-upstream') && !first.headers.get('x-chaochi-upstream')) {
  console.error(`loadcheck: ${base} answered without X-Chaochi-Upstream; refusing (not the local proxy?)`)
  process.exit(2)
}
console.log(`loadcheck: ${base}, ${concurrency} loops per path: ${targets.map((t) => t.name).join(', ')}`)

const stop = () => (stopping = true)
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
if (duration > 0) setTimeout(stop, duration * 1000)

const progress = setInterval(() => {
  const all = [...stats.values()]
  const sent = all.reduce((a, s) => a + s.sent, 0)
  const failed = all.reduce((a, s) => a + s.failed, 0)
  console.log(`  +${Math.round((Date.now() - started) / 1000)}s sent ${sent} failed ${failed}`)
}, 10_000)

await Promise.all(targets.flatMap((t) => Array.from({ length: concurrency }, () => loop(t))))
clearInterval(progress)

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!
}
const seconds = (Date.now() - started) / 1000
let total = 0
let totalFailed = 0
console.log(`\nloadcheck: ${seconds.toFixed(1)} s`)
for (const [name, s] of stats) {
  total += s.sent
  totalFailed += s.failed
  console.log(
    `  ${name.padEnd(18)} sent ${String(s.sent).padStart(7)}  ok ${String(s.ok).padStart(7)}  failed ${s.failed}` +
      `  p50 ${pct(s.latencies, 50).toFixed(1)} ms  p99 ${pct(s.latencies, 99).toFixed(1)} ms  max ${pct(s.latencies, 100).toFixed(0)} ms`,
  )
}
console.log(`  total              sent ${total}  failed ${totalFailed}  (${(total / seconds).toFixed(0)} req/s)`)
if (upstreams.size) console.log(`  served by: ${[...upstreams].map(([k, v]) => `${k} ${v}`).join(', ')}`)
if (builds.size) console.log(`  builds seen on /api/health: ${[...builds].map(([k, v]) => `${k} ${v}`).join(', ')}`)
if (failures.length) console.log(`  failures (first ${failures.length}):\n    ${failures.join('\n    ')}`)
if (failSeconds.size) console.log(`  failures per second: ${JSON.stringify(Object.fromEntries(failSeconds))}`)
process.exit(totalFailed ? 1 : 0)
