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
