// Placeholder stickers for /kit, drawn as inline SVG data URIs (the repo ships no sample images, and
// /kit must not load anything from another origin). Animated variants use SMIL, which also plays
// inside <img>.

const COLORS = ['#f8a6b2', '#b77dee', '#889df0', '#f7cd67', '#e59266', '#82d5bb', '#8ac68a', '#fc736d', '#d1da49', '#ecdf52', '#9a835a', '#e18c6f', '#19c8b9']
export const PALETTE = ['pink', 'purple', 'blue', 'yellow', 'orange', 'mint', 'green', 'red', 'lime', 'yg', 'brown', 'peach', 'teal'] as const

function rand(seed: number) {
  let s = seed * 2654435761
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 10_000) / 10_000
  }
}

const uri = (svg: string) => 'data:image/svg+xml,' + encodeURIComponent(svg)

/** A round island creature. `w`×`h` sets the canvas (for masonry), the face stays centered. */
export function sticker(seed: number, opts: { animated?: boolean; w?: number; h?: number } = {}): string {
  const { animated = false, w = 240, h = 240 } = opts
  const r = rand(seed + 1)
  const color = COLORS[seed % COLORS.length]!
  const cx = w / 2
  const cy = h / 2 + 4
  const rad = Math.min(w, h) * 0.38
  const eye = 0.16 + r() * 0.08
  const mouth = r() > 0.5 ? `M${cx - rad * 0.28} ${cy + rad * 0.22} Q${cx} ${cy + rad * 0.52} ${cx + rad * 0.28} ${cy + rad * 0.22}` : `M${cx - rad * 0.2} ${cy + rad * 0.3} L${cx + rad * 0.2} ${cy + rad * 0.3}`
  const blush = r() > 0.4
  const anim = animated
    ? `<animateTransform attributeName="transform" type="rotate" values="-9 ${cx} ${cy};9 ${cx} ${cy};-9 ${cx} ${cy}" dur="${(0.9 + r() * 0.6).toFixed(2)}s" repeatCount="indefinite"/>`
    : ''
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<g>${anim}` +
    `<path d="M${cx - rad} ${cy}Q${cx - rad} ${cy - rad} ${cx} ${cy - rad}Q${cx + rad} ${cy - rad} ${cx + rad} ${cy}Q${cx + rad} ${cy + rad * 0.95} ${cx} ${cy + rad * 0.95}Q${cx - rad} ${cy + rad * 0.95} ${cx - rad} ${cy}Z" fill="${color}" stroke="#794f27" stroke-width="6" stroke-linejoin="round"/>` +
    `<circle cx="${cx - rad * 0.36}" cy="${cy - rad * 0.12}" r="${rad * eye * 0.5}" fill="#3d2a16"/>` +
    `<circle cx="${cx + rad * 0.36}" cy="${cy - rad * 0.12}" r="${rad * eye * 0.5}" fill="#3d2a16"/>` +
    (blush
      ? `<ellipse cx="${cx - rad * 0.56}" cy="${cy + rad * 0.14}" rx="${rad * 0.13}" ry="${rad * 0.08}" fill="#fff" opacity=".45"/><ellipse cx="${cx + rad * 0.56}" cy="${cy + rad * 0.14}" rx="${rad * 0.13}" ry="${rad * 0.08}" fill="#fff" opacity=".45"/>`
      : '') +
    `<path d="${mouth}" fill="none" stroke="#3d2a16" stroke-width="6" stroke-linecap="round"/>` +
    `</g></svg>`
  return uri(svg)
}

export interface SampleItem {
  id: string
  poster: string
  preview: string | null
  w: number
  h: number
}

const SHAPES: [number, number][] = [
  [300, 300],
  [300, 300],
  [240, 320],
  [320, 240],
  [300, 420],
  [280, 280],
  [360, 270],
]

/** `n` stickers with stored dimensions (every third one static). */
export function sampleItems(n: number, offset = 0): SampleItem[] {
  return Array.from({ length: n }, (_, k) => {
    const i = k + offset
    const [w, h] = SHAPES[i % SHAPES.length]!
    const animated = i % 3 !== 0
    return { id: `s${i}`, w, h, poster: sticker(i, { w, h }), preview: animated ? sticker(i, { w, h, animated: true }) : null }
  })
}
