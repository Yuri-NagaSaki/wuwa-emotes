import { beforeAll, describe, expect, test } from 'bun:test'
import sharp from 'sharp'
import { countFrames, MediaError, posterFrame, probe, type Probe, renderA160, renderFull, renderP240 } from '#/server/media/derive'

// Synthetic sources made with sharp: a 30-frame 300×300 GIF (every frame different, so no encoder can
// merge frames) and a static 300×200 PNG.

const FRAMES = 30
const SIDE = 300

async function animatedGif(): Promise<Buffer> {
  const frame = SIDE * SIDE * 4
  const raw = Buffer.alloc(frame * FRAMES)
  for (let f = 0; f < FRAMES; f++) {
    const base = f * frame
    // background colour changes per frame; a white square moves across
    const r = (f * 37) % 256
    const g = (f * 91) % 256
    const b = 255 - ((f * 53) % 256)
    const sq = { x: (f * 9) % (SIDE - 40), y: (f * 5) % (SIDE - 40) }
    for (let y = 0; y < SIDE; y++) {
      for (let x = 0; x < SIDE; x++) {
        const i = base + (y * SIDE + x) * 4
        const inSquare = x >= sq.x && x < sq.x + 40 && y >= sq.y && y < sq.y + 40
        raw[i] = inSquare ? 255 : r
        raw[i + 1] = inSquare ? 255 : g
        raw[i + 2] = inSquare ? 255 : b
        raw[i + 3] = 255
      }
    }
  }
  return sharp(raw, { raw: { width: SIDE, height: SIDE * FRAMES, channels: 4, pageHeight: SIDE } })
    .gif({ delay: Array.from({ length: FRAMES }, () => 80), loop: 0 })
    .toBuffer()
}

async function staticPng(): Promise<Buffer> {
  return sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 20, g: 120, b: 220, alpha: 1 } } })
    .composite([{ input: Buffer.from('<svg width="80" height="80"><circle cx="40" cy="40" r="35" fill="#fff"/></svg>'), top: 60, left: 110 }])
    .png()
    .toBuffer()
}

async function dims(buf: Buffer) {
  const m = await sharp(buf, { animated: true }).metadata()
  return { format: m.format, width: m.width ?? 0, height: m.pageHeight ?? m.height ?? 0, frames: m.pages ?? 1 }
}

describe('animated GIF', () => {
  let gif: Buffer
  let p: Probe

  beforeAll(async () => {
    gif = await animatedGif()
    p = await probe(gif)
  })

  test('probe sees 30 frames at the source size', () => {
    expect(p.format).toBe('gif')
    expect(p.frames).toBe(FRAMES)
    expect(p.animated).toBe(true)
    expect(p.width).toBe(SIDE)
    expect(p.height).toBe(SIDE)
    expect(p.delays).toHaveLength(FRAMES)
    expect(p.durationMs).toBe(FRAMES * 80)
  })

  test('a160 is animated, 2..24 frames, at most 160 px', async () => {
    const out = await renderA160(gif, p)
    const d = await dims(out)
    expect(d.format).toBe('webp')
    expect(d.frames).toBeGreaterThanOrEqual(2)
    expect(d.frames).toBeLessThanOrEqual(24)
    expect(await countFrames(out)).toBe(d.frames)
    expect(Math.max(d.width, d.height)).toBeLessThanOrEqual(160)
    // the frame strip must not come back as one tall still image
    expect(d.height).toBeLessThanOrEqual(160)
  })

  test('full keeps every frame at the original size', async () => {
    const out = await renderFull(gif, p)
    const d = await dims(out)
    expect(d.format).toBe('webp')
    expect(d.frames).toBe(FRAMES)
    expect(d.width).toBe(SIDE)
    expect(d.height).toBe(SIDE)
  })

  test('p240 is a single frame, at most 240 px', async () => {
    const out = await renderP240(gif, await posterFrame(gif, p))
    const d = await dims(out)
    expect(d.format).toBe('webp')
    expect(d.frames).toBe(1)
    expect(Math.max(d.width, d.height)).toBeLessThanOrEqual(240)
  })

  test('poster frame is one of 0, ¼, ½, ¾', async () => {
    expect([0, 7, 15, 22]).toContain(await posterFrame(gif, p))
  })
})

describe('static PNG', () => {
  let png: Buffer
  let p: Probe

  beforeAll(async () => {
    png = await staticPng()
    p = await probe(png)
  })

  test('probe: one frame, not animated', () => {
    expect(p.format).toBe('png')
    expect(p.frames).toBe(1)
    expect(p.animated).toBe(false)
    expect(p.durationMs).toBeNull()
    expect({ w: p.width, h: p.height }).toEqual({ w: 300, h: 200 })
  })

  test('no a160 for static images', async () => {
    await expect(renderA160(png, p)).rejects.toBeInstanceOf(MediaError)
  })

  test('full is a static WebP at the original size', async () => {
    const d = await dims(await renderFull(png, p))
    expect(d).toEqual({ format: 'webp', width: 300, height: 200, frames: 1 })
  })

  test('p240 fits inside 240 px', async () => {
    const d = await dims(await renderP240(png, await posterFrame(png, p)))
    expect(d.frames).toBe(1)
    expect(d.width).toBe(240)
    expect(d.height).toBe(160)
  })
})

describe('probe rejects', () => {
  test('non-images', async () => {
    await expect(probe(new TextEncoder().encode('not an image at all'))).rejects.toThrow()
  })

  test('oversized files', async () => {
    await expect(probe(new Uint8Array(20 * 1024 * 1024 + 1))).rejects.toBeInstanceOf(MediaError)
  })
})
