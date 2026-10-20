import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { adminAdvanceUploadsFn, adminCompleteUploadsFn, adminSignUploadsFn, adminUploadTargetsFn } from '#/server/admin/fns/content'
import { UPLOAD_MAX_BYTES, UPLOAD_TYPES } from '#/server/admin/inputs'
import type { PackListRow, UploadState } from '#/server/admin/types'
import { Button, buttonClass } from '../Button'
import { cx } from '../cx'
import { Input } from '../Field'
import { FilterPopover } from '../FilterPopover'
import { fmtB, fmtN } from '../format'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { toast } from '../Toast'
import { errorText, Kpi, PackStatusPill, PageHead, Panel, Pill, Thumb, type Tone } from './bits'

// 上传中心: files go straight from the browser to the bucket (presigned PUT), then through the worker
// pipeline; staff uploads are published as soon as their previews exist.

type Stage = 'invalid' | 'signing' | 'uploading' | 'put-failed' | UploadState['stage']

interface Item {
  key: string
  file: File
  name: string
  size: number
  preview: string
  stage: Stage
  progress: number
  error: string | null
  id?: string
  url?: string
  contentType?: string
  thumb?: string | null
}

const STEPS = ['直传', '校验', '去重', '预览', '发布'] as const
const TERMINAL = new Set<Stage>(['invalid', 'put-failed', 'duplicate', 'failed', 'published'])
const ACCEPT = UPLOAD_TYPES.join(',')
const PARALLEL = 3

function pipeline(it: Item): ('' | 'ok' | 'run' | 'err' | 'skip')[] {
  switch (it.stage) {
    case 'invalid':
    case 'put-failed':
      return ['err']
    case 'signing':
    case 'signed':
    case 'uploading':
      return ['run']
    case 'uploaded':
    case 'processing':
      return ['ok', 'run']
    case 'failed':
      return ['ok', 'err']
    case 'duplicate':
      return ['ok', 'ok', 'skip']
    case 'done':
      return ['ok', 'ok', 'ok', 'run']
    case 'published':
      return ['ok', 'ok', 'ok', 'ok', 'ok']
  }
}

const STATUS: Record<Stage, [Tone, string, boolean?]> = {
  invalid: ['err', '不支持'],
  signing: ['info', '准备上传', true],
  signed: ['info', '准备上传', true],
  uploading: ['info', '上传中', true],
  'put-failed': ['err', '上传失败'],
  uploaded: ['info', '排队校验', true],
  processing: ['info', '校验中', true],
  done: ['info', '生成预览', true],
  duplicate: ['warn', '重复，已跳过'],
  failed: ['err', '未通过'],
  published: ['ok', '已发布'],
}

let seq = 0

function put(it: Item, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', it.url!)
    xhr.setRequestHeader('content-type', it.contentType!)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`存储返回 ${xhr.status}`)))
    xhr.onerror = () => reject(new Error('网络错误'))
    xhr.send(it.file)
  })
}

export function UploadPage({ target: initialTarget, recent }: { target: PackListRow | null; recent: PackListRow[] }) {
  const navigate = useNavigate()
  const [target, setTarget] = useState<PackListRow | null>(initialTarget)
  const [items, setItems] = useState<Item[]>([])
  const [over, setOver] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PackListRow[]>(recent)
  const [pickOpen, setPickOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  const patch = (key: string, p: Partial<Item>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...p } : it)))

  // pack search for the target picker
  useEffect(() => {
    if (!pickOpen) return
    const t = setTimeout(() => {
      adminUploadTargetsFn({ data: { q: q.trim() || undefined } })
        .then((r) => setResults(r.rows))
        .catch(() => {})
    }, 200)
    return () => clearTimeout(t)
  }, [q, pickOpen])

  // poll the server while anything is between upload and a final state
  const pending = items.filter((it) => it.id && !TERMINAL.has(it.stage) && it.stage !== 'uploading' && it.stage !== 'signing' && it.stage !== 'signed')
  const pendingKey = pending.map((it) => it.id).join(',')
  useEffect(() => {
    if (!pendingKey) return
    const ids = pendingKey.split(',')
    const timer = setInterval(async () => {
      try {
        const states = await adminAdvanceUploadsFn({ data: { ids } })
        setItems((list) =>
          list.map((it) => {
            const s = states.find((x) => x.id === it.id)
            return s ? { ...it, stage: s.stage, error: s.error, thumb: s.thumb ?? it.thumb } : it
          }),
        )
      } catch {
        // keep polling; a transient error should not stop the batch
      }
    }, 1500)
    return () => clearInterval(timer)
  }, [pendingKey])

  async function uploadOne(it: Item) {
    patch(it.key, { stage: 'uploading', progress: 0, error: null })
    try {
      await put(it, (p) => patch(it.key, { progress: p }))
      patch(it.key, { stage: 'uploaded', progress: 100 })
      await adminCompleteUploadsFn({ data: { ids: [it.id!] } })
    } catch (err) {
      patch(it.key, { stage: 'put-failed', error: errorText(err) })
    }
  }

  async function addFiles(files: File[]) {
    if (!target) {
      toast({ message: '先选择上传到哪个表情包', icon: 'warn' })
      return
    }
    const fresh: Item[] = files.map((file) => {
      const bad = !(UPLOAD_TYPES as readonly string[]).includes(file.type) ? '只支持 GIF、PNG、WebP、JPEG' : file.size > UPLOAD_MAX_BYTES ? `超过 ${UPLOAD_MAX_BYTES / 1024 / 1024} MB` : null
      return {
        key: `f${++seq}`,
        file,
        name: file.name,
        size: file.size,
        preview: bad ? '' : URL.createObjectURL(file),
        stage: bad ? 'invalid' : 'signing',
        progress: 0,
        error: bad,
      }
    })
    setItems((list) => [...fresh, ...list])
    const valid = fresh.filter((f) => f.stage === 'signing')
    if (!valid.length) return
    let signed
    try {
      signed = await adminSignUploadsFn({ data: { packId: target.id, files: valid.map((f) => ({ name: f.name, size: f.size, type: f.file.type })) } })
    } catch (err) {
      for (const f of valid) patch(f.key, { stage: 'put-failed', error: errorText(err) })
      return
    }
    const ready = valid.map((f, i) => ({ ...f, id: signed[i]!.id, url: signed[i]!.url, contentType: signed[i]!.contentType, stage: 'signed' as Stage }))
    setItems((list) => list.map((it) => ready.find((r) => r.key === it.key) ?? it))
    // a few PUTs at a time; the rest wait their turn
    let next = 0
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL, ready.length) }, async () => {
        while (next < ready.length) await uploadOne(ready[next++]!)
      }),
    )
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setOver(false)
    void addFiles([...e.dataTransfer.files])
  }

  const count = (s: Stage[]) => items.filter((it) => s.includes(it.stage)).length

  return (
    <>
      <PageHead title="上传中心" sub="站长和管理员直接上传到任意表情包；处理完成后立即发布。普通用户在前台「投稿」上传到自己的包。" />

      <Panel title="上传到">
        <div className="adm-target-row">
          {target ? (
            <div className="adm-target-card">
              <Thumb src={target.thumb} size={40} />
              <div style={{ minWidth: 0 }}>
                <b className="adm-dyn">{target.title}</b>
                <div className="hint mono">{target.packKey}</div>
              </div>
              <PackStatusPill status={target.status} />
            </div>
          ) : (
            <span className="hint">还没有选择表情包</span>
          )}
          <FilterPopover
            label={target ? '换一个' : '选择表情包'}
            open={pickOpen}
            onOpenChange={setPickOpen}
            panelClassName="fpop-pick"
            header={<Input size="sm" icon="search" placeholder="标题或 packKey" aria-label="搜索表情包" value={q} onChange={(e) => setQ(e.currentTarget.value)} />}
          >
            <div className="adm-target-list">
              {results.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={target?.id === p.id}
                  onClick={() => {
                    setTarget(p)
                    setPickOpen(false)
                    void navigate({ to: '/admin/upload', search: { pack: p.id }, replace: true })
                  }}
                >
                  <Thumb src={p.thumb} size={32} />
                  <span style={{ minWidth: 0 }}>
                    <b>{p.title}</b>
                    <small>{p.packKey}</small>
                  </span>
                </button>
              ))}
              {!results.length ? <span className="hint">没有找到。新的包请先在「表情包」里新建。</span> : null}
            </div>
          </FilterPopover>
          {target ? (
            <AppLink to={`/admin/packs/${target.id}`} className={buttonClass({ size: 'sm', variant: 'ghost' })}>
              编辑这个包
            </AppLink>
          ) : null}
        </div>
        {target && target.status !== 'published' ? (
          <p className="hint" style={{ marginTop: 10 }}>
            这个包还没有发布：表情处理完后会是已发布状态，但要在编辑页发布这个包后才会出现在前台。
          </p>
        ) : null}
      </Panel>

      <div
        className={cx('drop', over && 'is-over', !target && 'is-disabled')}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <span className="drop-ico">
          <Icon name="upload" size="lg" />
        </span>
        <div>
          <b>把 GIF、PNG、WebP 或 JPEG 拖到这里</b>
          <p>单个文件不超过 {UPLOAD_MAX_BYTES / 1024 / 1024} MB；同一包里的重复文件会自动跳过。</p>
        </div>
        <Button variant="primary" icon="upload" disabled={!target} onClick={() => input.current?.click()}>
          选择文件
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          onChange={(e) => {
            const files = [...(e.currentTarget.files ?? [])]
            e.currentTarget.value = ''
            void addFiles(files)
          }}
        />
      </div>

      {items.length ? (
        <div className="kpis">
          <Kpi label="本批文件" value={fmtN(items.length)} note={`${fmtB(items.reduce((a, it) => a + it.size, 0))}`} />
          <Kpi label="已发布" value={fmtN(count(['published']))} note="已生成海报与动图预览" />
          <Kpi label="重复" value={fmtN(count(['duplicate']))} note="SHA-256 与本包已有表情相同" />
          <Kpi label="失败" value={fmtN(count(['invalid', 'put-failed', 'failed']))} note="可重试或移除" alert={count(['invalid', 'put-failed', 'failed']) > 0} />
        </div>
      ) : null}

      <Panel title="处理队列" flush acts={items.length ? <span className="hint">{fmtN(items.length - pending.length - count(['uploading', 'signing', 'signed']))} / {fmtN(items.length)} 完成</span> : null}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>文件</th>
                <th className="n col-opt">大小</th>
                <th>流水线</th>
                <th>状态</th>
                <th className="col-opt">进度</th>
                <th>
                  <span className="sr">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!items.length ? (
                <tr className="adm-empty-row">
                  <td colSpan={6}>还没有文件。选择目标包后，把文件拖进上面的区域。</td>
                </tr>
              ) : null}
              {items.map((it) => {
                const [tone, label, run] = STATUS[it.stage]
                const steps = pipeline(it)
                return (
                  <tr key={it.key}>
                    <td>
                      <div className="cell">
                        <Thumb src={it.thumb ?? (it.preview || null)} className="th-img" />
                        <div style={{ minWidth: 0 }}>
                          <b>{it.name}</b>
                          {it.error ? <span className="adm-err">{it.error}</span> : null}
                        </div>
                      </div>
                    </td>
                    <td className="n col-opt">{fmtB(it.size)}</td>
                    <td>
                      <div className="pipe">
                        {STEPS.map((s, i) => (
                          <span key={s} className={steps[i] ?? ''}>
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <Pill tone={tone} run={run}>
                        {label}
                      </Pill>
                    </td>
                    <td className="col-opt">
                      <div className="mini-prog" style={{ ['--p' as string]: `${it.stage === 'uploading' ? it.progress : it.stage === 'put-failed' || it.stage === 'invalid' ? 0 : TERMINAL.has(it.stage) || steps.length > 1 ? 100 : 0}%` }}>
                        <i />
                      </div>
                    </td>
                    <td>
                      <div className="row-acts">
                        {it.stage === 'put-failed' && it.url ? (
                          <button type="button" className="ibtn" aria-label={`重试 ${it.name}`} title="重试" onClick={() => void uploadOne(it)}>
                            <Icon name="refresh" />
                          </button>
                        ) : null}
                        {TERMINAL.has(it.stage) ? (
                          <button type="button" className="ibtn" aria-label={`从列表移除 ${it.name}`} title="移除" onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))}>
                            <Icon name="close" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="note-box">
        <Icon name="info" size="sm" />
        <span>
          流程：浏览器申请预签名链接，直传到 <span className="mono">uploads/tmp/</span>；worker 校验格式与尺寸、计算 SHA-256 去重、选海报帧，把原图写到{' '}
          <span className="mono">assets/v1/packs/&lt;packKey&gt;/emojis/</span>，生成 p240 与 a160 预览；预览就绪后直接发布到 <span className="mono">derived/v1/</span>。full 档在首次查看时生成。暂存区 7
          天后由生命周期规则清理。
        </span>
      </div>
    </>
  )
}
