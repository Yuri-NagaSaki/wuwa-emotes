import { describe, expect, test } from 'bun:test'
import { swatch } from '#/ui/admin-pages/swatch'
import { fmtB, fmtN, fmtW } from '#/ui/format'
import { announcementGateScript, announcementId } from '#/ui/shell/announcement'
import { createToastStore } from '#/ui/toast-store'

describe('formats', () => {
  test('numbers, 万 and bytes', () => {
    expect(fmtN(15272)).toBe('15,272')
    expect(fmtW(9999)).toBe('9,999')
    expect(fmtW(18_600)).toBe('1.9 万')
    expect(fmtW(30_000)).toBe('3 万')
    expect(fmtW(1_860_771)).toBe('186 万')
    expect(fmtB(512 * 1024)).toBe('512 KB')
    expect(fmtB(2.5 * 1_048_576)).toBe('2.5 MB')
    expect(fmtB(15_028_946_607)).toBe('14.0 GiB')
  })
})

describe('announcement id', () => {
  test('stable per text, different for a new text', () => {
    expect(announcementId('新上架：全角色琵琶曲')).toBe(announcementId('新上架：全角色琵琶曲'))
    expect(announcementId('新上架：全角色琵琶曲')).not.toBe(announcementId('新上架：全角色琵琶曲 v2'))
    expect(announcementId('x')).toMatch(/^[0-9a-z]+$/)
  })

  test('gate script embeds only the key and the id', () => {
    const s = announcementGateScript(announcementId('</script><b>'))
    expect(s).not.toContain('</script>')
    expect(s).toContain('"tp-ann"')
  })
})

describe('toast store', () => {
  test('queues, caps at three, and dismisses after the duration', () => {
    const timers: [() => void, number][] = []
    const store = createToastStore({ set: (fn, ms) => timers.push([fn, ms]) })
    let notified = 0
    store.subscribe(() => notified++)
    store.show('一')
    store.show({ message: '二', icon: 'box', duration: 1000 })
    store.show('三')
    store.show('四')
    expect(store.getSnapshot().map((t) => t.message)).toEqual(['二', '三', '四'])
    expect(store.getSnapshot()[0]!.icon).toBe('box')
    expect(timers.map(([, ms]) => ms)).toEqual([2500, 1000, 2500, 2500])
    timers[1]![0]()
    expect(store.getSnapshot().map((t) => t.message)).toEqual(['三', '四'])
    expect(notified).toBe(5)
  })
})

describe('admin swatch', () => {
  test('palette names resolve through the --c-* tokens; saved tokens and hex colours pass through', () => {
    expect(swatch('pink')).toBe('var(--c-pink, pink)')
    expect(swatch(' yg ')).toBe('var(--c-yg, yg)')
    expect(swatch('var(--c-teal)')).toBe('var(--c-teal)')
    expect(swatch('#19c8b9')).toBe('#19c8b9')
  })
})
