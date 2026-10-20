// Build the self-hosted web fonts into public/fonts/ (outputs are committed; rerun only to change them).
//
//   bun scripts/fonts/build.ts [outDir]
//
// With outDir, only TP Rounded is written, there instead of public/fonts/tp-rounded (to price another
// shard plan with tests/pages/font-cost.ts --css <outDir> before committing it).
//
// TP Rounded = 寒蝉圆黑体 ChillRoundGothic v3.750 Bold + Heavy (OFL-1.1), renamed because the upstream
// copyright declares the Reserved Font Names 'Source' and 'ChillRounded'. Steps:
//   1. download the release zip and the cn-font-split native core into .work/fonts (sha256-pinned);
//   2. python venv with pinned fontTools / brotli / uharfbuzz (.work/fonts/venv);
//   3. charset.py: GB2312 + ASCII + common punctuation + kana + extra-chars.txt and the vocabularies;
//   4. prep.py: subset, keep only the layout features browsers apply to horizontal text, rename to
//      TP Rounded;
//   5. cn-font-split: unicode-range woff2 shards + @font-face CSS per weight, merged into tp-rounded.css.
//      Display text is sparse (titles, names, headings), so which characters share a shard decides what a
//      page downloads. The leading shards follow the vocabularies (tiers below); the remaining characters
//      are split automatically;
//   6. verify.py: no locl/aalt, 户/令/digits shape to their nominal (Chinese) glyphs, no upstream names.
// Nunito (latin + latin-ext, variable weight axis) is copied from @fontsource-variable/nunito.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib, { brotliCompressSync, gzipSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const here = join(root, 'scripts', 'fonts')
const work = join(root, '.work', 'fonts')
const customOut = process.argv[2] ? resolve(process.argv[2]) : null
const outDir = customOut ?? join(root, 'public', 'fonts', 'tp-rounded')
const nunitoDir = join(root, 'public', 'fonts', 'nunito')

const UPSTREAM = {
  url: 'https://github.com/Warren2060/ChillRoundGothic/releases/download/v3.750/ChillRoundGothic.v3.75.zip',
  sha256: '41a19d998d59948e5045278bec224b0e541b88ab4a054beb5b3ba5fe1b639917',
  file: 'ChillRoundGothic.v3.75.zip',
}
// cn-font-split 7.4.3 (JS) installs the newest native core by default; pin the one it shipped with.
const CORE = {
  url: 'https://github.com/KonghaYao/cn-font-split/releases/download/7.6.8/libffi-x86_64-unknown-linux-gnu.so',
  sha256: 'db4690e3b9c4b04f6dfa5965792585c389914038f6a4c90fbe73baaf16bbf19c',
  file: 'libffi-x86_64-unknown-linux-gnu-7.6.8.so',
}
const PY_DEPS = ['fonttools==4.67.0', 'brotli==1.2.0', 'uharfbuzz==0.56.3']
// Bold also answers font-weight 800 (h2/h3 in the design system); Heavy is 900.
const WEIGHTS = [
  { src: 'ChillRoundGothic_Bold.otf', style: 'Bold', cssWeight: '600 850' },
  { src: 'ChillRoundGothic_Heavy.otf', style: 'Heavy', cssWeight: '900' },
] as const

// Leading shards, in this order (a character goes to the first tier that lists it):
//   1. site-chars.txt line 1: the site's own display copy on home, /packs, a pack page, /characters and
//      a sticker page (logo, hero, ribbons, page titles, footer headings), and the space, one shard;
//   2. printable ASCII, one group: Latin letters and digits inside titles (Ver.、Q版、Solar5); cn-font-split
//      adds the Greek, Cyrillic and accented Latin letters to that shard;
//   3. catalog-title-chars.txt, every character of the catalog's titles and names, most frequent first
//      (hot-chars.txt order, then the file's): in TITLE_GROUPS large groups for Bold, which sets the pack
//      card titles (a page of cards needs most of them, and from then on every page finds them cached),
//      and in groups of HEAVY_TITLE_GROUP for Heavy, which sets only a page's h1 (one title or name);
//   4. the rest of site-chars.txt (the other public pages), then hot-chars.txt (the prototype's
//      vocabulary, most frequent first), in groups of HOT_GROUP;
//   5. everything else, auto-split by cn-font-split at about CHUNK_SIZE.
// Both weights list the same characters per tier; only tier 3 is cut differently, so the CSS stays
// almost one list twice. Measured with tests/pages/font-cost.ts against production titles, first visit
// to home, /packs, a pack page and /characters: hot-chars.txt alone in 20–40 character groups ≈ 690 KB in
// 103 shards (a page's title characters land in that many small shards); this plan ≈ 307 KB in 18.
const TITLE_GROUPS = 4
const HEAVY_TITLE_GROUP = 20
const HOT_GROUP = 40
const CHUNK_SIZE = 32 * 1024

function run(cmd: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  const p = Bun.spawnSync(cmd, { cwd: opts.cwd ?? root, env: { ...process.env, ...opts.env }, stdout: 'inherit', stderr: 'inherit' })
  if (p.exitCode !== 0) throw new Error(`command failed (${p.exitCode}): ${cmd.join(' ')}`)
}

function sha256(path: string) {
  return new Bun.CryptoHasher('sha256').update(readFileSync(path)).digest('hex')
}

async function fetchPinned(spec: { url: string; sha256: string; file: string }, dir: string) {
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, spec.file)
  if (!existsSync(dest) || sha256(dest) !== spec.sha256) {
    console.log(`download ${spec.url}`)
    const res = await fetch(spec.url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`download failed: ${res.status} ${spec.url}`)
    writeFileSync(dest, new Uint8Array(await res.arrayBuffer()))
  }
  const got = sha256(dest)
  if (got !== spec.sha256) throw new Error(`sha256 mismatch for ${spec.file}: ${got}`)
  return dest
}

function python() {
  const venv = join(work, 'venv')
  const py = join(venv, 'bin', 'python')
  const stamp = join(venv, '.deps')
  if (!existsSync(py)) run(['python3', '-m', 'venv', venv])
  if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== PY_DEPS.join('\n')) {
    run([py, '-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', ...PY_DEPS])
    writeFileSync(stamp, PY_DEPS.join('\n'))
  }
  // -I: isolated mode, so nothing next to the downloaded fonts can shadow a module.
  return (script: string, ...args: string[]) => run([py, '-I', join(here, script), ...args])
}

function fileList(dir: string, ext: string) {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)) : []
}

/** Code points of each line of a vocabulary file, in order; lines starting with # and whitespace ignored. */
function vocabularyLines(file: string): number[][] {
  return readFileSync(join(here, file), 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .map((line) => [...line].filter((c) => !/\s/.test(c)).map((c) => c.codePointAt(0)!))
    .filter((cps) => cps.length)
}

/** All code points of a vocabulary file in order, each once. */
function vocabulary(file: string): number[] {
  return [...new Set(vocabularyLines(file).flat())]
}

function chunk(list: number[], sizes: number | readonly number[]): number[][] {
  const out: number[][] = []
  for (let i = 0, k = 0; i < list.length; k++) {
    const n = typeof sizes === 'number' ? sizes : (sizes[k] ?? sizes[sizes.length - 1]!)
    out.push(list.slice(i, i + n))
    i += n
  }
  return out
}

/** The leading groups (tiers 1–4 above), over the characters the font has. */
function leadingGroups(inCharset: Set<number>, style: string): number[][] {
  const placed = new Set<number>()
  const take = (cps: number[]) => {
    const fresh = [...new Set(cps)].filter((c) => inCharset.has(c) && !placed.has(c))
    for (const c of fresh) placed.add(c)
    return fresh
  }
  const [mainPages = [], ...otherPages] = vocabularyLines('site-chars.txt')
  const hot = vocabulary('hot-chars.txt')
  const catalog = new Set(vocabulary('catalog-title-chars.txt'))
  // U+0020 too: the face holding the space is the element's "first available font" (its line metrics),
  // which Chrome may fetch before any text needs it; in the shard every page loads anyway it costs nothing
  const site = take([0x20, ...mainPages])
  const ascii = take(Array.from({ length: 0x7f - 0x20 }, (_, i) => 0x20 + i))
  const titles = take([...hot.filter((c) => catalog.has(c)), ...catalog])
  const rest = take([...otherPages.flat(), ...hot])
  const titleSize = style === 'Heavy' ? HEAVY_TITLE_GROUP : Math.ceil(titles.length / TITLE_GROUPS)
  return [site, ascii, ...chunk(titles, titleSize), ...chunk(rest, HOT_GROUP)].filter((g) => g.length)
}

async function splitWeight(input: string, dest: string, cssWeight: string, subsets: number[][], autoSubset: boolean) {
  const { fontSplit } = await import('cn-font-split')
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  await fontSplit({
    input: new Uint8Array(readFileSync(input)),
    outDir: dest,
    css: { fontFamily: 'TP Rounded', fontWeight: cssWeight, fontStyle: 'normal', fontDisplay: 'swap', localFamily: [], compress: true },
    chunkSize: CHUNK_SIZE,
    subsets,
    autoSubset,
    // with explicit groups only: keep them exactly as given (no extra split by script or merge of small ones)
    ...(autoSubset ? {} : { languageAreas: false, reduceMins: false }),
    testHtml: false,
    reporter: false,
    renameOutputFont: '[hash:10].[ext]',
    silent: true,
  })
}

/** Rules of a cn-font-split result.css, in order: shard file + unicode-range. */
function parseRules(css: string) {
  const rules: { file: string; range: string }[] = []
  for (const m of css.matchAll(/@font-face\{[^}]*?url\("\.\/([^"]+)"\)[^}]*?unicode-range:([^;}]+)/g)) rules.push({ file: m[1]!, range: m[2]! })
  return rules
}

function expandRange(range: string) {
  const cps: number[] = []
  for (const part of range.split(',')) {
    const [a, b] = part.trim().replace(/^U\+/i, '').split('-')
    const from = parseInt(a!, 16)
    const to = b ? parseInt(b, 16) : from
    for (let c = from; c <= to; c++) cps.push(c)
  }
  return cps
}

/**
 * cn-font-split re-splits explicit groups when it auto-splits the rest, so the first weight is split
 * twice: once with autoSubset to learn the automatic groups of the characters no vocabulary lists, then
 * with the leading groups plus those as explicit groups only. Returns the groups the output really has.
 */
async function splitFirstWeight(input: string, dest: string, cssWeight: string, leading: number[][]) {
  await splitWeight(input, `${dest}.probe`, cssWeight, leading, true)
  const probe = parseRules(readFileSync(join(`${dest}.probe`, 'result.css'), 'utf8')).map((r) => expandRange(r.range))
  rmSync(`${dest}.probe`, { recursive: true, force: true })
  // what the font really maps (a charset entry without a glyph is not shipped)
  const available = new Set(probe.flat())
  const lead = leading.map((g) => g.filter((c) => available.has(c))).filter((g) => g.length)
  const placed = new Set(lead.flat())
  const auto = probe.map((g) => g.filter((c) => !placed.has(c))).filter((g) => g.length)
  const groups = [...lead, ...auto]
  await splitWeight(input, dest, cssWeight, groups, false)
  // it still moves a few characters between groups (those an OpenType feature ties to others, e.g. digits
  // and punctuation, end up in one shard); what it wrote is what the other weight reuses
  const got = parseRules(readFileSync(join(dest, 'result.css'), 'utf8')).map((r) => expandRange(r.range))
  const shipped = new Set(got.flat())
  const lost = groups.flat().filter((c) => !shipped.has(c))
  if (lost.length) throw new Error(`cn-font-split dropped ${lost.length} code points, e.g. U+${lost[0]!.toString(16)}`)
  return got
}

/** Another weight's groups: its own leading groups, then the first weight's groups without those characters. */
function regroup(first: number[][], leading: number[][]): number[][] {
  const shipped = new Set(first.flat())
  const lead = leading.map((g) => g.filter((c) => shipped.has(c))).filter((g) => g.length)
  const placed = new Set(lead.flat())
  return [...lead, ...first.map((g) => g.filter((c) => !placed.has(c))).filter((g) => g.length)]
}

function cleanCss(css: string, cssWeight: string) {
  return (
    css
      // the generator's banner holds a timestamp and a dump of the name table
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // no local() lookups: nobody has "TP Rounded" installed, and it costs a font-matching pass per rule
      .replace(/local\("[^"]*"\),?/g, '')
      // cn-font-split takes the weight verbatim; normalise in case it rewrote it
      .replace(/font-weight:\s*[^;}]+/g, `font-weight:${cssWeight}`)
      .trim()
  )
}

function mergeCss(parts: { dir: string; cssWeight: string }[]) {
  const header =
    '/* TP Rounded: a modified, renamed subset of 寒蝉圆黑体 ChillRoundGothic v3.750 (SIL OFL 1.1, see OFL.txt).\n' +
    '   Generated by scripts/fonts/build.ts. Do not edit by hand. */\n'
  return header + parts.map(({ dir, cssWeight }) => cleanCss(readFileSync(join(dir, 'result.css'), 'utf8'), cssWeight)).join('\n') + '\n'
}

function writeLicense(upstreamLicense: string) {
  const notice =
    'TP Rounded\n' +
    '==========\n\n' +
    'TP Rounded is a Modified Version of 寒蝉圆黑体 ChillRoundGothic v3.750\n' +
    '(https://github.com/Warren2060/ChillRoundGothic), Bold and Heavy weights.\n\n' +
    'Copyright statements carried by the original fonts:\n' +
    "  © 2014-2021 Adobe, with Reserved Font Name 'Source'.\n" +
    "  © 2023 ChillType, with Reserved Font Name 'ChillRounded'.\n\n" +
    'Changes: subset to GB2312, ASCII, common punctuation and kana; the locl and aalt OpenType\n' +
    'features removed; hinting removed; renamed to "TP Rounded" so that no Reserved Font Name is\n' +
    'used; split into unicode-range WOFF2 files. The result remains under the SIL Open Font\n' +
    'License 1.1, reproduced below.\n\n' +
    '----------------------------------------------------------------------------------------\n\n'
  writeFileSync(join(outDir, 'OFL.txt'), notice + upstreamLicense.replace(/\r\n/g, '\n'))
}

function copyNunito() {
  const pkg = join(root, 'node_modules', '@fontsource-variable', 'nunito')
  mkdirSync(nunitoDir, { recursive: true })
  for (const f of ['nunito-latin-wght-normal.woff2', 'nunito-latin-ext-wght-normal.woff2']) cpSync(join(pkg, 'files', f), join(nunitoDir, f))
  cpSync(join(pkg, 'LICENSE'), join(nunitoDir, 'OFL.txt'))
}

function kb(n: number) {
  return `${(n / 1024).toFixed(1)} KB`
}

async function main() {
  const zip = await fetchPinned(UPSTREAM, join(work, 'download'))
  const core = await fetchPinned(CORE, join(work, 'lib'))
  process.env.CN_FONT_SPLIT_BIN = core

  const src = join(work, 'src')
  rmSync(src, { recursive: true, force: true })
  run(['unzip', '-q', '-o', '-j', zip, ...WEIGHTS.map((w) => `ChillRoundGothic/${w.src}`), 'ChillRoundGothic/License.txt', '-d', src])

  const py = python()
  const charset = join(work, 'charset.txt')
  py('charset.py', charset, ...['extra-chars.txt', 'site-chars.txt', 'catalog-title-chars.txt', 'hot-chars.txt'].map((f) => join(here, f)))

  const prepDir = join(work, 'prep')
  mkdirSync(prepDir, { recursive: true })
  const parts: { dir: string; cssWeight: string }[] = []
  // The first weight settles the groups (its leading groups plus cn-font-split's split of the rest); the
  // other weight takes its own leading groups and the same split of the rest, so most of the two
  // unicode-range lists is identical (brotli folds the second copy into back-references).
  const inCharset = new Set([...readFileSync(charset, 'utf8')].map((c) => c.codePointAt(0)!))
  let groups: number[][] | undefined
  for (const w of WEIGHTS) {
    const prepped = join(prepDir, `TPRounded-${w.style}.otf`)
    py('prep.py', join(src, w.src), prepped, charset, w.style)
    const dir = join(work, 'split', w.style)
    const leading = leadingGroups(inCharset, w.style)
    if (groups) await splitWeight(prepped, dir, w.cssWeight, regroup(groups, leading), false)
    else groups = await splitFirstWeight(prepped, dir, w.cssWeight, leading)
    parts.push({ dir, cssWeight: w.cssWeight })
  }

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  let shards = 0
  let bytes = 0
  const perWeight: string[] = []
  for (const [i, part] of parts.entries()) {
    const files = fileList(part.dir, '.woff2')
    const size = files.reduce((s, f) => s + statSync(join(part.dir, f)).size, 0)
    for (const f of files) cpSync(join(part.dir, f), join(outDir, f))
    shards += files.length
    bytes += size
    perWeight.push(`${WEIGHTS[i]!.style}: ${files.length} shards, ${kb(size)}`)
  }
  // every code point in exactly one shard per weight (an overlap would load the shard defined last)
  for (const part of parts) {
    const cps = parseRules(readFileSync(join(part.dir, 'result.css'), 'utf8')).flatMap((r) => expandRange(r.range))
    if (new Set(cps).size !== cps.length) throw new Error(`overlapping unicode-range in ${part.dir}`)
  }
  const css = mergeCss(parts)
  writeFileSync(join(outDir, 'tp-rounded.css'), css)
  writeLicense(readFileSync(join(src, 'License.txt'), 'utf8'))
  if (!customOut) copyNunito()

  py('verify.py', outDir)

  console.log(`tp-rounded: ${shards} shards, ${kb(bytes)} woff2 (${perWeight.join('; ')}) -> ${outDir}`)
  const br = brotliCompressSync(css, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length
  console.log(`tp-rounded.css: ${kb(Buffer.byteLength(css))} raw, ${kb(gzipSync(css, { level: 9 }).length)} gzip, ${kb(br)} brotli`)
}

await main()
