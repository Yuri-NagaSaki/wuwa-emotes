import sharp from 'sharp'

// A character's theme colour from its art, snapped to the design palette (--c-* in tokens.css), so it
// stays on brand and legible. Stored as the palette name in characters.theme_color.
//
// Pixels are compared in OKLab. Background (transparent, near white), near black and grey pixels are
// skipped, and so are light skin tones, which every portrait has; each remaining pixel votes for its
// nearest palette colour weighted by chroma squared, so vivid hair, eyes and clothing decide over
// pale shading. When too
// few pixels are colourful (a character in black and white), the average of the mid tones decides.

export const PALETTE = {
  pink: '#f8a6b2',
  purple: '#b77dee',
  blue: '#889df0',
  yellow: '#f7cd67',
  orange: '#e59266',
  mint: '#82d5bb',
  green: '#8ac68a',
  red: '#fc736d',
  lime: '#d1da49',
  yg: '#ecdf52',
  brown: '#9a835a',
  peach: '#e18c6f',
  teal: '#19c8b9',
} as const

export type PaletteName = keyof typeof PALETTE

export interface PaletteColor {
  name: PaletteName
  /** share of the colourful weight behind the pick (0–1); 0 when the mid-tone fallback decided */
  confidence: number
  /** colourful pixels / opaque pixels considered */
  colourful: number
}

type Lab = [number, number, number]

function linear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** sRGB 0–255 → OKLab. */
export function oklab(r: number, g: number, b: number): Lab {
  const lr = linear(r)
  const lg = linear(g)
  const lb = linear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function hexLab(hex: string): Lab {
  const n = Number.parseInt(hex.slice(1), 16)
  return oklab((n >> 16) & 255, (n >> 8) & 255, n & 255)
}

const hueOf = (a: number, b: number) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
const PALETTE_LAB = (Object.entries(PALETTE) as [PaletteName, string][]).map(([name, hex]) => {
  const lab = hexLab(hex)
  return { name, lab, hue: hueOf(lab[1], lab[2]) }
})
/** brown is the one muted palette colour: it is never a vote, only the fallback for colourless art */
const CHROMATIC = PALETTE_LAB.filter((p) => p.name !== 'brown')

/** Nearest palette colour in OKLab (lightness counts half); used for the mid-tone fallback. */
export function nearestPalette([L, a, b]: Lab): PaletteName {
  let best: PaletteName = 'brown'
  let bestD = Infinity
  for (const p of PALETTE_LAB) {
    const d = ((L - p.lab[0]) * 0.5) ** 2 + (a - p.lab[1]) ** 2 + (b - p.lab[2]) ** 2
    if (d < bestD) {
      bestD = d
      best = p.name
    }
  }
  return best
}

/** Palette colour of a saturated pixel: nearest hue, lightness breaking near ties (pink vs red). */
export function nearestHue(L: number, hue: number): PaletteName {
  let best: PaletteName = 'pink'
  let bestD = Infinity
  for (const p of CHROMATIC) {
    const dh = Math.abs(hue - p.hue)
    const d = Math.min(dh, 360 - dh) / 180 + 0.25 * Math.abs(L - p.lab[0])
    if (d < bestD) {
      bestD = d
      best = p.name
    }
  }
  return best
}

const MIN_COLOURFUL = 0.03

/** Palette colour of raw RGBA pixels, or null when there is nothing opaque to look at. */
export function paletteColorOfPixels(data: Uint8Array, channels: number): PaletteColor | null {
  const votes = new Map<PaletteName, number>()
  let opaque = 0
  let colourful = 0
  let total = 0
  const mid: Lab = [0, 0, 0]
  let midN = 0
  for (let i = 0; i + channels - 1 < data.length; i += channels) {
    if (channels === 4 && data[i + 3]! < 200) continue
    const lab = oklab(data[i]!, data[i + 1]!, data[i + 2]!)
    const [L, a, b] = lab
    if (L > 0.94) continue // white background
    opaque++
    if (L > 0.25 && L < 0.85) {
      mid[0] += L
      mid[1] += a
      mid[2] += b
      midN++
    }
    const C = Math.hypot(a, b)
    if (L < 0.28 || C < 0.05) continue // black lines, dark cloth, greys and silver hair
    const h = hueOf(a, b)
    if (L > 0.45 && C < 0.12 && h > 25 && h < 90) continue // skin, lit or shaded
    colourful++
    const name = nearestHue(L, h)
    const w = C * C
    votes.set(name, (votes.get(name) ?? 0) + w)
    total += w
  }
  if (!opaque) return null
  const share = colourful / opaque
  if (share >= MIN_COLOURFUL && total > 0) {
    const [name, w] = [...votes.entries()].sort((x, y) => y[1] - x[1])[0]!
    return { name, confidence: w / total, colourful: share }
  }
  if (!midN) return null
  return { name: nearestPalette([mid[0] / midN, mid[1] / midN, mid[2] / midN]), confidence: 0, colourful: share }
}

/** Palette colour of an image (any format sharp reads; the first frame of an animation). */
export async function paletteColorOf(input: Uint8Array | Buffer): Promise<PaletteColor | null> {
  const { data, info } = await sharp(input, { animated: false })
    .resize(64, 64, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return paletteColorOfPixels(data, info.channels)
}
