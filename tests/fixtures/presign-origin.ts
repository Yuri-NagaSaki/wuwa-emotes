// Run in a child process by tests/unit/security.test.ts with an inline env: prints real presigned
// URLs (no network access needed) next to the CSP built from the same env.
import { env } from '../../src/server/env'
import { buildCsp, securityConfig } from '../../src/server/http/security'
import { presignGet, presignPut } from '../../src/server/media/s3'

const get = await presignGet('assets/v1/packs/fixture-pack/emojis/r-0a7bf47f0ec26d3843bf.gif', { filename: 'a.gif' })
const put = await presignPut('uploads/tmp/2026/10/20/up1/a.gif', 'image/gif', 1024)
console.log(JSON.stringify({ get, put, csp: buildCsp(securityConfig(env())) }))
