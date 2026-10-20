// CREDITS.txt for pack ZIPs (worker) and batch ZIPs (browser, client-zip). Pure: no env, database or
// node: imports, so the browser bundle can reuse it. Callers pass the site identity and the date.

/** License codes stored in packs.license. Unknown codes are printed as they are. */
export const LICENSE_LABELS: Record<string, string> = {
  'cc-by-nc-sa-4.0': 'CC BY-NC-SA 4.0',
  'cc-by-nc-4.0': 'CC BY-NC 4.0',
  'cc-by-sa-4.0': 'CC BY-SA 4.0',
  'cc-by-4.0': 'CC BY 4.0',
  'personal-noncommercial': '个人非商用约定',
  unknown: '未注明',
}

export function licenseLabel(code: string | null | undefined): string {
  const c = (code ?? '').trim()
  if (!c) return LICENSE_LABELS.unknown!
  return LICENSE_LABELS[c] ?? c
}

/** Best-effort mapping of free-text license metadata (v1 imports, declarations) to a license code. */
export function parseLicense(text: string | null | undefined): string {
  const t = (text ?? '').trim()
  if (!t) return 'unknown'
  if (LICENSE_LABELS[t]) return t
  const norm = t.toUpperCase().replace(/[\s_]+/g, '-')
  const cc = /CC-?BY(-NC)?(-SA)?(?:-?(\d\.\d))?/.exec(norm)
  if (cc && !/-ND/.test(norm)) {
    const code = `cc-by${cc[1] ? '-nc' : ''}${cc[2] ? '-sa' : ''}-${cc[3] ?? '4.0'}`
    if (LICENSE_LABELS[code]) return code
  }
  if (/非商用|非商业/.test(t)) return 'personal-noncommercial'
  return 'unknown'
}

export interface CreditsPack {
  title: string
  /** this site's page for the pack (the v1 source address is never printed: packs.source_url stays internal) */
  pageUrl?: string | null
  artists?: string[]
  commissioner?: string | null
  /** license code (packs.license) */
  license?: string | null
  /** free-form attribution text (packs.credits_text) */
  note?: string | null
  /** file names inside the archive that came from this pack; listed for batch ZIPs */
  files?: string[]
}

export interface CreditsInput {
  siteName: string
  siteUrl: string
  /** YYYY-MM-DD; see formatCreditsDate */
  date: string
  packs: CreditsPack[]
}

/** Calendar date in the site's time zone (Asia/Shanghai), e.g. 2026-10-20. */
export function formatCreditsDate(d: Date, timeZone = 'Asia/Shanghai'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

function packBlock(p: CreditsPack): string[] {
  const lines = [`表情包：${clean(p.title) || '（未命名）'}`]
  const artists = (p.artists ?? []).map(clean).filter(Boolean)
  lines.push(`画师：${artists.length ? artists.join('、') : '未注明'}`)
  if (clean(p.commissioner)) lines.push(`约稿：${clean(p.commissioner)}`)
  lines.push(`许可：${licenseLabel(p.license)}`)
  if (clean(p.pageUrl)) lines.push(`本站页面：${clean(p.pageUrl)}`)
  if (p.files?.length) lines.push(`文件：${p.files.join('、')}`)
  const note = (p.note ?? '').trim()
  if (note) lines.push('', ...note.split(/\r?\n/))
  return lines
}

export function buildCreditsText(input: CreditsInput): string {
  const siteName = clean(input.siteName)
  const siteUrl = clean(input.siteUrl).replace(/\/+$/, '')
  const head = `${siteName} · CREDITS`
  const out: string[] = [head, '='.repeat(Math.max(head.length * 2, 20)), '']
  input.packs.forEach((p, i) => {
    if (i > 0) out.push('', '-'.repeat(20), '')
    out.push(...packBlock(p))
  })
  out.push(
    '',
    '='.repeat(20),
    `打包自 ${siteName}（${siteUrl}） · ${input.date}`,
    '表情版权归画师与原作者所有。请按上面的许可使用并保留署名；未经授权请勿商用或再分发。',
    '',
  )
  return out.join('\n')
}
