import { describe, expect, test } from 'bun:test'
import { segLabelEm } from '#/ui/Seg'
import { chooseSide, moveIndex, typeaheadIndex } from '#/ui/Select'

const none = (n: number) => Array.from({ length: n }, () => false)

describe('Select keyboard movement', () => {
  test('arrows step one option and stop at the ends (no wrap)', () => {
    const off = none(4)
    expect(moveIndex('ArrowDown', 0, off)).toBe(1)
    expect(moveIndex('ArrowDown', 3, off)).toBe(3)
    expect(moveIndex('ArrowUp', 2, off)).toBe(1)
    expect(moveIndex('ArrowUp', 0, off)).toBe(0)
  })

  test('Home and End jump to the first and last option', () => {
    expect(moveIndex('Home', 2, none(5))).toBe(0)
    expect(moveIndex('End', 1, none(5))).toBe(4)
  })

  test('from nothing active, ArrowDown starts at the top and ArrowUp at the bottom', () => {
    expect(moveIndex('ArrowDown', -1, none(3))).toBe(0)
    expect(moveIndex('ArrowUp', -1, none(3))).toBe(2)
  })

  test('disabled options are skipped, also by Home and End', () => {
    const off = [true, false, true, false, true]
    expect(moveIndex('ArrowDown', 1, off)).toBe(3)
    expect(moveIndex('ArrowDown', 3, off)).toBe(3)
    expect(moveIndex('ArrowUp', 3, off)).toBe(1)
    expect(moveIndex('Home', 3, off)).toBe(1)
    expect(moveIndex('End', 1, off)).toBe(3)
    expect(moveIndex('Home', 0, [true, true])).toBe(-1)
  })

  test('other keys are not navigation', () => {
    expect(moveIndex('Enter', 1, none(3))).toBeNull()
    expect(moveIndex('a', 1, none(3))).toBeNull()
    expect(moveIndex('PageDown', 1, none(3))).toBeNull()
  })
})

describe('Select type-ahead', () => {
  const labels = ['全部', 'CC BY-NC-SA 4.0', 'CC BY-NC 4.0', 'CC BY 4.0', '个人非商用约定', 'gif', 'GIF 动图', '30 天']

  test('a longer query refines the current match, case-insensitively', () => {
    expect(typeaheadIndex(labels, 'c', 0)).toBe(1)
    expect(typeaheadIndex(labels, 'cc by 4', 1)).toBe(3)
    expect(typeaheadIndex(labels, 'CC BY-NC-SA', 1)).toBe(1)
    expect(typeaheadIndex(labels, 'cc by-nc ', 1)).toBe(2)
  })

  test('the same key again cycles through the labels starting with it, wrapping around', () => {
    expect(typeaheadIndex(labels, 'g', 0)).toBe(5)
    expect(typeaheadIndex(labels, 'gg', 5)).toBe(6)
    expect(typeaheadIndex(labels, 'ggg', 6)).toBe(5)
  })

  test('Chinese labels and digits match by prefix', () => {
    expect(typeaheadIndex(labels, '个', 0)).toBe(4)
    expect(typeaheadIndex(labels, '3', 0)).toBe(7)
    expect(typeaheadIndex(labels, '全', 3)).toBe(0)
  })

  test('no match, an empty query and disabled options give -1 or skip', () => {
    expect(typeaheadIndex(labels, 'zz', 0)).toBe(-1)
    expect(typeaheadIndex(labels, '', 0)).toBe(-1)
    expect(typeaheadIndex([], 'a', 0)).toBe(-1)
    const off = labels.map((_, i) => i === 5)
    expect(typeaheadIndex(labels, 'g', 0, off)).toBe(6)
  })
})

describe('Select side', () => {
  test('opens below when the list fits there', () => {
    expect(chooseSide({ below: 300, above: 500, needed: 200 })).toBe('bottom')
  })

  test('flips above when it does not fit below and there is more room above', () => {
    expect(chooseSide({ below: 120, above: 600, needed: 200 })).toBe('top')
  })

  test('stays below when it fits nowhere but below is the larger side', () => {
    expect(chooseSide({ below: 300, above: 200, needed: 360 })).toBe('bottom')
    expect(chooseSide({ below: 250, above: 250, needed: 360 })).toBe('bottom')
  })
})

describe('form Seg label width', () => {
  test('CJK characters count 1em, others about 0.62em; the widest label wins', () => {
    expect(segLabelEm([{ value: 'a', label: '画师本人' }, { value: 'b', label: '约稿人' }])).toBe(4)
    expect(segLabelEm([{ value: 'a', label: 'GIF' }])).toBe(1.9)
    expect(segLabelEm([{ value: 'a', label: '30 天' }])).toBe(2.9)
  })

  test('an icon adds its width; a non-text label is assumed 4em', () => {
    expect(segLabelEm([{ value: 'a', label: '网格', icon: 'grid' }])).toBe(3.6)
    expect(segLabelEm([{ value: 'a', label: null }])).toBe(4)
  })
})
