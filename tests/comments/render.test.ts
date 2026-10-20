import { describe, expect, test } from 'bun:test'
import { analyzeBody, clearRenderCache, finalizeHtml, isAllowedHref, posterSize, renderBody, renderCached, renderCacheSize } from '#/server/comments/render'
import type { Sticker } from '#/server/comments/types'

// Comment rendering (src/server/comments/render.ts): markdown-it with html off, images off, links
// restricted and tagged, sticker markers as placeholders. No database.

const S1 = 'r-0a7bf47f0ec26d3843bf'
const S2 = 'r-11111111111111111111'
const STICKERS = new Map<string, Sticker>([
  [S1, { id: S1, poster: `/img/v1/p240/aimisi-01/${S1}.r1.webp`, width: 240, height: 160 }],
  [S2, { id: S2, poster: `/img/v1/p240/aimisi-01/${S2}.r2.webp`, width: 200, height: 200 }],
])

const html = (src: string) => finalizeHtml(renderBody(src), STICKERS)

/** Every tag in the output, by name. */
function tags(out: string): string[] {
  return [...out.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1]!.toLowerCase())
}

const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'img'])
const ATTRS = ['href', 'title', 'rel', 'target', 'class', 'src', 'width', 'height', 'alt', 'loading', 'decoding']

/** Structural XSS checks every output must pass. */
function assertSafe(out: string) {
  for (const t of tags(out)) expect(ALLOWED_TAGS.has(t)).toBe(true)
  // attribute names only from a short list (quoted values blanked first, so escaped text inside a
  // value cannot pass for an attribute)
  for (const m of out.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const names = [...m[0].replace(/"[^"]*"/g, '""').matchAll(/\s([^\s=>]+)=/g)].map((x) => x[1]!.toLowerCase())
    for (const name of names) expect(ATTRS).toContain(name)
  }
  expect(out).not.toMatch(/href="\s*(javascript|vbscript|data|file):/i)
  expect(out).not.toMatch(/src="\s*(javascript|data):/i)
  // the only <img> tags are stickers pointing at /img/v1/p240/
  for (const m of out.matchAll(/<img [^>]*>/g)) {
    expect(m[0]).toMatch(/^<img class="cmt-stk( is-inline)?" src="\/img\/v1\/p240\/[a-z0-9-]+\/r-[0-9a-f]{20}\.r\d+\.webp" width="\d+" height="\d+" alt="" loading="lazy" decoding="async">$/)
  }
  // placeholders never leak
  expect(out).not.toContain('<!--')
}

describe('raw HTML is escaped', () => {
  test.each([
    ['<script>alert(1)</script>'],
    ['<img src=x onerror=alert(1)>'],
    ['<a href="javascript:alert(1)">x</a>'],
    ['<iframe src="https://evil.example"></iframe>'],
    ['<svg onload=alert(1)>'],
    ['<style>body{display:none}</style>'],
    ['<!--stk:r-0a7bf47f0ec26d3843bf:b-->'],
    ['<div\nonclick="alert(1)">multi-line</div>'],
  ])('%p', (src) => {
    const out = html(src)
    assertSafe(out)
    expect(out).toContain('&lt;')
    expect(out).not.toContain('<img')
  })

  test('a forged placeholder in the text is escaped, not turned into a sticker', () => {
    const out = html('<!--stk:r-0a7bf47f0ec26d3843bf:b--> and &lt;!--stk:r-0a7bf47f0ec26d3843bf:b--&gt;')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;!--stk:')
  })
})

describe('links', () => {
  test('http(s) links get rel="nofollow ugc noopener" and target="_blank"', () => {
    const out = html('[文档](https://example.com/a?b=1) and https://auto.example/x and <https://angle.example>')
    assertSafe(out)
    const anchors = [...out.matchAll(/<a [^>]*>/g)].map((m) => m[0])
    expect(anchors.length).toBe(3)
    for (const a of anchors) {
      expect(a).toContain('rel="nofollow ugc noopener"')
      expect(a).toContain('target="_blank"')
    }
  })

  test.each([
    ['[x](javascript:alert(1))'],
    ['[x](JaVaScRiPt:alert(1))'],
    ['[x](  javascript:alert(1))'],
    ['[x](&#106;avascript:alert(1))'],
    ['[x](&#x6A;avascript:alert(1))'],
    ['[x](<javascript:alert(1)>)'],
    ['<javascript:alert(1)>'],
    ['[x](vbscript:msgbox(1))'],
    ['[x](file:///etc/passwd)'],
    ['[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'],
    ['[x](data:image/png;base64,iVBORw0KGgo=)'],
    ['[x](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)'],
    ['[x](tel:123456)'],
  ])('rejected destination %p renders without a link', (src) => {
    const out = html(src)
    assertSafe(out)
    expect(out).not.toContain('<a ')
    expect(analyzeBody(src).links).toBe(0)
  })

  test('a backslash breaks the scheme: the link becomes a harmless relative URL', () => {
    const out = html('[x](java\\script:alert(1))')
    assertSafe(out)
    expect(out).toContain('href="java%5Cscript:alert(1)"')
  })

  test('scheme-less and site-relative links stay links', () => {
    expect(isAllowedHref('/packs/aimisi-01')).toBe(true)
    expect(isAllowedHref('https://example.com')).toBe(true)
    expect(isAllowedHref('mailto:a@example.com')).toBe(true)
    expect(isAllowedHref('data:image/png;base64,AAA')).toBe(false)
    expect(isAllowedHref('javascript:alert(1)')).toBe(false)
  })

  test('a title cannot break out of its attribute', () => {
    const out = html('[t](https://x.example "a\\" onmouseover=\\"alert(1)")')
    assertSafe(out)
    expect(out).toContain('title="a&quot; onmouseover=&quot;alert(1)"')
  })

  test('an href cannot break out of its attribute', () => {
    const out = html('[t](https://x.example/"onmouseover="alert(1))')
    assertSafe(out)
    expect(out).not.toMatch(/"\s*onmouseover=/)
  })

  test('link counting includes bare domains and emails (for moderation)', () => {
    expect(analyzeBody('看这里 https://a.example').links).toBe(1)
    expect(analyzeBody('https://a.example 和 www.b-example.com').links).toBe(2)
    expect(analyzeBody('联系 spam@example.com 或 [这里](https://c.example)').links).toBe(2)
    expect(analyzeBody('[x](javascript:alert(1)) 没有链接').links).toBe(0)
  })
})

describe('images and other disabled syntax', () => {
  test('markdown image syntax never produces an <img>', () => {
    for (const src of ['![x](https://evil.example/a.png)', '![x](javascript:alert(1))', '![x](data:image/png;base64,AAA)', '![](/img/v1/p240/a/b.webp)']) {
      const out = html(src)
      assertSafe(out)
      expect(out).not.toContain('<img')
    }
  })

  test('headings, tables, rules and raw HTML blocks render as text', () => {
    const out = html('# 标题\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<div>x</div>')
    assertSafe(out)
    expect(tags(out)).not.toContain('h1')
    expect(tags(out)).not.toContain('table')
    expect(tags(out)).not.toContain('hr')
  })

  test('the supported subset renders', () => {
    const out = html('**粗** *斜* ~~删~~ `码`\n\n> 引用\n\n- 一\n- 二\n\n```\nfenced <b>\n```')
    assertSafe(out)
    for (const t of ['strong', 'em', 's', 'code', 'blockquote', 'ul', 'li', 'pre']) expect(tags(out)).toContain(t)
    expect(out).toContain('fenced &lt;b&gt;')
  })

  test('typographer is off', () => {
    expect(html('"quotes" -- (c)')).toContain('&quot;quotes&quot; -- (c)')
  })
})

describe('sticker markers', () => {
  test('a marker alone on a line renders a big p240 <img> with width/height and empty alt', () => {
    const out = html(`:s[${S1}]`)
    assertSafe(out)
    expect(out).toBe(`<p><img class="cmt-stk" src="/img/v1/p240/aimisi-01/${S1}.r1.webp" width="240" height="160" alt="" loading="lazy" decoding="async"></p>\n`)
  })

  test('a marker inside text renders inline', () => {
    const out = html(`好耶 :s[${S2}] 好耶`)
    assertSafe(out)
    expect(out).toContain('class="cmt-stk is-inline"')
  })

  test('nested markers: only the inner well-formed marker becomes a sticker', () => {
    const src = `:s[:s[${S1}]]`
    const out = html(src)
    assertSafe(out)
    expect(out.match(/<img /g)?.length).toBe(1)
    expect(analyzeBody(src).stickers).toEqual([S1])
  })

  test('markers in code are literal and not counted', () => {
    const src = `\`:s[${S1}]\`\n\n\`\`\`\n:s[${S2}]\n\`\`\``
    const out = html(src)
    assertSafe(out)
    expect(out).not.toContain('<img')
    expect(analyzeBody(src).stickers).toEqual([])
  })

  test('a marker cannot be turned into a link destination or label trick', () => {
    const src = `:s[${S1}](javascript:alert(1)) [:s[${S1}]](https://ok.example)`
    const out = html(src)
    assertSafe(out)
    expect(out).not.toContain('javascript:alert(1)"')
  })

  test('malformed markers are reported and render as text', () => {
    const a = analyzeBody(':s[r-123] :s[R-0A7BF47F0EC26D3843BF] :s[<script>] :s[]')
    expect(a.stickers).toEqual([])
    expect(a.badMarkers).toEqual([':s[r-123]', ':s[R-0A7BF47F0EC26D3843BF]', ':s[<script>]', ':s[]'])
    const out = html(':s[<img src=x onerror=alert(1)>]')
    assertSafe(out)
    expect(out).toContain(':s[&lt;img')
  })

  test('a quote inside a marker cannot inject attributes', () => {
    const out = html(':s[r-0a7bf47f0ec26d3843bf" onerror="alert(1)]')
    assertSafe(out)
    expect(out).not.toContain('<img')
  })

  test('repeats are counted; sticker_ids keeps distinct ids in order', () => {
    const a = analyzeBody(`:s[${S2}] :s[${S1}] :s[${S2}]`)
    expect(a.stickers).toEqual([S2, S1, S2])
    expect(a.stickerIds).toEqual([S2, S1])
    expect(a.text).toBe('[贴纸] [贴纸] [贴纸]')
  })

  test('a sticker that is no longer available is dropped at finalize time', () => {
    const out = finalizeHtml(renderBody(`看 :s[${S1}] 和 :s[r-99999999999999999999]`), new Map([[S1, STICKERS.get(S1)!]]))
    expect(out.match(/<img /g)?.length).toBe(1)
    expect(out).not.toContain('r-99999999999999999999')
    assertSafe(out)
  })

  test('poster size: longest edge 240, never upscaled', () => {
    expect(posterSize(300, 300)).toEqual({ width: 240, height: 240 })
    expect(posterSize(500, 250)).toEqual({ width: 240, height: 120 })
    expect(posterSize(180, 120)).toEqual({ width: 180, height: 120 })
  })
})

describe('render cache', () => {
  test('keyed by (comment id, edited_at)', () => {
    clearRenderCache()
    const a = renderCached(1, null, 'first')
    expect(renderCached(1, null, 'changed source, same key')).toBe(a)
    const edited = new Date('2026-10-20T10:00:00Z')
    expect(renderCached(1, edited, 'after edit')).toContain('after edit')
    expect(renderCached(2, null, 'other')).toContain('other')
    expect(renderCacheSize()).toBe(3)
  })
})
