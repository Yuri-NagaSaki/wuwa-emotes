import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { characterCountText } from '#/shared/characters'
import { CharacterTags, collapsesCharacters, COLLAPSE_AFTER } from '#/ui/pages/CharacterTags'

// How character numbers and character chips read (src/shared/characters.ts, CharacterTags.tsx).

describe('characterCountText', () => {
  test('stickers of its own: 张 and 包', () => {
    expect(characterCountText({ emojiCount: 1640, packCount: 40, groupCount: 3 })).toBe('1,640 张 · 40 包')
    expect(characterCountText({ emojiCount: 1, packCount: 1, groupCount: 0 })).toBe('1 张 · 1 包')
  })

  test('only in group packs: the 合集包 count, never 0 张', () => {
    expect(characterCountText({ emojiCount: 0, packCount: 0, groupCount: 2 })).toBe('出现在 2 个合集包')
  })

  test('nothing yet (a portrait only)', () => {
    expect(characterCountText({ emojiCount: 0, packCount: 0, groupCount: 0 })).toBe('暂无表情')
  })
})

describe('CharacterTags', () => {
  const chars = (n: number) => Array.from({ length: n }, (_, i) => ({ slug: `c${i}`, name: `角色${i}`, color: null }))

  test(`more than ${COLLAPSE_AFTER} characters collapse into one chip`, () => {
    expect(collapsesCharacters(COLLAPSE_AFTER)).toBe(false)
    expect(collapsesCharacters(COLLAPSE_AFTER + 1)).toBe(true)
    const html = renderToStaticMarkup(createElement(CharacterTags, { chars: chars(24) }))
    expect(html).toContain('24 位角色')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('角色 · ')
    // the names stay reachable as the chip's title
    expect(html).toContain('角色0、角色1')
  })
})
