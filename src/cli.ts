// Operator commands, run inside the app container:
//   bun src/cli.ts promote-admin <email>     make an existing account 站长 (bootstrap the first admin)
//   bun src/cli.ts set-role <email> <admin|manager|user>
//   bun src/cli.ts import-v1 [--prefix meta/v1/] [--dry-run]
//                                            import the read-only v1 snapshot from the bucket (idempotent)
//   bun src/cli.ts backfill-dims [--concurrency 16] [--limit N]
//                                            width/height of originals that have none (32-byte ranged reads)
//   bun src/cli.ts backfill-derived [--pack <packKey>] [--limit N]
//                                            queue p240/a160 generation for published emojis without them
//   bun src/cli.ts presign-selftest          check that storage refuses a PUT whose size differs from the
//                                            signed Content-Length (writes and deletes uploads/tmp/selftest/ only)
//   bun src/cli.ts import-portraits <manifest.json | -> [--dry-run] [--delay 800]
//                                            official character portraits into characters/v1/portraits/ and
//                                            characters.portrait_key, theme colours where empty (idempotent;
//                                            `-` reads the manifest from stdin)
//   bun src/cli.ts derive-colors [--dry-run] theme colours from portraits or avatar stickers, where empty
import { eq } from 'drizzle-orm'
import { audit } from './server/audit'
import { closeDb, db, schema } from './server/db/client'
import { isPackKey } from './shared/ids'
import { isRole } from './shared/roles'

async function setRole(email: string, role: string) {
  if (!isRole(role)) throw new Error(`unknown role: ${role}`)
  const rows = await db().update(schema.users).set({ role }).where(eq(schema.users.email, email.toLowerCase())).returning({ id: schema.users.id })
  if (!rows.length) throw new Error(`no account with email ${email}`)
  await audit(null, 'cli.set-role', { type: 'user', id: rows[0]!.id }, { role })
  console.log(`${email} -> ${role}`)
}

/** `--name value`, `--name=value` and bare `--flag` (true). */
function parseFlags(args: string[], known: Record<string, 'string' | 'boolean'>): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < args.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(args[i]!)
    if (!m || !known[m[1]!]) throw new Error(`unknown argument: ${args[i]}`)
    const name = m[1]!
    if (known[name] === 'boolean') {
      if (m[2] != null) throw new Error(`--${name} takes no value`)
      out[name] = true
    } else {
      const value = m[2] ?? args[++i]
      if (value == null || value.startsWith('--')) throw new Error(`--${name} needs a value`)
      out[name] = value
    }
  }
  return out
}

function positiveInt(value: string | boolean | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive integer`)
  return n
}

async function importV1Cmd(args: string[]) {
  const flags = parseFlags(args, { prefix: 'string', 'dry-run': 'boolean' })
  const prefix = (flags.prefix as string | undefined) ?? 'meta/v1/'
  if (!prefix.endsWith('/')) throw new Error('--prefix must end with /')
  const { formatSummary, importV1 } = await import('./server/import/v1')
  const summary = await importV1({ prefix, dryRun: flags['dry-run'] === true })
  console.log(formatSummary(summary))
}

async function backfillDimsCmd(args: string[]) {
  const flags = parseFlags(args, { concurrency: 'string', limit: 'string' })
  const { backfillDims } = await import('./server/import/dims')
  const r = await backfillDims({
    concurrency: positiveInt(flags.concurrency, 'concurrency') ?? 16,
    limit: positiveInt(flags.limit, 'limit'),
    onBatch: (p) => console.log(`  scanned ${p.scanned}, updated ${p.updated} (sharp ${p.viaSharp}), failed ${p.failed.length}`),
  })
  console.log(`backfill-dims: scanned ${r.scanned}, updated ${r.updated} (sharp ${r.viaSharp}), failed ${r.failed.length}`)
  for (const f of r.failed.slice(0, 20)) console.log(`  - ${f.id}: ${f.error}`)
  if (r.failed.length > 20) console.log(`  … ${r.failed.length - 20} more`)
}

async function backfillDerivedCmd(args: string[]) {
  const flags = parseFlags(args, { pack: 'string', limit: 'string' })
  const packKey = flags.pack as string | undefined
  if (packKey !== undefined && !isPackKey(packKey)) throw new Error(`not a pack key: ${packKey}`)
  const { backfillDerived, bossDeriveInserter } = await import('./server/import/derived')
  const { jobSender } = await import('./server/jobs/boss')
  const boss = await jobSender()
  try {
    const r = await backfillDerived({ packKey, limit: positiveInt(flags.limit, 'limit') }, bossDeriveInserter(boss))
    console.log(`backfill-derived: ${r.candidates} emoji(s) without derivatives, ${r.enqueued} job(s) queued (the rest were already waiting)`)
  } finally {
    await boss.stop({ graceful: true })
  }
}

async function importPortraitsCmd(args: string[]) {
  const [file, ...rest] = args
  if (!file || file.startsWith('--')) throw new Error('usage: import-portraits <manifest.json | -> [--dry-run] [--delay 800]')
  const flags = parseFlags(rest, { 'dry-run': 'boolean', delay: 'string' })
  const text = file === '-' ? await new Response(Bun.stdin.stream()).text() : await Bun.file(file).text()
  let manifest: unknown
  try {
    manifest = JSON.parse(text)
  } catch {
    throw new Error(`${file === '-' ? 'stdin' : file}: not JSON`)
  }
  const { formatPortraitSummary, importPortraits } = await import('./server/import/portraits')
  const delay = flags.delay === undefined ? undefined : Number(flags.delay)
  if (delay !== undefined && (!Number.isInteger(delay) || delay < 0)) throw new Error('--delay must be a whole number of milliseconds')
  const summary = await importPortraits(manifest, { dryRun: flags['dry-run'] === true, delayMs: delay, log: (l) => console.log(l) })
  console.log(formatPortraitSummary(summary))
  if (summary.results.some((r) => r.outcome === 'failed')) process.exitCode = 1
}

async function deriveColorsCmd(args: string[]) {
  const flags = parseFlags(args, { 'dry-run': 'boolean' })
  const { deriveThemeColors, formatThemeColors } = await import('./server/import/theme-colors')
  const dryRun = flags['dry-run'] === true
  console.log(formatThemeColors(await deriveThemeColors({ dryRun }), dryRun))
}

async function presignSelftestCmd() {
  const { presignSelftest } = await import('./server/media/presign-selftest')
  const r = await presignSelftest()
  console.log(`presign-selftest: bucket ${r.bucket}`)
  for (const c of r.cases) console.log(`  ${c.line}`)
  console.log(r.ok ? 'presign-selftest: ok, storage enforces the signed Content-Length' : 'presign-selftest: FAILED')
  if (!r.ok) process.exitCode = 1
}

const USAGE = [
  'commands:',
  '  promote-admin <email>',
  '  set-role <email> <admin|manager|user>',
  '  import-v1 [--prefix meta/v1/] [--dry-run]',
  '  backfill-dims [--concurrency 16] [--limit N]',
  '  backfill-derived [--pack <packKey>] [--limit N]',
  '  presign-selftest',
  '  import-portraits <manifest.json | -> [--dry-run] [--delay 800]',
  '  derive-colors [--dry-run]',
].join('\n')

async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  switch (cmd) {
    case 'promote-admin':
      if (!args[0]) throw new Error('usage: promote-admin <email>')
      await setRole(args[0], 'admin')
      break
    case 'set-role':
      if (!args[0] || !args[1]) throw new Error('usage: set-role <email> <admin|manager|user>')
      await setRole(args[0], args[1])
      break
    case 'import-v1':
      await importV1Cmd(args)
      break
    case 'backfill-dims':
      await backfillDimsCmd(args)
      break
    case 'backfill-derived':
      await backfillDerivedCmd(args)
      break
    case 'presign-selftest':
      await presignSelftestCmd()
      break
    case 'import-portraits':
      await importPortraitsCmd(args)
      break
    case 'derive-colors':
      await deriveColorsCmd(args)
      break
    default:
      console.log(USAGE)
  }
  await closeDb()
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err)
  await closeDb()
  process.exit(1)
})
