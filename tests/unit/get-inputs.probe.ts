// Run by get-input-size.test.ts in a process of its own (not a test file): replaces
// @tanstack/react-start's createServerFn with a recorder, imports every src/ module that defines server
// functions and prints, as JSON, each exported server function's method and the collections its
// validator accepts. The recorder must not leak into other tests, hence the separate process.
import { plugin } from 'bun'
import { join } from 'node:path'
import { type InputFinding, inputFindings } from './get-inputs'

const real = await import('@tanstack/react-start')

interface Captured {
  method: string
  validator: unknown
  fn?: unknown
  named?: boolean
}
const captured: Captured[] = []

function recordingCreateServerFn(opts?: { method?: string }) {
  const state: Captured = { method: (opts?.method ?? 'GET').toUpperCase(), validator: undefined }
  const builder = {
    middleware: () => builder,
    validator: (v: unknown) => {
      state.validator = v
      return builder
    },
    inputValidator: (v: unknown) => {
      state.validator = v
      return builder
    },
    handler: () => {
      const fn = Object.assign(async () => undefined, { method: state.method })
      state.fn = fn
      captured.push(state)
      return fn
    },
  }
  return builder
}

plugin({
  name: 'record-server-fns',
  setup(build) {
    build.module('@tanstack/react-start', () => ({ exports: { ...real, createServerFn: recordingCreateServerFn }, loader: 'object' }))
  },
})

const root = join(import.meta.dir, '..', '..')
const files: string[] = []
for (const f of new Bun.Glob('src/**/*.{ts,tsx}').scanSync({ cwd: root })) {
  if ((await Bun.file(join(root, f)).text()).includes('createServerFn')) files.push(f)
}
files.sort()

const fns: { id: string; method: string; hasValidator: boolean; findings: InputFinding[] }[] = []
const failedImports: string[] = []
for (const f of files) {
  let mod: Record<string, unknown>
  try {
    mod = await import(join(root, f))
  } catch (err) {
    failedImports.push(`${f}: ${(err as Error).message}`)
    continue
  }
  for (const [name, value] of Object.entries(mod)) {
    const c = captured.find((x) => x.fn === value)
    if (!c) continue
    c.named = true
    fns.push({ id: `${f}#${name}`, method: c.method, hasValidator: c.validator !== undefined, findings: inputFindings(c.validator) })
  }
}
console.log(JSON.stringify({ files: files.length, captured: captured.length, unexported: captured.filter((c) => !c.named).length, failedImports, fns }))
process.exit(0)
