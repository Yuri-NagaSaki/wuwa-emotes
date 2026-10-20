import { describe, expect, test } from 'bun:test'
import sharp from 'sharp'
import { nearestHue, nearestPalette, oklab, PALETTE, type PaletteName, paletteColorOf, paletteColorOfPixels } from '#/server/import/colors'

// Theme colours from art, snapped to the design palette (src/server/import/colors.ts).

/** RGBA pixels: `parts` of [count, r, g, b, a]. */
function pixels(...parts: [number, number, number, number, number][]): Uint8Array {
  const out: number[] = []
  for (const [n, r, g, b, a] of parts) for (let i = 0; i < n; i++) out.push(r, g, b, a)
  return new Uint8Array(out)
}

const hex = (h: string): [number, number, number] => {
  const n = Number.parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

describe('palette', () => {
  test('the design palette (tokens.css --c-*) snaps to itself', () => {
    for (const [name, h] of Object.entries(PALETTE) as [PaletteName, string][]) expect(nearestPalette(oklab(...hex(h)))).toBe(name)
  })

  test('saturated pixels vote by hue: deep red is red, not brown; light pink is pink', () => {
    const vote = (h: string) => {
      const [L, a, b] = oklab(...hex(h))
      return nearestHue(L, ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360)
    }
    expect(vote('#8b1a1a')).toBe('red')
    expect(vote('#f7a8c4')).toBe('pink')
    expect(vote('#1e3a8a')).toBe('blue')
    expect(vote('#0f766e')).toBe('teal')
    expect(vote('#7e22ce')).toBe('purple')
    // peach and orange are 10° apart in the palette
    expect(vote('#ea580c')).toMatch(/^(orange|peach)$/)
  })
})

describe('paletteColorOfPixels', () => {
  test('the strongest colour wins; transparent and white background, skin and black lines do not count', () => {
    const c = paletteColorOfPixels(
      pixels(
        [500, 255, 255, 255, 255], // white background
        [500, 30, 200, 60, 0], // transparent green
        [300, 246, 215, 195, 255], // skin
        [200, 10, 10, 10, 255], // outlines
        [120, 60, 90, 230, 255], // blue dress
        [40, 220, 60, 60, 255], // a red ribbon
      ),
      4,
    )
    expect(c?.name).toBe('blue')
    expect(c!.confidence).toBeGreaterThan(0.6)
  })

  test('art without colour falls back to its mid tones (grey and black → brown)', () => {
    const c = paletteColorOfPixels(pixels([300, 120, 115, 110, 255], [300, 20, 20, 20, 255], [300, 250, 250, 250, 255]), 4)
    expect(c).toEqual({ name: 'brown', confidence: 0, colourful: 0 })
  })

  test('nothing opaque: null', () => {
    expect(paletteColorOfPixels(pixels([100, 200, 0, 0, 0]), 4)).toBeNull()
    expect(paletteColorOfPixels(pixels([100, 255, 255, 255, 255]), 4)).toBeNull()
  })
})

describe('paletteColorOf (images)', () => {
  test('reads PNG and WebP, first frame of an animation', async () => {
    const svg = (fill: string) =>
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160"><circle cx="60" cy="80" r="50" fill="${fill}"/></svg>`)
    expect((await paletteColorOf(await sharp(svg('#f472b6')).png().toBuffer()))?.name).toBe('pink')
    expect((await paletteColorOf(await sharp(svg('#14b8a6')).webp().toBuffer()))?.name).toBe('teal')
    expect((await paletteColorOf(await sharp(svg('#eab308')).webp().toBuffer()))?.name).toMatch(/^(yellow|yg)$/)
  })
})
