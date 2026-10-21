import { PORTRAIT_PREFIX } from './keys'
import { firstKey } from './s3'

// `bun src/cli.ts media check-public [--base https://i.sparxie.moe]`: what the bucket's public domain
// serves. Web images must be public and cacheable; everything else in the bucket (database backups,
// uploads, originals, review previews, ZIPs, the v1 snapshot) must not be readable there. Every probe
// uses a key that exists, so a 404 means the domain refused it, not that the object is missing. Run it
// after the domain is connected and the blocking rule is in place, before PUBLIC_IMG_BASE goes live.

const PUBLIC_PROBES = [
  { label: 'derived p240', prefix: 'derived/v1/p240/' },
  { label: 'portrait', prefix: PORTRAIT_PREFIX },
  { label: 'avatar', prefix: 'avatars/', optional: true },
] as const
const PRIVATE_PROBES = [
  // always probed: with no object there, a made-up key under the prefix (a 404 then proves less)
  { label: 'database backup', prefix: 'backups/', fallback: 'backups/postgres/check-public-probe.dump.enc' },
  { label: 'upload', prefix: 'uploads/', fallback: 'uploads/tmp/check-public-probe' },
  { label: 'original', prefix: 'assets/' },
  { label: 'review preview', prefix: 'review/' },
  { label: 'zip', prefix: 'zips/' },
  { label: 'v1 snapshot', prefix: 'meta/' },
] as const

export interface CheckLine {
  ok: boolean
  line: string
}

export interface CheckPublicDeps {
  fetch: typeof fetch
  firstKey(prefix: string): Promise<string | null>
}

function objectUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`
}

export async function checkPublic(base: string, deps: CheckPublicDeps = { fetch, firstKey }): Promise<{ ok: boolean; lines: CheckLine[] }> {
  const lines: CheckLine[] = []
  const add = (ok: boolean, line: string) => lines.push({ ok, line: `${ok ? 'PASS' : 'FAIL'}  ${line}` })
  const timeout = () => AbortSignal.timeout(15_000)

  for (const p of PUBLIC_PROBES) {
    const key = await deps.firstKey(p.prefix)
    if (!key) {
      if (!('optional' in p)) add(false, `${p.label}: no object under ${p.prefix} to probe`)
      continue
    }
    const url = objectUrl(base, key)
    try {
      const res = await deps.fetch(url, { method: 'HEAD', redirect: 'manual', signal: timeout() })
      const type = res.headers.get('content-type') ?? ''
      const cc = res.headers.get('cache-control') ?? ''
      const ok = res.status === 200 && type.startsWith('image/webp') && /max-age=31536000/.test(cc) && /immutable/.test(cc)
      add(ok, `${p.label} ${url} → ${res.status}, content-type ${type || '-'}, cache-control ${cc || '-'} (want 200, image/webp, max-age=31536000 immutable)`)
    } catch (err) {
      add(false, `${p.label} ${url} → ${(err as Error).message}`)
    }
  }

  for (const p of PRIVATE_PROBES) {
    const found = await deps.firstKey(p.prefix)
    const key = found ?? ('fallback' in p ? p.fallback : null)
    if (!key) {
      lines.push({ ok: true, line: `skip  ${p.label}: no object under ${p.prefix}` })
      continue
    }
    const url = objectUrl(base, key)
    try {
      const res = await deps.fetch(url, { method: 'GET', redirect: 'manual', headers: { range: 'bytes=0-15' }, signal: timeout() })
      await res.body?.cancel().catch(() => undefined)
      add(res.status === 403 || res.status === 404, `${p.label} ${url} → ${res.status} (want 403 or 404)${found ? '' : ' [no object exists; made-up key]'}`)
    } catch (err) {
      add(false, `${p.label} ${url} → ${(err as Error).message}`)
    }
  }

  // no bucket listing at the root of the domain
  try {
    const url = `${base.replace(/\/+$/, '')}/`
    const res = await deps.fetch(url, { method: 'GET', redirect: 'manual', signal: timeout() })
    const text = res.status === 200 ? await res.text() : (await res.body?.cancel().catch(() => undefined), '')
    add(!(res.status === 200 && /<ListBucketResult|<Contents>/.test(text)), `listing ${url} → ${res.status} (want no object listing)`)
  } catch (err) {
    add(false, `listing → ${(err as Error).message}`)
  }
  return { ok: lines.every((l) => l.ok), lines }
}
