import { describe, expect, test } from 'bun:test'
import { EMOJI_ID_RE, isEmojiId, isPackKey, newEmojiId, newPackKey, PACK_KEY_RE, REV_RE } from '#/shared/ids'

describe('EMOJI_ID_RE', () => {
  test.each(['r-0a7bf47f0ec26d3843bf', 'r-00000000000000000000', 'r-ffffffffffffffffffff'])('accepts %p', (id) => {
    expect(isEmojiId(id)).toBe(true)
  })

  test.each([
    'r-0A7BF47F0EC26D3843BF', // uppercase
    'r-0a7bf47f0ec26d3843b', // 19 hex
    'r-0a7bf47f0ec26d3843bf0', // 21 hex
    'x-0a7bf47f0ec26d3843bf',
    'r_0a7bf47f0ec26d3843bf',
    'r-0a7bf47f0ec26d3843bg',
    ' r-0a7bf47f0ec26d3843bf',
    'r-0a7bf47f0ec26d3843bf\n',
    '',
  ])('rejects %p', (id) => {
    expect(isEmojiId(id)).toBe(false)
  })
})

describe('PACK_KEY_RE', () => {
  test.each(['a', '0', 'abc', 'linglanhuajiang-charging-20261009', 'a-b', 'a'.repeat(100)])('accepts %p', (key) => {
    expect(isPackKey(key)).toBe(true)
  })

  test.each(['', '-a', 'a-', 'A', 'aB', 'a_b', 'a.b', 'a/b', '..', 'a'.repeat(101), '中文', 'a b'])('rejects %p', (key) => {
    expect(isPackKey(key)).toBe(false)
  })
})

describe('REV_RE', () => {
  test('positive integers without leading zeros', () => {
    for (const ok of ['1', '9', '10', '123']) expect(REV_RE.test(ok)).toBe(true)
    for (const bad of ['0', '01', '-1', '1.0', '', 'a']) expect(REV_RE.test(bad)).toBe(false)
  })
})

describe('generators', () => {
  test('newEmojiId matches the v1 shape and does not repeat', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 2000; i++) {
      const id = newEmojiId()
      expect(id).toMatch(EMOJI_ID_RE)
      ids.add(id)
    }
    expect(ids.size).toBe(2000)
  })

  test('newPackKey always matches PACK_KEY_RE', () => {
    const hints = ['', 'Hello World', '中文标题', '---', 'A'.repeat(200), 'shorekeeper 守岸人', '  trailing  ', 'a_b.c/d', '-x-']
    for (const hint of hints) {
      for (let i = 0; i < 50; i++) expect(newPackKey(hint)).toMatch(PACK_KEY_RE)
    }
  })

  test('newPackKey keeps a readable slug part when there is one', () => {
    expect(newPackKey('Hello World')).toMatch(/^hello-world-[0-9a-f]{8}$/)
    expect(newPackKey('中文')).toMatch(/^u-[0-9a-f]{8}$/)
    expect(newPackKey()).toMatch(/^u-[0-9a-f]{8}$/)
  })
})
