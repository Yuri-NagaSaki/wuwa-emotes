import { BUCKET, ROOT, TEST_ENV } from './setup'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { BucketAlreadyOwnedByYou, CreateBucketCommand } from '@aws-sdk/client-s3'
import { SELFTEST_PREFIX } from '#/server/media/presign-selftest'
import { deleteObjects, headObject, listKeys, presignPut, s3 } from '#/server/media/s3'

// Presigned PUTs are locked to the declared size and type (src/server/media/s3.ts presignPut), against
// RustFS: storage itself refuses any other body, so a signed URL cannot park more than it declared.

const RUN = Date.now().toString(36)
const N = 1000
const body = (n: number) => new Uint8Array(n).fill(0x5a)
let seq = 0
const created: string[] = []

async function signed(bytes = N, type = 'image/gif') {
  const key = `uploads/tmp/lane-l-presign/${RUN}/${++seq}.gif`
  created.push(key)
  return { key, url: await presignPut(key, type, bytes) }
}

async function put(url: string, init: { body: BodyInit; type?: string }) {
  const res = await fetch(url, { method: 'PUT', headers: init.type === undefined ? {} : { 'content-type': init.type }, body: init.body })
  return { status: res.status, code: /<Code>([^<]+)<\/Code>/.exec(await res.text())?.[1] ?? null }
}

beforeAll(async () => {
  try {
    await s3().send(new CreateBucketCommand({ Bucket: BUCKET }))
  } catch (err) {
    if (!(err instanceof BucketAlreadyOwnedByYou) && (err as Error).name !== 'BucketAlreadyExists') throw err
  }
})

afterAll(() => deleteObjects(created))

describe('presignPut', () => {
  test('signs Content-Length and Content-Type as headers, not as query parameters', async () => {
    const url = new URL((await signed()).url)
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host')
    expect(url.searchParams.has('Content-Length')).toBe(false)
    expect(url.searchParams.has('Content-Type')).toBe(false)
    expect(url.searchParams.has('x-amz-checksum-crc32')).toBe(false)
  })

  test('a PUT of exactly the declared size is stored', async () => {
    const { key, url } = await signed()
    expect(await put(url, { body: body(N), type: 'image/gif' })).toEqual({ status: 200, code: null })
    const head = await headObject(key)
    expect(head?.ContentLength).toBe(N)
    expect(head?.ContentType).toBe('image/gif')
  })

  test('a browser-style PUT (File body, only the signed Content-Type set) is stored', async () => {
    const { key, url } = await signed()
    const file = new File([body(N)], 'dance.gif', { type: 'image/gif' })
    expect((await put(url, { body: file, type: 'image/gif' })).status).toBe(200)
    expect((await headObject(key))?.ContentLength).toBe(N)
  })

  test.each([
    ['one byte more', N + 1],
    ['one byte less', N - 1],
    ['20 MB more', N + 20 * 1024 * 1024],
  ])('a PUT of %s is refused and stores nothing', async (_label, bytes) => {
    const { key, url } = await signed()
    expect(await put(url, { body: body(bytes), type: 'image/gif' })).toEqual({ status: 403, code: 'SignatureDoesNotMatch' })
    expect(await headObject(key)).toBeNull()
  })

  test('a streamed body without Content-Length is refused', async () => {
    const { key, url } = await signed()
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(body(N))
        c.close()
      },
    })
    expect((await put(url, { body: stream, type: 'image/gif' })).status).toBe(403)
    expect(await headObject(key)).toBeNull()
  })

  test('another or a missing Content-Type is refused', async () => {
    const a = await signed()
    expect((await put(a.url, { body: body(N), type: 'text/html' })).status).toBe(403)
    const b = await signed()
    expect((await put(b.url, { body: body(N) })).status).toBe(403)
    expect(await headObject(a.key)).toBeNull()
    expect(await headObject(b.key)).toBeNull()
  })
})

describe('bun src/cli.ts presign-selftest', () => {
  test('passes against RustFS and leaves nothing behind', async () => {
    const before = await listKeys(SELFTEST_PREFIX)
    const proc = Bun.spawn(['bun', 'src/cli.ts', 'presign-selftest'], { cwd: ROOT, env: { ...process.env, ...TEST_ENV }, stdout: 'pipe', stderr: 'pipe' })
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    expect(err).toBe('')
    expect(code).toBe(0)
    const lines = out.trim().split('\n')
    expect(lines[0]).toBe(`presign-selftest: bucket ${BUCKET}`)
    expect(out).not.toContain(TEST_ENV.S3_ENDPOINT!)
    expect(out).not.toContain(TEST_ENV.S3_ACCESS_KEY_ID!)
    expect(lines[1]).toMatch(/^ {2}ok {3}PUT 16 B with a 16 B signature \(expect 2xx\): HTTP 200, stored 16 B \(uploads\/tmp\/selftest\/[0-9a-f-]{36}\.bin\)$/)
    expect(lines[2]).toMatch(/^ {2}ok {3}PUT 17 B with a 16 B signature \(expect 4xx\): HTTP 403 SignatureDoesNotMatch, nothing stored \(uploads\/tmp\/selftest\/[0-9a-f-]{36}\.bin\)$/)
    expect(lines[3]).toBe('presign-selftest: ok, storage enforces the signed Content-Length')
    expect(await listKeys(SELFTEST_PREFIX)).toEqual(before)
  }, 30_000)
})
