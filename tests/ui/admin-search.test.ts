import { describe, expect, test } from 'bun:test'
import { bool, day, int, oneOf, searchParser, text } from '../../src/ui/admin/search'

// The admin routes' validateSearch parsers (no zod in the route tree, so none in the entry chunk).

describe('admin search parsers', () => {
  const users = searchParser({
    q: text(100),
    role: oneOf(['admin', 'manager', 'user']),
    banned: bool,
    page: int(1, 10_000),
    from: day,
  })

  test('keeps valid values and drops the rest', () => {
    expect(users({ q: '雾雪', role: 'manager', banned: true, page: 3, from: '2026-10-01' })).toEqual({
      q: '雾雪',
      role: 'manager',
      banned: true,
      page: 3,
      from: '2026-10-01',
    })
    expect(users({ q: 'x'.repeat(101), role: 'owner', banned: 'yes', page: 0, from: '2026-1-1', extra: 1 })).toEqual({})
    expect(users({})).toEqual({})
  })

  test('accepts what the router hands over for query strings', () => {
    // ?page=2 arrives as 2, ?page="2" as "2"; ?q=123 as the number 123
    expect(users({ page: '2', q: 123, banned: 'false' })).toEqual({ page: 2, q: '123', banned: false })
    expect(users({ page: 2.5 })).toEqual({})
    expect(users({ page: 10_001 })).toEqual({})
    expect(users({ page: '' })).toEqual({})
  })

  test('int without a maximum (ids)', () => {
    const p = searchParser({ pack: int(1) })
    expect(p({ pack: 42 })).toEqual({ pack: 42 })
    expect(p({ pack: -1 })).toEqual({})
    expect(p({ pack: 'abc' })).toEqual({})
  })
})
