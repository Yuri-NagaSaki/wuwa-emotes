import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import ts from 'typescript'

// CI guard (docs/ARCHITECTURE.md §5.1): every createServerFn() chain must declare
// .middleware([...]) containing publicFn, requireUser or requirePerm(...). Parsed with the TypeScript
// compiler, so comments and strings that mention createServerFn( are ignored. A chain split across
// variables (const base = createServerFn(); base.middleware(...)) counts as unguarded on purpose.

const GUARD_IDENTIFIERS = new Set(['publicFn', 'requireUser'])
const GUARD_FACTORIES = new Set(['requirePerm'])

export interface Finding {
  file: string
  line: number
  snippet: string
}

function isGuard(el: ts.Expression): boolean {
  if (ts.isIdentifier(el)) return GUARD_IDENTIFIERS.has(el.text)
  if (ts.isCallExpression(el) && ts.isIdentifier(el.expression)) return GUARD_FACTORIES.has(el.expression.text)
  return false
}

export function findUnguardedServerFns(source: string, file: string): Finding[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const findings: Finding[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createServerFn') {
      let guarded = false
      let cur: ts.Expression = node
      // walk outward through `.method(...)` links of the same chain
      for (;;) {
        const access = cur.parent
        if (!access || !ts.isPropertyAccessExpression(access) || access.expression !== cur) break
        const call = access.parent
        if (!call || !ts.isCallExpression(call) || call.expression !== access) break
        const arg = call.arguments[0]
        if (access.name.text === 'middleware' && arg && ts.isArrayLiteralExpression(arg) && arg.elements.some(isGuard)) guarded = true
        cur = call
      }
      if (!guarded) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        findings.push({ file, line: line + 1, snippet: cur.getText(sf).split('\n')[0]!.slice(0, 120) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return findings
}

describe('scanner fixtures', () => {
  test('accepts guarded chains', () => {
    const src = `
      import { createServerFn } from '@tanstack/react-start'
      export const a = createServerFn({ method: 'GET' }).middleware([publicFn]).handler(async () => 1)
      export const b = createServerFn({ method: 'POST' })
        .middleware([requireUser])
        .validator(schema)
        .handler(async ({ context }) => context.viewer.id)
      export const c = createServerFn({ method: 'POST' })
        .validator(schema)
        .middleware([logTiming, requirePerm('packs')])
        .handler(async () => null)
    `
    expect(findUnguardedServerFns(src, 'fixture.ts')).toEqual([])
  })

  test('flags missing, empty and unrelated middleware', () => {
    const src = `
      export const noMiddleware = createServerFn({ method: 'GET' }).handler(async () => 1)
      export const emptyList = createServerFn().middleware([]).handler(async () => 1)
      export const otherOnly = createServerFn()
        .middleware([logTiming])
        .handler(async () => 1)
      export const notAList = createServerFn().middleware(guards).handler(async () => 1)
      const base = createServerFn({ method: 'POST' })
      export const split = base.middleware([requireUser]).handler(async () => 1)
    `
    const found = findUnguardedServerFns(src, 'fixture.ts')
    expect(found.map((f) => f.line)).toEqual([2, 3, 4, 7, 8])
  })

  test('ignores comments and strings, parses TSX', () => {
    const src = `
      // createServerFn().handler(() => 1) in a comment
      /* createServerFn( */
      const doc = "createServerFn(".length
      export function C() { return <p>{doc}</p> }
    `
    expect(findUnguardedServerFns(src, 'fixture.tsx')).toEqual([])
  })
})

describe('src/', () => {
  test('every createServerFn chain declares publicFn, requireUser or requirePerm', async () => {
    const root = join(import.meta.dir, '..', '..')
    const files = [...new Bun.Glob('src/**/*.{ts,tsx}').scanSync({ cwd: root })]
    expect(files.length).toBeGreaterThan(10)
    const findings: Finding[] = []
    for (const file of files) {
      const source = await Bun.file(join(root, file)).text()
      if (!source.includes('createServerFn')) continue
      findings.push(...findUnguardedServerFns(source, file))
    }
    const report = findings.map((f) => `${f.file}:${f.line}  ${f.snippet}`).join('\n')
    expect(report).toBe('')
  })
})
