import { PORTRAIT_PREFIX } from './keys'
import { firstKey } from './s3'

// `bun src/cli.ts media check-public [--base https://i.sparxie.moe]`: what the bucket's public domain
// serves. Web images must be public and cacheable; everything else in the bucket (database backups,
// originals, the v1 snapshot, review previews, ZIPs, uploads) must be refused (403 or 404, never 200).
// Every probe uses the first real key under its prefix in the bucket the CLI is pointed at, so a 404
// means the domain refused it, not that the object is missing. Output names the prefix and the status
// only, never a key or any object content. Run it after the blocking rule is in place, and before
// PUBLIC_IMG_BASE goes live.

interface Probe {
  label: string
  prefix: string
  /** a missing object is a FAIL (nothing to verify); optional prefixes are skipped instead */
  required: boolean
}

const MUST_SERVE: Probe[] = [
  { label: 'poster (p240)', prefix: 'derived/v1/p240/', required: true },
  { label: 'portrait', prefix: PORTRAIT_PREFIX, required: true },
  { label: 'avatar', prefix: 'avatars/', required: false },
]
const MUST_REFUSE: Probe[] = [
  { label: 'database backup', prefix: 'backups/', required: true },
  { label: 'original', prefix: 'assets/', required: true },
  { label: 'v1 snapshot', prefix: 'meta/', required: true },
  { label: 'review preview', prefix: 'review/v1/', required: false },
  { label: 'zip', prefix: 'zips/', required: false },
  { label: 'upload', prefix: 'uploads/tmp/', required: false },
  { label: 'sync state', prefix: 'sync/', required: false },
]

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

  const keyFor = async (p: Probe): Promise<string | null> => {
    const key = await deps.firstKey(p.prefix)
    if (!key) {
      if (p.required) add(false, `${p.label} ${p.prefix}…: no object in the bucket to probe`)
      else lines.push({ ok: true, line: `skip  ${p.label} ${p.prefix}…: no object in the bucket` })
    }
    return key
  }

  for (const p of MUST_SERVE) {
    const key = await keyFor(p)
    if (!key) continue
    try {
      const res = await deps.fetch(objectUrl(base, key), { method: 'HEAD', redirect: 'manual', signal: timeout() })
      const type = res.headers.get('content-type') ?? ''
      const cc = res.headers.get('cache-control') ?? ''
      const ok = res.status === 200 && type.startsWith('image/webp') && /max-age=31536000/.test(cc) && /immutable/.test(cc)
      add(ok, `${p.label} ${p.prefix}… → ${res.status}, ${type || 'no content-type'}, ${cc || 'no cache-control'} (want 200, image/webp, max-age=31536000 immutable)`)
    } catch (err) {
      add(false, `${p.label} ${p.prefix}… → ${(err as Error).message}`)
    }
  }

  for (const p of MUST_REFUSE) {
    const key = await keyFor(p)
    if (!key) continue
    try {
      // the status is all that is read; the body is dropped unread
      const res = await deps.fetch(objectUrl(base, key), { method: 'GET', redirect: 'manual', headers: { range: 'bytes=0-0' }, signal: timeout() })
      await res.body?.cancel().catch(() => undefined)
      add(res.status === 403 || res.status === 404, `${p.label} ${p.prefix}… → ${res.status} (want 403 or 404, never 200)`)
    } catch (err) {
      add(false, `${p.label} ${p.prefix}… → ${(err as Error).message}`)
    }
  }

  // no object listing at the root of the domain
  try {
    const res = await deps.fetch(`${base.replace(/\/+$/, '')}/`, { method: 'GET', redirect: 'manual', signal: timeout() })
    const listing = res.status === 200 && /<ListBucketResult|<Contents>/.test(await res.text())
    if (res.status !== 200) await res.body?.cancel().catch(() => undefined)
    add(!listing, `listing / → ${res.status}${listing ? ', an object listing' : ''} (want no object listing)`)
  } catch (err) {
    add(false, `listing / → ${(err as Error).message}`)
  }
  return { ok: lines.every((l) => l.ok), lines }
}
