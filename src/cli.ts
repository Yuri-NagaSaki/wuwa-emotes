// Operator commands, run inside the app container:
//   bun src/cli.ts promote-admin <email>     make an existing account 站长 (bootstrap the first admin)
//   bun src/cli.ts set-role <email> <admin|manager|user>
import { eq } from 'drizzle-orm'
import { audit } from './server/audit'
import { closeDb, db, schema } from './server/db/client'
import { isRole } from './shared/roles'

async function setRole(email: string, role: string) {
  if (!isRole(role)) throw new Error(`unknown role: ${role}`)
  const rows = await db().update(schema.users).set({ role }).where(eq(schema.users.email, email.toLowerCase())).returning({ id: schema.users.id })
  if (!rows.length) throw new Error(`no account with email ${email}`)
  await audit(null, 'cli.set-role', { type: 'user', id: rows[0]!.id }, { role })
  console.log(`${email} -> ${role}`)
}

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
    default:
      console.log('commands: promote-admin <email> | set-role <email> <role>')
  }
  await closeDb()
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err)
  await closeDb()
  process.exit(1)
})
