import { describe, expect, test } from 'bun:test'
import { buildCreditsText, formatCreditsDate, licenseLabel, parseLicense } from '../../src/server/media/credits'

describe('CREDITS.txt', () => {
  test('one pack: title, artists, commissioner, license, source, site and date', () => {
    const text = buildCreditsText({
      siteName: '潮池',
      siteUrl: 'https://chaochi.example/',
      date: '2026-10-20',
      packs: [
        {
          title: '  爱弥斯动态表情包（板牌） ',
          pageUrl: 'https://chaochi.example/packs/aimisi-01',
          sourceUrl: 'https://emoji.wuwa.games/archives/aimisi-01',
          artists: ['猫屋敷梨梨&春也Haruya', ' 雾雪 '],
          commissioner: '爱弥一生一世',
          license: 'cc-by-nc-sa-4.0',
          note: '感谢群友约稿\n转载请注明出处',
        },
      ],
    })
    expect(text).toContain('潮池 · CREDITS')
    expect(text).toContain('表情包：爱弥斯动态表情包（板牌）\n')
    expect(text).toContain('画师：猫屋敷梨梨&春也Haruya、雾雪')
    expect(text).toContain('约稿：爱弥一生一世')
    expect(text).toContain('许可：CC BY-NC-SA 4.0')
    expect(text).toContain('来源：https://emoji.wuwa.games/archives/aimisi-01')
    expect(text).toContain('本站页面：https://chaochi.example/packs/aimisi-01')
    expect(text).toContain('感谢群友约稿\n转载请注明出处')
    expect(text).toContain('打包自 潮池（https://chaochi.example） · 2026-10-20')
    expect(text.endsWith('\n')).toBe(true)
  })

  test('batch ZIPs list several packs and their files; missing data is spelled out', () => {
    const text = buildCreditsText({
      siteName: '潮池',
      siteUrl: 'https://chaochi.example',
      date: '2026-10-20',
      packs: [
        { title: 'A', artists: [], license: null, files: ['a-01.gif', 'a-02.png'] },
        { title: 'B', artists: ['x'], license: 'something-custom' },
      ],
    })
    expect(text).toContain('表情包：A\n画师：未注明\n许可：未注明\n文件：a-01.gif、a-02.png')
    expect(text).toContain('表情包：B\n画师：x\n许可：something-custom')
    expect(text).not.toContain('约稿')
  })

  test('license codes and free text', () => {
    expect(licenseLabel('cc-by-nc-sa-4.0')).toBe('CC BY-NC-SA 4.0')
    expect(licenseLabel(undefined)).toBe('未注明')
    expect(parseLicense('CC BY-NC-SA 4.0')).toBe('cc-by-nc-sa-4.0')
    expect(parseLicense('cc by-nc')).toBe('cc-by-nc-4.0')
    expect(parseLicense('CC BY-ND 4.0')).toBe('unknown')
    expect(parseLicense('个人非商用约定')).toBe('personal-noncommercial')
    expect(parseLicense(null)).toBe('unknown')
  })

  test('dates are calendar days in Asia/Shanghai', () => {
    expect(formatCreditsDate(new Date('2026-10-19T16:30:00Z'))).toBe('2026-10-20')
    expect(formatCreditsDate(new Date('2026-10-19T15:30:00Z'))).toBe('2026-10-19')
  })
})
