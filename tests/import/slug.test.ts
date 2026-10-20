import { describe, expect, test } from 'bun:test'
import { claimSlug, isHashSlug, slugify } from '../../src/server/import/slug'

describe('slugify', () => {
  test('Chinese names become toneless pinyin written together', () => {
    expect(slugify('爱弥斯')).toBe('aimisi')
    expect(slugify('长离')).toBe('changli')
    expect(slugify('守岸人')).toBe('shouanren')
    expect(slugify('女漂泊者')).toBe('nvpiaobozhe')
  })

  test('punctuation and spaces become single hyphens; Latin text passes through', () => {
    expect(slugify('秧秧·玄翎')).toBe('yangyang-xuanling')
    expect(slugify(' 猫屋敷梨梨&春也Haruya ')).toBe('maowufulili-chunyeharuya')
    expect(slugify('珂萝卡_Croca')).toBe('keluoka-croca')
    expect(slugify('0糖红茶')).toBe('0tanghongcha')
    expect(slugify('IRIS')).toBe('iris')
    expect(slugify('Solar5')).toBe('solar5')
  })

  test('falls back to a stable hash when nothing is transliterable', () => {
    const s = slugify('★☆')
    expect(s).toMatch(/^x-[0-9a-f]{8}$/)
    expect(slugify('★☆')).toBe(s)
  })
})

describe('isHashSlug', () => {
  test('readable v1 slugs are kept', () => {
    for (const s of ['aimisi', 'jinhsi', 'changli', 'yangyang', 'baba']) expect(isHashSlug(s)).toBe(false)
  })

  test('hex ids, numeric ids and non-ASCII slugs are replaced', () => {
    for (const s of ['c7d3e9a1f2b84c56a0e1', 'character-1e2ca573335a00cc88b0a81f', 'term-9646024ba03ca7d0a6fe2d94', 'submission-term-4117b215b685eaae18280b0d', '12345', '爱秧斯坦', 'Aimisi', 'ai mi', '', null])
      expect(isHashSlug(s)).toBe(true)
  })
})

describe('claimSlug', () => {
  test('homophones get numbered suffixes, deterministically', () => {
    const taken = new Set<string>()
    expect(claimSlug(slugify('椿'), taken)).toBe('chun')
    expect(claimSlug(slugify('春'), taken)).toBe('chun-2')
    expect(claimSlug(slugify('纯'), taken)).toBe('chun-3')
  })
})
