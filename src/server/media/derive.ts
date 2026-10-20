import sharp, { type SharpOptions } from 'sharp'

// Web derivatives (docs/ARCHITECTURE.md §4). Runs in the worker only.
//   p240: static WebP q72, longest side 240, from the most informative frame
//   a160: animated WebP q40, longest side 160, ≤ 24 frames (animated sources only)
//   full: original size; animated WebP q60 with every frame, or static WebP q80

export const LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  maxSide: 2048,
  maxFrames: 400,
  // frames × width × height; ~120M px ≈ 480 MB RGBA, inside the worker's 2 GB limit
  maxPixels: 120_000_000,
}

const A160_MAX_FRAMES = 24

export interface Probe {
  format: string
  width: number
  height: number
  frames: number
  delays: number[]
  durationMs: number | null
  animated: boolean
}

export class MediaError extends Error {}

const MIME: Record<string, string> = { gif: 'image/gif', png: 'image/png', webp: 'image/webp', jpeg: 'image/jpeg' }

export function mimeOf(format: string): string | null {
  return MIME[format] ?? null
}

function input(buf: Uint8Array, opts: SharpOptions = {}) {
  return sharp(buf, { limitInputPixels: LIMITS.maxPixels, failOn: 'error', ...opts })
}

export async function probe(buf: Uint8Array): Promise<Probe> {
  if (buf.byteLength > LIMITS.maxBytes) throw new MediaError('文件超过 20 MB')
  const m = await input(buf, { animated: true }).metadata()
  if (!m.format || !mimeOf(m.format)) throw new MediaError('只支持 GIF、PNG、WebP、JPEG')
  const frames = m.pages ?? 1
  const width = m.width ?? 0
  const height = m.pageHeight ?? m.height ?? 0
  if (!width || !height) throw new MediaError('无法读取图片尺寸')
  if (width > LIMITS.maxSide || height > LIMITS.maxSide) throw new MediaError(`图片边长不能超过 ${LIMITS.maxSide}px`)
  if (frames > LIMITS.maxFrames) throw new MediaError(`动图不能超过 ${LIMITS.maxFrames} 帧`)
  if (frames * width * height > LIMITS.maxPixels) throw new MediaError('动图太大（帧数 × 尺寸超出上限）')
  const delays = normalizeDelays(m.delay ?? [], frames)
  return {
    format: m.format,
    width,
    height,
    frames,
    delays,
    durationMs: frames > 1 ? delays.reduce((a, b) => a + b, 0) : null,
    animated: frames > 1,
  }
}

/** Browsers treat GIF delays under 20 ms as 100 ms; mirror that so previews play at the same speed. */
export function normalizeDelays(delays: number[], frames: number): number[] {
  return Array.from({ length: frames }, (_, i) => {
    const d = delays[i] ?? 100
    return d < 20 ? 100 : d
  })
}

/** Frame with the highest entropy among 0, ¼, ½, ¾ — the first frame is often nearly blank. */
export async function posterFrame(buf: Uint8Array, p: Probe): Promise<number> {
  if (p.frames <= 1) return 0
  const candidates = [...new Set([0, Math.floor(p.frames / 4), Math.floor(p.frames / 2), Math.floor((p.frames * 3) / 4)])]
  let best = 0
  let bestEntropy = -1
  for (const page of candidates) {
    const s = await input(buf, { page }).stats()
    if (s.entropy > bestEntropy) {
      bestEntropy = s.entropy
      best = page
    }
  }
  return best
}

export async function dominantColor(buf: Uint8Array, page = 0): Promise<string> {
  const { dominant } = await input(buf, { page }).stats()
  return '#' + [dominant.r, dominant.g, dominant.b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

export async function renderP240(buf: Uint8Array, page: number): Promise<Buffer> {
  return input(buf, { page })
    .resize(240, 240, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72, effort: 4 })
    .toBuffer()
}

function fitInside(w: number, h: number, box: number) {
  const scale = Math.min(1, box / w, box / h)
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) }
}

/**
 * Animated preview. sharp's webp() has no pageHeight option (it is silently ignored and yields one
 * tall still image), so frames are decimated as raw RGBA, resized as a strip, then re-wrapped with
 * raw.pageHeight before encoding. The caller should check the frame count of the result.
 */
export async function renderA160(buf: Uint8Array, p: Probe): Promise<Buffer> {
  if (!p.animated) throw new MediaError('a160 is only generated for animated images')
  const step = Math.max(1, Math.ceil(p.frames / A160_MAX_FRAMES))
  const { data, info } = await input(buf, { animated: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const frameH = Math.round(info.height / p.frames)
  const frameBytes = info.width * frameH * 4
  const keep: number[] = []
  for (let i = 0; i < p.frames; i += step) keep.push(i)
  const strip = Buffer.alloc(frameBytes * keep.length)
  keep.forEach((fi, k) => data.copy(strip, k * frameBytes, fi * frameBytes, (fi + 1) * frameBytes))
  const delay = keep.map((fi) => {
    let d = 0
    for (let j = fi; j < Math.min(fi + step, p.frames); j++) d += p.delays[j] ?? 100
    return d
  })
  const out = fitInside(info.width, frameH, 160)
  const resized = await sharp(strip, { raw: { width: info.width, height: frameH * keep.length, channels: 4 } })
    .resize(out.w, out.h * keep.length, { fit: 'fill' })
    .raw()
    .toBuffer()
  return sharp(resized, { raw: { width: out.w, height: out.h * keep.length, channels: 4, pageHeight: out.h } })
    .webp({ quality: 40, effort: 4, loop: 0, delay })
    .toBuffer()
}

export async function renderFull(buf: Uint8Array, p: Probe): Promise<Buffer> {
  if (p.animated) return input(buf, { animated: true }).webp({ quality: 60, effort: 4, loop: 0 }).toBuffer()
  return input(buf).webp({ quality: 80, effort: 4 }).toBuffer()
}

/** Frame count of an encoded image; used to assert animated outputs really are animated. */
export async function countFrames(buf: Uint8Array): Promise<number> {
  const m = await sharp(buf, { animated: true }).metadata()
  return m.pages ?? 1
}

export function configureSharp() {
  sharp.cache(false)
  sharp.concurrency(1)
}

let imageTail: Promise<unknown> = Promise.resolve()

/**
 * Run sharp work one job at a time per process: at most one decoded animation is in memory, whatever
 * the queue concurrency. The storage I/O around it (seconds per job against R2) still overlaps.
 */
export function oneImageAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = imageTail.then(work)
  imageTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
