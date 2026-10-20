import { isServerFn, runServerFn, setupAdminTests, userWithRole, type RoleUser } from './harness'
import { beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { can, type Perm } from '#/shared/roles'

// Permission matrix (docs/ARCHITECTURE.md §5.1) for every server function exported from
// src/server/admin/fns/*.ts: anonymous → 401, 用户 → 403, 管理员 allowed only for the permissions
// in ROLES.manager, 站长 always allowed. "Allowed" means the request got past requirePerm: the input
// validator or the (unattached) handler may still answer, but never with 401/403.

const EXPECTED: Record<string, Perm> = {
  adminDashboardFn: 'dash',
  adminPacksFn: 'packs',
  adminPackEditorFn: 'packs',
  adminCreatePackFn: 'packs',
  adminUpdatePackFn: 'packs',
  adminPacksStatusFn: 'packs',
  adminRebuildZipFn: 'packs',
  adminDeletePackFn: 'packs',
  adminEmojisFn: 'packs',
  adminEmojiDetailFn: 'packs',
  adminReorderFn: 'packs',
  adminEmojiStatusFn: 'packs',
  adminPublishEmojisFn: 'packs',
  adminDeleteEmojisFn: 'packs',
  adminRegenerateFn: 'packs',
  adminMoveEmojisFn: 'packs',
  adminSignUploadsFn: 'upload',
  adminCompleteUploadsFn: 'upload',
  adminAdvanceUploadsFn: 'upload',
  adminUploadTargetsFn: 'upload',
  adminCharactersFn: 'taxonomy',
  adminArtistsFn: 'taxonomy',
  adminTagsFn: 'taxonomy',
  adminSaveCharacterFn: 'taxonomy',
  adminSaveArtistFn: 'taxonomy',
  adminSaveTagFn: 'taxonomy',
  adminDeleteTaxonomyFn: 'taxonomy',
  adminMergeTaxonomyFn: 'taxonomy',
  adminUsersFn: 'users',
  adminSetRoleFn: 'users',
  adminSetSubmitModeFn: 'users',
  adminBanUserFn: 'users',
  adminUnbanUserFn: 'users',
  adminRevokeSessionsFn: 'users',
  adminImpersonateFn: 'users',
  adminStorageFn: 'storage',
  adminJobsFn: 'system',
  adminRetryJobFn: 'system',
  adminCancelJobFn: 'system',
  adminAuditFn: 'audit',
  adminSettingsFn: 'settings',
  adminSaveSiteFn: 'settings',
}

const FN_DIR = join(import.meta.dir, '..', '..', 'src', 'server', 'admin', 'fns')
const fns = new Map<string, unknown>()

let owner: RoleUser
let manager: RoleUser
let user: RoleUser

beforeAll(async () => {
  await setupAdminTests()
  for (const file of new Bun.Glob('*.ts').scanSync({ cwd: FN_DIR })) {
    const mod = (await import(join(FN_DIR, file))) as Record<string, unknown>
    for (const [name, value] of Object.entries(mod)) if (isServerFn(value)) fns.set(name, value)
  }
  owner = await userWithRole('admin', 'matrix-owner')
  manager = await userWithRole('manager', 'matrix-manager')
  user = await userWithRole('user', 'matrix-user')
}, 60_000)

describe('admin server functions', () => {
  test('every exported server function is in the expected table, and vice versa', () => {
    expect([...fns.keys()].sort()).toEqual(Object.keys(EXPECTED).sort())
  })

  test('the matrix covers the three roles of §5.1', () => {
    // managers: packs, upload, taxonomy, dash; never users, storage, system, audit, settings
    for (const p of ['dash', 'packs', 'upload', 'taxonomy'] as Perm[]) expect(can('manager', p)).toBe(true)
    for (const p of ['users', 'storage', 'system', 'audit', 'settings'] as Perm[]) expect(can('manager', p)).toBe(false)
  })

  for (const [name, perm] of Object.entries(EXPECTED)) {
    test(`${name} (${perm}): anonymous 401, user 403, manager ${can('manager', perm) ? 'allowed' : '403'}, 站长 allowed`, async () => {
      const fn = fns.get(name)
      expect(fn).toBeDefined()
      const anon = await runServerFn(fn, {})
      expect(anon.status).toBe(401)
      const asUser = await runServerFn(fn, {}, user.cookie)
      expect(asUser.status).toBe(403)
      const asManager = await runServerFn(fn, {}, manager.cookie)
      if (can('manager', perm)) expect([401, 403]).not.toContain(asManager.status ?? 0)
      else expect(asManager.status).toBe(403)
      const asOwner = await runServerFn(fn, {}, owner.cookie)
      expect([401, 403]).not.toContain(asOwner.status ?? 0)
    })
  }
})
