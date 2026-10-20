import { describe, expect, test } from 'bun:test'
import { activeNavItem, ADMIN_NAV, adminSearchTarget, canOpen, isStaff, navForRole } from '#/ui/admin/nav'

const ids = (role: string | null) => navForRole(role).flatMap((g) => g.items.map((i) => i.id))

describe('admin nav filtering', () => {
  test('站长 sees every item', () => {
    expect(ids('admin')).toEqual(ADMIN_NAV.flatMap((g) => g.items.map((i) => i.id)))
  })

  test('管理员 sees content and comments, not users or system', () => {
    expect(ids('manager')).toEqual(['dash', 'review', 'packs', 'upload', 'emojis', 'characters', 'artists', 'taxonomy', 'comments'])
    expect(navForRole('manager').map((g) => g.title)).toEqual(['概览', '内容', '社区'])
  })

  test('用户 and unknown roles see nothing', () => {
    expect(navForRole('user')).toEqual([])
    expect(navForRole('owner')).toEqual([])
    expect(navForRole(null)).toEqual([])
  })

  test('only 站长 and 管理员 are staff', () => {
    expect([isStaff('admin'), isStaff('manager'), isStaff('user'), isStaff(undefined)]).toEqual([true, true, false, false])
  })
})

describe('active item and access', () => {
  test('matches the longest prefix; /admin itself only exactly', () => {
    expect(activeNavItem('/admin')?.id).toBe('dash')
    expect(activeNavItem('/admin/')?.id).toBe('dash')
    expect(activeNavItem('/admin/packs')?.id).toBe('packs')
    expect(activeNavItem('/admin/packs/aimisi-01')?.id).toBe('packs')
    expect(activeNavItem('/admin/packsx')).toBeUndefined()
    expect(activeNavItem('/admin/unknown')).toBeUndefined()
  })

  test('管理员 gets 403 on 站长-only pages', () => {
    for (const p of ['/admin/users', '/admin/downloads', '/admin/storage', '/admin/jobs', '/admin/audit', '/admin/settings']) {
      expect(canOpen('manager', p)).toBe(false)
      expect(canOpen('admin', p)).toBe(true)
    }
    expect(canOpen('manager', '/admin/review')).toBe(true)
    expect(canOpen('manager', '/admin/packs/aimisi-01')).toBe(true)
  })

  test('用户 cannot open the admin at all; unknown admin paths are staff-only', () => {
    expect(canOpen('user', '/admin')).toBe(false)
    expect(canOpen('user', '/admin/review')).toBe(false)
    expect(canOpen('manager', '/admin/unknown')).toBe(true)
    expect(canOpen(null, '/admin')).toBe(false)
  })
})

describe('top-bar search', () => {
  test('emoji ids and hashes open 表情库, from any page', () => {
    expect(adminSearchTarget(' r-0A7BF47F ', 'manager', '/admin/packs')).toEqual({ to: '/admin/emojis', q: 'r-0a7bf47f' })
    expect(adminSearchTarget('a'.repeat(64), 'admin', '/admin/users')).toEqual({ to: '/admin/emojis', q: 'a'.repeat(64) })
  })

  test('e-mail addresses open 用户与权限 for 站长 only', () => {
    expect(adminSearchTarget('fan@example.com', 'admin', '/admin')).toEqual({ to: '/admin/users', q: 'fan@example.com' })
    expect(adminSearchTarget('fan@example.com', 'manager', '/admin')).toEqual({ to: '/admin/packs', q: 'fan@example.com' })
  })

  test('other text searches the list being viewed, else 表情包', () => {
    expect(adminSearchTarget('海风', 'admin', '/admin/users')).toEqual({ to: '/admin/users', q: '海风' })
    expect(adminSearchTarget('爱弥斯', 'admin', '/admin/emojis')).toEqual({ to: '/admin/emojis', q: '爱弥斯' })
    expect(adminSearchTarget('爱弥斯', 'manager', '/admin/review')).toEqual({ to: '/admin/packs', q: '爱弥斯' })
    expect(adminSearchTarget('aimisi-01', 'admin', '/admin/packs/12')).toEqual({ to: '/admin/packs', q: 'aimisi-01' })
  })
})
