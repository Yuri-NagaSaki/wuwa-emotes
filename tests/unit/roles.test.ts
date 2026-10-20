import { describe, expect, test } from 'bun:test'
import { can, isRole, PERMS, ROLES } from '#/shared/roles'

describe('can()', () => {
  test('站长 (admin) has every permission', () => {
    for (const perm of PERMS) expect(can('admin', perm)).toBe(true)
  })

  test('管理员 (manager) runs content but not users, risk or system', () => {
    for (const perm of ['dash', 'packs', 'review', 'upload', 'taxonomy', 'comments', 'submit'] as const) expect(can('manager', perm)).toBe(true)
    for (const perm of ['users', 'downloads', 'storage', 'system', 'audit', 'settings'] as const) expect(can('manager', perm)).toBe(false)
  })

  test('用户 (user) may only submit', () => {
    for (const perm of PERMS) expect(can('user', perm)).toBe(perm === 'submit')
  })

  test('unknown or missing roles get nothing', () => {
    for (const role of [undefined, null, '', 'root', 'Admin', '*']) {
      for (const perm of PERMS) expect(can(role, perm)).toBe(false)
    }
  })

  test('isRole matches exactly the three roles', () => {
    expect(Object.keys(ROLES).sort()).toEqual(['admin', 'manager', 'user'])
    expect(isRole('admin')).toBe(true)
    expect(isRole('manager')).toBe(true)
    expect(isRole('user')).toBe(true)
    expect(isRole('ADMIN')).toBe(false)
    expect(isRole(1)).toBe(false)
  })
})
