import { describe, expect, test } from 'bun:test'
import { maskEmails } from '#/server/log'

// src/server/log.ts: mail and auth log lines keep only the first letter and the domain of an address.

describe('maskEmails', () => {
  test('masks every address in a line', () => {
    expect(maskEmails('Sign-up attempt for existing email: someone.else@example.com')).toBe('Sign-up attempt for existing email: s***@example.com')
    expect(maskEmails('a@b.io and Zed+tag@mail.example.org')).toBe('a***@b.io and Z***@mail.example.org')
  })

  test('leaves other text alone', () => {
    expect(maskEmails('no address here @ all')).toBe('no address here @ all')
  })
})
