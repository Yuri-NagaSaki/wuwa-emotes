// Manual helper (not a test): create the 站长 and 管理员 accounts used by tests/admin/shots.ts on a dev
// server started with CAP_DISABLED=1 (any token passes then), then set their roles in the dev database.
//
//   DATABASE_URL=postgres://chaochi:chaochi@127.0.0.1:5432/chaochi_lane_h \
//     bun tests/admin/dev-accounts.ts http://localhost:3191
import pg from 'pg'

export const ACCOUNTS = [
  { email: 'owner@lane-h.test', name: '潮池站长', role: 'admin' },
  { email: 'manager@lane-h.test', name: '海风', role: 'manager' },
] as const
export const PASSWORD = 'lane-h-password-123'

if (import.meta.main) {
  const base = process.argv[2] ?? 'http://localhost:3191'
  const url = process.env.DATABASE_URL ?? ''
  if (!/chaochi_lane_h(?!_test)/.test(url)) throw new Error('DATABASE_URL must point at the chaochi_lane_h dev database')
  for (const a of ACCOUNTS) {
    const res = await fetch(`${base}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base, 'x-cap-token': 'dev-cap-disabled' },
      body: JSON.stringify({ email: a.email, password: PASSWORD, name: a.name }),
    })
    console.log(a.email, res.status, res.status === 200 ? 'created' : (await res.text()).slice(0, 120))
  }
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  for (const a of ACCOUNTS) await c.query('update users set role = $2 where email = $1', [a.email, a.role])
  const rows = await c.query('select name, email, role from users order by email')
  console.table(rows.rows)
  await c.end()
}
