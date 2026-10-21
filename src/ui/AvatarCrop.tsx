import { Dialog } from '@base-ui/react/dialog'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { setAvatarFn } from '#/server/account/fn'
import { errorText } from './account/text'
import avatarCss from './avatar.css?url'
import { Button } from './Button'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { PHONE_QUERY, useMediaQuery } from './useMediaQuery'

// 更换头像 › crop: a square stage with a round mask, drag to move, zoom 1×–4× (slider, wheel, pinch,
// + / −), arrow keys nudge. The picture is decoded once with createImageBitmap (EXIF orientation
// applied; animations give their first frame, as the server keeps), drawn on a canvas, and the square
// under the stage is encoded at 512 × 512 (WebP, or PNG where the browser cannot write WebP) and sent
// to setAvatarFn, which re-encodes it. Modal look on desktop, bottom sheet on phones. Loaded on demand
// by the 设置 avatar row.

const OUT = 512
const MAX_ZOOM = 4

/** Offsets are in stage widths from the centred position, so they survive a stage resize. */
interface View {
  zoom: number
  x: number
  y: number
}

const START: View = { zoom: 1, x: 0, y: 0 }

function clampView(v: View, w: number, h: number): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, Number.isFinite(v.zoom) ? v.zoom : 1))
  // stage = 1 unit; the picture covers it at zoom 1
  const scale = Math.max(1 / w, 1 / h) * zoom
  const mx = Math.max(0, (w * scale - 1) / 2)
  const my = Math.max(0, (h * scale - 1) / 2)
  return { zoom, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) }
}

/** Zoom about the stage centre: the picture point under the centre stays there. */
function zoomTo(v: View, zoom: number, w: number, h: number): View {
  const z = Math.min(MAX_ZOOM, Math.max(1, zoom))
  const k = z / v.zoom
  return clampView({ zoom: z, x: v.x * k, y: v.y * k }, w, h)
}

/** Source rectangle (in picture pixels) under the stage. */
function sourceRect(v: View, w: number, h: number) {
  const scale = Math.max(1 / w, 1 / h) * v.zoom
  const size = 1 / scale
  const sx = w / 2 - (0.5 + v.x) / scale
  const sy = h / 2 - (0.5 + v.y) / scale
  return { sx, sy, size }
}

async function encode(bitmap: ImageBitmap, v: View): Promise<Blob> {
  const { sx, sy, size } = sourceRect(v, bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = OUT
  canvas.height = OUT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, OUT, OUT)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/webp', 0.9))
}

export interface AvatarCropProps {
  file: File
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after the server accepted the new avatar. */
  onSaved: () => void
}

export default function AvatarCrop({ file, open, onOpenChange, onSaved }: AvatarCropProps) {
  const phone = useMediaQuery(PHONE_QUERY)
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)
  const [view, setView] = useState<View>(START)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    let made: ImageBitmap | null = null
    setBitmap(null)
    setView(START)
    setError(null)
    createImageBitmap(file, { imageOrientation: 'from-image' }).then(
      (b) => {
        made = b
        if (live) setBitmap(b)
        else b.close()
      },
      () => live && setError('无法读取这张图片，请换一张试试'),
    )
    return () => {
      live = false
      made?.close()
    }
  }, [file])

  const close = (next: boolean) => {
    if (!next && busy) return
    onOpenChange(next)
  }

  async function save() {
    if (!bitmap || busy) return
    setBusy(true)
    setError(null)
    try {
      const blob = await encode(bitmap, view)
      const form = new FormData()
      form.append('file', blob, blob.type === 'image/webp' ? 'avatar.webp' : 'avatar.png')
      await setAvatarFn({ data: form })
      onSaved()
    } catch (err) {
      setError(errorText(err, '上传失败，请稍后再试'))
    } finally {
      setBusy(false)
    }
  }

  const body = <CropBody bitmap={bitmap} view={view} setView={setView} error={error} />
  const saveButton = (
    <Button variant="primary" block={phone} disabled={!bitmap || busy} onClick={save}>
      {busy ? '保存中…' : '保存'}
    </Button>
  )
  const cancelButton = (
    <Button block={phone} variant={phone ? 'default' : 'ghost'} disabled={busy} onClick={() => close(false)}>
      取消
    </Button>
  )

  if (phone) {
    return (
      <Sheet
        open={open}
        onOpenChange={close}
        title="更换头像"
        icon="image"
        footer={
          <div className="av-sheet-acts">
            {cancelButton}
            {saveButton}
          </div>
        }
      >
        {body}
      </Sheet>
    )
  }
  return (
    <CropModal open={open} onOpenChange={close}>
      {body}
      <div className="acts">
        {cancelButton}
        {saveButton}
      </div>
    </CropModal>
  )
}

/** The notice modal's look (Modal.tsx), with room for the stage; Modal itself only takes text. */
function CropModal({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const popup = useRef<HTMLDivElement>(null)
  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="scrim" />
        <Dialog.Viewport className="modal-wrap">
          <Dialog.Popup ref={popup} className="modal av-modal" initialFocus={(type) => (type === 'keyboard' ? true : popup.current)}>
            <div className="modal-body">
              <Dialog.Title render={<h3 />}>更换头像</Dialog.Title>
              {children}
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

interface CropBodyProps {
  bitmap: ImageBitmap | null
  view: View
  setView: (fn: (v: View) => View) => void
  error: string | null
}

function CropBody({ bitmap, view, setView, error }: CropBodyProps) {
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [side, setSide] = useState(0)
  const [dragging, setDragging] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; zoom: number } | null>(null)
  const w = bitmap?.width ?? 1
  const h = bitmap?.height ?? 1

  // stage size in CSS px
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const read = () => setSide(el.clientWidth)
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // draw
  useEffect(() => {
    const c = canvas.current
    if (!c || !side) return
    const frame = requestAnimationFrame(() => {
      const dpr = Math.min(3, window.devicePixelRatio || 1)
      const px = Math.round(side * dpr)
      if (c.width !== px) c.width = px
      if (c.height !== px) c.height = px
      const ctx = c.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, px, px)
      if (!bitmap) return
      ctx.imageSmoothingQuality = 'high'
      const scale = Math.max(px / bitmap.width, px / bitmap.height) * view.zoom
      const dw = bitmap.width * scale
      const dh = bitmap.height * scale
      ctx.drawImage(bitmap, (px - dw) / 2 + view.x * px, (px - dh) / 2 + view.y * px, dw, dh)
    })
    return () => cancelAnimationFrame(frame)
  }, [bitmap, view, side])

  const move = useCallback((dx: number, dy: number) => setView((v) => clampView({ ...v, x: v.x + dx, y: v.y + dy }, w, h)), [setView, w, h])
  const zoom = useCallback((z: (v: View) => number) => setView((v) => zoomTo(v, z(v), w, h)), [setView, w, h])

  // wheel zoom needs a non-passive listener to keep the page from scrolling
  useEffect(() => {
    const el = stage.current
    if (!el || !bitmap) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoom((v) => v.zoom * Math.exp(-e.deltaY / 500))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [bitmap, zoom])

  const distance = () => {
    const [a, b] = [...pointers.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  function down(e: PointerEvent<HTMLDivElement>) {
    if (!bitmap) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) pinch.current = { dist: distance(), zoom: view.zoom }
    setDragging(true)
  }

  function moveTo(e: PointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId)
    if (!prev || !side) return
    const next = { x: e.clientX, y: e.clientY }
    pointers.current.set(e.pointerId, next)
    if (pointers.current.size === 1) {
      move((next.x - prev.x) / side, (next.y - prev.y) / side)
    } else if (pinch.current && pinch.current.dist > 0) {
      const p = pinch.current
      zoom(() => (p.zoom * distance()) / p.dist)
      // the pinch centre moves by half of each finger's move
      move((next.x - prev.x) / side / 2, (next.y - prev.y) / side / 2)
    }
  }

  function up(e: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (!pointers.current.size) setDragging(false)
  }

  function key(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 0.1 : 0.02
    const keys: Record<string, () => void> = {
      ArrowLeft: () => move(-step, 0),
      ArrowRight: () => move(step, 0),
      ArrowUp: () => move(0, -step),
      ArrowDown: () => move(0, step),
      '+': () => zoom((v) => v.zoom + 0.25),
      '=': () => zoom((v) => v.zoom + 0.25),
      '-': () => zoom((v) => v.zoom - 0.25),
    }
    const run = keys[e.key]
    if (!run || !bitmap) return
    e.preventDefault()
    run()
  }

  return (
    <div className="av-crop">
      <link rel="stylesheet" href={avatarCss} precedence="default" />
      <div
        ref={stage}
        className={dragging ? 'av-stage is-drag' : 'av-stage'}
        tabIndex={0}
        role="group"
        aria-label="裁剪区域：拖动或用方向键调整位置，加减号缩放"
        onPointerDown={down}
        onPointerMove={moveTo}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
      >
        <canvas ref={canvas} aria-hidden="true" />
        <span className="av-mask" aria-hidden="true" />
        {!bitmap && !error ? <span className="av-load">读取中…</span> : null}
      </div>
      <label className="av-zoom">
        <Icon name="minus" />
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={view.zoom}
          aria-label="缩放"
          disabled={!bitmap}
          onChange={(e) => {
            const z = Number(e.currentTarget.value)
            zoom(() => z)
          }}
        />
        <Icon name="plus" />
      </label>
      <p className="av-hint">拖动调整位置，滑块或双指缩放</p>
      {error ? (
        <p className="av-err" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
