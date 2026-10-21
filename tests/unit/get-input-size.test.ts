import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import ts from 'typescript'
import { z } from 'zod'
import { FN_PATH_ALLOWANCE, GET_URL_LIMIT, getCallUrlBytes, type InputFinding, inputFindings } from './get-inputs'

// A GET server function carries its input in the URL (`/_serverFn/<id>?payload=…`). favoriteStatusFn
// once took up to 200 targets that way: from about 100 (≈ 23 KB of URL) Cloudflare answered 520, which
// filled the console on long packs. Guard: no GET validator may accept a collection (array, set, record,
// map) or an input the scan cannot read, unless it is listed below with a sample of its largest allowed
// input whose URL, encoded the way Start's client encodes it, stays under GET_URL_LIMIT (8 KB). Anything
// bigger belongs in a POST.
//
// The validators are read at runtime: tests/unit/get-inputs.probe.ts runs in its own process with
// createServerFn replaced by a recorder (the replacement must not reach other tests), imports every src/
// module that defines server functions and reports what each exported function's validator accepts.

const EMOJI_ID = 'r-0a7bf47f0ec26d3843bf'

/** GET functions whose input has a collection, each with its largest allowed input. */
const ALLOWED: Record<string, { why: string; maxSample: () => unknown }> = {
  'src/server/comments/fns.ts#stickerSourceFn': {
    why: 'the sticker picker re-validates at most 60 recent sticker ids (stickerSourceInput)',
    maxSample: () => ({ kind: 'ids', ids: Array.from({ length: 60 }, (_, i) => `r-${i.toString(16).padStart(20, 'f')}`) }),
  },
}

interface ProbeFn {
  id: string
  method: string
  hasValidator: boolean
  findings: InputFinding[]
}
interface Probe {
  files: number
  captured: number
  unexported: number
  failedImports: string[]
  fns: ProbeFn[]
}

const root = join(import.meta.dir, '..', '..')

async function probe(): Promise<Probe> {
  const p = Bun.spawn(['bun', join(import.meta.dir, 'get-inputs.probe.ts')], { cwd: root, env: { ...process.env, LOG_LEVEL: 'error' }, stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  if (code !== 0) throw new Error(`probe failed (${code}): ${err}`)
  return JSON.parse(out.trim().split('\n').pop()!) as Probe
}

/** GET server functions in the source, counted from the syntax tree (method 'GET' or none: GET is the default). */
function countGetChains(source: string, file: string): number {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  let n = 0
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createServerFn') {
      const arg = node.arguments[0]
      let method = 'GET'
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const p of arg.properties) {
          if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'method' && ts.isStringLiteral(p.initializer)) method = p.initializer.text.toUpperCase()
        }
      }
      if (method === 'GET') n++
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return n
}

/** The GET functions that break the rule, with the reason; allowlisted ones are size-checked. */
async function violations(fns: ProbeFn[], allowed: typeof ALLOWED): Promise<string[]> {
  const out: string[] = []
  for (const f of fns) {
    if (f.method !== 'GET' || !f.findings.length) continue
    const what = f.findings.map((x) => `${x.path} ${x.kind}${x.max != null ? ` ≤ ${x.max}` : ''}`).join(', ')
    const entry = allowed[f.id]
    if (!entry) {
      out.push(`${f.id}: GET input takes ${what}; make it a POST, or list it in ALLOWED with its largest input`)
      continue
    }
    const bytes = await getCallUrlBytes(entry.maxSample())
    if (bytes >= GET_URL_LIMIT) out.push(`${f.id}: largest input encodes to ${bytes} bytes of URL (limit ${GET_URL_LIMIT}); make it a POST`)
  }
  return out
}

describe('scanner', () => {
  test('finds collections at any depth, through optional, default, pipe and union', () => {
    const v = z
      .object({
        a: z.string(),
        list: z.array(z.string()).max(20),
        nested: z.object({ tags: z.array(z.number()).optional() }).default({ tags: [] }),
        either: z.union([z.object({ kind: z.literal('x') }), z.object({ kind: z.literal('y'), set: z.set(z.string()) })]),
        piped: z.string().transform((s) => s.split(',')),
        rec: z.record(z.string(), z.number()),
      })
      .optional()
    expect(inputFindings(v)).toEqual([
      { path: '.list', kind: 'array', max: 20 },
      { path: '.nested.tags', kind: 'array', max: undefined },
      { path: '.either.set', kind: 'set', max: undefined },
      { path: '.rec', kind: 'record' },
    ])
  })

  test('scalars only: nothing to report; a non-zod validator is reported as unreadable', () => {
    expect(inputFindings(z.object({ id: z.number().int(), slug: z.string().max(120), sort: z.enum(['a', 'b']).optional() }))).toEqual([])
    expect(inputFindings(undefined)).toEqual([])
    expect(inputFindings((d: unknown) => d)).toEqual([{ path: '', kind: 'unknown' }])
    expect(inputFindings(z.unknown())).toEqual([{ path: '.', kind: 'unknown' }])
  })

  test('URL size follows the client encoding: the old favoriteStatusFn input fails, a small one passes', async () => {
    const targets = (n: number) => ({ targets: Array.from({ length: n }, (_, i) => ({ type: 'emoji', id: `r-${i.toString(16).padStart(20, '0')}` })) })
    // measured on the live site: 20 targets ≈ 5 KB and 60 ≈ 14 KB worked, ~100 (≈ 23 KB) got 520
    const b20 = await getCallUrlBytes(targets(20))
    const b100 = await getCallUrlBytes(targets(100))
    expect(b20).toBeGreaterThan(3_000)
    expect(b20).toBeLessThan(GET_URL_LIMIT)
    expect(b100).toBeGreaterThan(18_000)
    expect(b100).toBeLessThan(30_000)
  })

  test('an array in a GET is flagged; allowlisted ones pass only when the largest input is small', async () => {
    const fn = (id: string, findings: InputFinding[], method = 'GET'): ProbeFn => ({ id, method, hasValidator: true, findings })
    const arr: InputFinding[] = [{ path: '.targets', kind: 'array', max: 200 }]
    const sample = (n: number) => () => ({ targets: Array.from({ length: n }, () => ({ type: 'emoji', id: EMOJI_ID })) })
    expect(await violations([fn('a#getFn', arr), fn('b#postFn', arr, 'POST')], {})).toEqual([
      'a#getFn: GET input takes .targets array ≤ 200; make it a POST, or list it in ALLOWED with its largest input',
    ])
    expect(await violations([fn('a#getFn', arr)], { 'a#getFn': { why: 'test', maxSample: sample(10) } })).toEqual([])
    const big = await violations([fn('a#getFn', arr)], { 'a#getFn': { why: 'test', maxSample: sample(200) } })
    expect(big.length).toBe(1)
    expect(big[0]).toMatch(/^a#getFn: largest input encodes to \d+ bytes of URL \(limit 8192\); make it a POST$/)
  })
})

describe('src/', () => {
  test('no GET server function takes an input that can outgrow 8 KB of URL', async () => {
    const p = await probe()
    expect(p.failedImports).toEqual([])
    expect(p.unexported).toBe(0)

    // the probe saw every GET chain in the source (a module that failed to load would pass vacuously)
    let astGets = 0
    for (const file of new Bun.Glob('src/**/*.{ts,tsx}').scanSync({ cwd: root })) {
      const source = await Bun.file(join(root, file)).text()
      if (source.includes('createServerFn')) astGets += countGetChains(source, file)
    }
    const gets = p.fns.filter((f) => f.method === 'GET')
    expect(astGets).toBeGreaterThan(40)
    expect(gets.length).toBe(astGets)
    expect(p.fns.length).toBe(p.captured)

    expect(await violations(p.fns, ALLOWED)).toEqual([])
    // every allowlisted entry still exists, is a GET and still needs to be listed
    for (const id of Object.keys(ALLOWED)) {
      const f = p.fns.find((x) => x.id === id)
      expect(f?.method).toBe('GET')
      expect(f?.findings.length).toBeGreaterThan(0)
    }
  }, 120_000)

  test('allowlisted inputs, measured', async () => {
    for (const [id, entry] of Object.entries(ALLOWED)) {
      const bytes = await getCallUrlBytes(entry.maxSample())
      console.log(`${id}: largest input ${bytes} bytes of URL (path allowance ${FN_PATH_ALLOWANCE}, limit ${GET_URL_LIMIT}) — ${entry.why}`)
      expect(bytes).toBeLessThan(GET_URL_LIMIT)
    }
  })
})
