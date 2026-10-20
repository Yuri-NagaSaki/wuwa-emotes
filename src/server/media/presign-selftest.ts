import { env } from '../env'
import { bucket, deleteObjects, headObject, presignPut } from './s3'

// `bun src/cli.ts presign-selftest`: does the configured storage enforce the signed Content-Length of
// presignPut? Two PUTs against a 16-byte signature: 16 bytes must be stored, 17 bytes refused. Only
// two fresh keys under uploads/tmp/selftest/ are written, and both are deleted afterwards. Storage comes
// from the usual env config; the output names the bucket and keys, never the endpoint or credentials.

export const SELFTEST_PREFIX = 'uploads/tmp/selftest/'
const SIGNED_BYTES = 16
const CONTENT_TYPE = 'application/octet-stream'

export interface SelftestCase {
  ok: boolean
  line: string
}

export interface SelftestResult {
  bucket: string
  cases: SelftestCase[]
  ok: boolean
}

/** Error text without the storage host (an R2 endpoint names the account). */
function message(err: unknown): string {
  const e = env()
  const hosts = [e.S3_ENDPOINT, e.S3_PUBLIC_ENDPOINT].filter(Boolean).map((u) => new URL(u).host)
  return hosts.reduce((text, host) => text.split(host).join('<storage>'), err instanceof Error ? err.message : String(err))
}

async function putCase(label: string, bytes: number, expectStored: boolean): Promise<SelftestCase> {
  const key = `${SELFTEST_PREFIX}${crypto.randomUUID()}.bin`
  let ok = false
  let detail: string
  try {
    const url = await presignPut(key, CONTENT_TYPE, SIGNED_BYTES, 120)
    const res = await fetch(url, { method: 'PUT', headers: { 'content-type': CONTENT_TYPE }, body: new Uint8Array(bytes).fill(0x2a) })
    const code = /<Code>([^<]+)<\/Code>/.exec(await res.text())?.[1]
    const head = await headObject(key)
    ok = expectStored ? res.ok && head?.ContentLength === bytes : res.status >= 400 && res.status < 500 && !head
    detail = `HTTP ${res.status}${code ? ` ${code}` : ''}, ${head ? `stored ${head.ContentLength ?? '?'} B` : 'nothing stored'}`
  } catch (err) {
    detail = message(err)
  }
  try {
    await deleteObjects([key])
  } catch (err) {
    ok = false
    detail += `; cleanup failed: ${message(err)}`
  }
  return { ok, line: `${ok ? 'ok  ' : 'FAIL'} ${label}: ${detail} (${key})` }
}

export async function presignSelftest(): Promise<SelftestResult> {
  const cases = [
    await putCase(`PUT ${SIGNED_BYTES} B with a ${SIGNED_BYTES} B signature (expect 2xx)`, SIGNED_BYTES, true),
    await putCase(`PUT ${SIGNED_BYTES + 1} B with a ${SIGNED_BYTES} B signature (expect 4xx)`, SIGNED_BYTES + 1, false),
  ]
  return { bucket: bucket(), cases, ok: cases.every((c) => c.ok) }
}
