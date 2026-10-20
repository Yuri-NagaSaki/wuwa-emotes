import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  adminDeleteEmojisFn,
  adminEmojiDetailFn,
  adminEmojiStatusFn,
  adminMoveEmojisFn,
  adminPublishEmojisFn,
  adminRegenerateFn,
  adminUploadTargetsFn,
} from '#/server/admin/fns/content'
import type { EmojiDetail, EmojiListRow, Paged, PackListRow } from '#/server/admin/types'
import { Button } from '../Button'
import { Input } from '../Field'
import { fmtB, fmtN } from '../format'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { Modal, ModalClose } from '../Modal'
import { Sheet } from '../Sheet'
import { Tile, TileGrid } from '../Tile'
import { toast } from '../Toast'
import { BulkBar, EmojiStatusPill, errorText, fmtDateTime, PageHead, Pager, Pill, SelectField, Thumb, toggled, useAction } from './bits'

export interface EmojisSearch {
  q?: string
  packId?: number
  status?: 'pending' | 'published' | 'hidden'
  format?: 'gif' | 'png' | 'webp' | 'jpeg'
  derived?: 'ready' | 'missing'
  page?: number
}

const PLACEHOLDER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" rx="24" fill="#ece5d3"/><path d="M80 150l30-34 22 24 16-18 32 28H80z" fill="#c9bea4"/><circle cx="96" cy="96" r="12" fill="#c9bea4"/></svg>',
  )

export function EmojisPage({ data, search, packTitle }: { data: Paged<EmojiListRow> & { formats: { format: string; n: number }[] }; search: EmojisSearch; packTitle: string | null }) {
  const navigate = useNavigate()
  const { run, busy } = useAction()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selecting, setSelecting] = useState(false)
  const [q, setQ] = useState(search.q ?? '')
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<EmojiDetail | null>(null)
  const [confirm, setConfirm] = useState<string[] | null>(null)
  const [moving, setMoving] = useState<string[] | null>(null)

  const go = (patch: Partial<EmojisSearch>) => {
    setSelected(new Set())
    void navigate({ to: '/admin/emojis', search: { ...search, page: undefined, ...patch } })
  }

  useEffect(() => {
    if (!open) return setDetail(null)
    let live = true
    adminEmojiDetailFn({ data: { id: open } })
      .then((d) => live && setDetail(d))
      .catch((err) => {
        if (!live) return
        setOpen(null)
        toast({ message: errorText(err), icon: 'warn' })
      })
    return () => {
      live = false
    }
  }, [open, data])

  const total = data.formats.reduce((a, f) => a + f.n, 0)
  const sel = [...selected]
  const done = () => {
    setSelected(new Set())
    setSelecting(false)
  }

  return (
    <>
      <PageHead
        title="表情库"
        sub={`${fmtN(total)} 张 · ${data.formats.map((f) => `${f.format.toUpperCase()} ${fmtN(f.n)}`).join(' · ')}`}
        actions={
          <Button size="sm" on={selecting} icon="check" onClick={() => (selecting ? done() : setSelecting(true))}>
            {selecting ? '退出多选' : '多选'}
          </Button>
        }
      />

      <div className="filters">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            go({ q: q.trim() || undefined })
          }}
        >
          <Input size="sm" icon="search" wrapClassName="adm-search" placeholder="表情 ID、SHA-256、包标题或 packKey" aria-label="搜索表情" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        </form>
        {search.packId ? (
          <button type="button" className="chip sm is-on" onClick={() => go({ packId: undefined })} aria-label="清除包筛选">
            包：<span className="adm-dyn">{packTitle ?? `#${search.packId}`}</span>
            <span className="x" aria-hidden="true">
              <Icon name="close" size="sm" />
            </span>
          </button>
        ) : null}
        <SelectField
          label="状态"
          value={search.status ?? ''}
          onChange={(v) => go({ status: v || undefined })}
          options={[
            { value: '', label: '全部' },
            { value: 'published', label: '已发布' },
            { value: 'pending', label: '待审核' },
            { value: 'hidden', label: '已隐藏' },
          ]}
        />
        <SelectField
          label="格式"
          value={search.format ?? ''}
          onChange={(v) => go({ format: v || undefined })}
          options={[{ value: '', label: '全部' }, ...(['gif', 'png', 'webp', 'jpeg'] as const).map((f) => ({ value: f, label: f.toUpperCase() }))]}
        />
        <SelectField
          label="衍生图"
          value={search.derived ?? ''}
          onChange={(v) => go({ derived: v || undefined })}
          options={[
            { value: '', label: '全部' },
            { value: 'missing', label: '需生成' },
            { value: 'ready', label: '已就绪' },
          ]}
        />
      </div>

      <BulkBar count={selected.size} unit="张" onClear={done}>
        <Button size="sm" disabled={busy != null} onClick={() => setMoving(sel)}>
          移动到包
        </Button>
        <Button size="sm" disabled={busy != null} onClick={() => run('hide', () => adminEmojiStatusFn({ data: { ids: sel, status: 'hidden' } }), (r) => `已隐藏 ${r.changed} 张`).then(done)}>
          隐藏
        </Button>
        <Button size="sm" disabled={busy != null} onClick={() => run('unhide', () => adminEmojiStatusFn({ data: { ids: sel, status: 'published' } }), (r) => `已恢复 ${r.changed} 张`).then(done)}>
          恢复
        </Button>
        <Button size="sm" disabled={busy != null} onClick={() => run('regen', () => adminRegenerateFn({ data: { ids: sel } }), (r) => `已排队 ${r.queued.length} 张${r.skipped.length ? `，跳过 ${r.skipped.length} 张` : ''}`)}>
          重新生成
        </Button>
        <Button size="sm" className="danger-on-deep" disabled={busy != null} onClick={() => setConfirm(sel)}>
          删除
        </Button>
      </BulkBar>

      {data.rows.length ? (
        <TileGrid size={120} selecting={selecting} className="adm-lib">
          {data.rows.map((e) => (
            <div key={e.id} style={{ position: 'relative' }}>
              <Tile
                poster={e.thumb ?? PLACEHOLDER}
                preview={null}
                alt={`${e.packTitle} · ${e.id}`}
                format={e.format}
                selecting={selecting}
                selected={selected.has(e.id)}
                onOpen={() => (selecting ? setSelected((s) => toggled(s, e.id)) : setOpen(e.id))}
              />
              {e.status !== 'published' || !e.derivedReady ? (
                <span className="tile-st" style={{ position: 'absolute', left: 8, bottom: 8, pointerEvents: 'none' }}>
                  {e.status !== 'published' ? <EmojiStatusPill status={e.status} /> : <Pill tone="warn">待生成</Pill>}
                </span>
              ) : null}
            </div>
          ))}
        </TileGrid>
      ) : (
        <p className="hint">没有符合条件的表情。</p>
      )}
      <Pager page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(page) => go({ page })} />

      <Sheet
        open={open != null}
        onOpenChange={(o) => !o && setOpen(null)}
        title="表情详情"
        subtitle={detail ? <span className="mono">{detail.emoji.id}</span> : undefined}
        footer={
          detail ? (
            <div className="adm-row-acts">
              {detail.emoji.status === 'pending' ? (
                <Button size="sm" icon="check" disabled={busy != null} onClick={() => run('publish1', () => adminPublishEmojisFn({ data: { ids: [detail.emoji.id] } }), (r) => (r.published.length ? '已发布' : '预览还没生成，稍后再试'))}>
                  发布
                </Button>
              ) : (
                <Button size="sm" icon="refresh" disabled={busy != null || detail.emoji.status !== 'published'} onClick={() => run('regen1', () => adminRegenerateFn({ data: { ids: [detail.emoji.id] } }), (r) => (r.queued.length ? '已排队重新生成' : r.skipped[0]?.reason ?? '没有排队'))}>
                  重新生成
                </Button>
              )}
              {detail.emoji.status === 'hidden' ? (
                <Button size="sm" icon="eye" disabled={busy != null} onClick={() => run('unhide1', () => adminEmojiStatusFn({ data: { ids: [detail.emoji.id], status: 'published' } }), '已恢复')}>
                  恢复
                </Button>
              ) : (
                <Button size="sm" icon="eye" disabled={busy != null} onClick={() => run('hide1', () => adminEmojiStatusFn({ data: { ids: [detail.emoji.id], status: 'hidden' } }), '已隐藏')}>
                  隐藏
                </Button>
              )}
              <Button size="sm" icon="trash" variant="danger" disabled={busy != null} onClick={() => setConfirm([detail.emoji.id])}>
                删除
              </Button>
            </div>
          ) : null
        }
      >
        {detail ? <EmojiDetailBody d={detail} onMove={() => setMoving([detail.emoji.id])} /> : <p className="hint">加载中…</p>}
      </Sheet>

      <Modal
        open={confirm != null}
        onOpenChange={(o) => !o && setConfirm(null)}
        icon="trash"
        title="删除选中的表情？"
        actions={
          <>
            <ModalClose render={<Button size="sm" variant="ghost" />}>取消</ModalClose>
            <Button
              size="sm"
              variant="danger"
              disabled={busy != null}
              onClick={async () => {
                const ids = confirm ?? []
                const r = await run('delete', () => adminDeleteEmojisFn({ data: { ids } }), (x) =>
                  x.purgeError ? `已删除 ${x.deleted} 张，但 CDN 缓存清除失败：${x.purgeError}` : x.purgeSkipped ? `已删除 ${x.deleted} 张（未配置 CDN 清除）` : `已删除 ${x.deleted} 张并清除 CDN 缓存`,
                )
                if (r) {
                  done()
                  if (open && ids.includes(open)) setOpen(null)
                }
                setConfirm(null)
              }}
            >
              删除并清除缓存
            </Button>
          </>
        }
      >
        共 {confirm?.length ?? 0} 张。原图、所有版本的衍生图和预览、受影响的 ZIP 都会删除，并清除这些图片的 CDN 缓存。这个操作不能撤销。
      </Modal>

      <MoveDialog
        ids={moving}
        onClose={() => setMoving(null)}
        onMove={async (toPackId) => {
          const ids = moving ?? []
          const r = await run('move', () => adminMoveEmojisFn({ data: { ids, toPackId } }), (x) => `已移动 ${x.moved} 张${x.duplicates.length ? `，${x.duplicates.length} 张与目标包重复，未移动` : ''}`)
          if (r) {
            done()
            setMoving(null)
          }
        }}
      />
    </>
  )
}

function EmojiDetailBody({ d, onMove }: { d: EmojiDetail; onMove: () => void }) {
  const e = d.emoji
  return (
    <>
      <div className="card sand adm-drawer-img">
        <Thumb src={e.thumb} size={200} alt={e.id} />
      </div>
      <dl className="kv">
        <dt>状态</dt>
        <dd>
          <EmojiStatusPill status={e.status} />
        </dd>
        <dt>所属包</dt>
        <dd>
          <AppLink to={`/admin/packs/${e.packId}`}>{e.packTitle}</AppLink>
        </dd>
        <dt>原图</dt>
        <dd className="num">
          {e.format.toUpperCase()} · {e.width ?? '?'}×{e.height ?? '?'} · {e.frames} 帧 · {fmtB(e.bytes)}
        </dd>
        <dt>海报帧</dt>
        <dd className="num">第 {e.posterFrame} 帧</dd>
        <dt>SHA-256</dt>
        <dd className="mono">{e.sha256 ?? '未计算（v1 导入，生成衍生图时补上）'}</dd>
        <dt>存储包</dt>
        <dd className="mono">{e.storagePackKey}（不可变，改归属不搬文件）</dd>
        <dt>版本</dt>
        <dd className="num">r{e.variantRev}</dd>
        <dt>入库</dt>
        <dd className="num">{fmtDateTime(e.createdAt)}</dd>
      </dl>
      <div className="adm-section">
        <h4>对象键</h4>
        <div className="adm-keys">
          {d.keys.map((k) => (
            <div key={k.key}>
              <small>{k.label}</small>
              <code>{k.key}</code>
            </div>
          ))}
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>衍生图</th>
              <th className="n">大小</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>海报 p240</td>
              <td className="n">{e.p240Bytes != null ? fmtB(e.p240Bytes) : '—'}</td>
              <td>{e.status === 'pending' ? <Pill tone={e.p240Bytes != null ? 'info' : 'warn'}>{e.p240Bytes != null ? '待审核预览' : '生成中'}</Pill> : <Pill tone={e.derivedReady ? 'ok' : 'warn'}>{e.derivedReady ? '最新' : '待生成'}</Pill>}</td>
            </tr>
            <tr>
              <td>预览 a160</td>
              <td className="n">{e.a160Bytes != null ? fmtB(e.a160Bytes) : '—'}</td>
              <td>{e.frames > 1 ? <Pill tone={e.derivedReady && e.a160Bytes != null ? 'ok' : 'warn'}>{e.derivedReady && e.a160Bytes != null ? '最新' : '待生成'}</Pill> : <Pill tone="mute">静态图没有</Pill>}</td>
            </tr>
            <tr>
              <td>完整 full</td>
              <td className="n">—</td>
              <td>
                <Pill tone={e.fullReady ? 'ok' : 'mute'}>{e.fullReady ? '已生成' : '首次查看时生成'}</Pill>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="adm-section">
        <h4>其他包里的相同文件</h4>
        {d.duplicates.length ? (
          <ul className="rules">
            {d.duplicates.map((x) => (
              <li key={x.emojiId}>
                <AppLink to={`/admin/packs/${x.packId}`}>{x.packTitle}</AppLink> <span className="mono">{x.emojiId}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="hint">{e.sha256 ? '没有' : '还没有 SHA-256，无法比对'}</span>
        )}
      </div>
      {d.characters.length ? (
        <div className="adm-section">
          <h4>角色</h4>
          <div className="chips">
            {d.characters.map((c) => (
              <span key={c.id} className="chip sm">
                {c.name}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <Button size="sm" icon="arrow" onClick={onMove}>
        移动到其他包
      </Button>
    </>
  )
}

function MoveDialog({ ids, onClose, onMove }: { ids: string[] | null; onClose: () => void; onMove: (packId: number) => void }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<PackListRow[]>([])
  const [pick, setPick] = useState<PackListRow | null>(null)
  useEffect(() => {
    if (!ids) return
    const t = setTimeout(() => {
      adminUploadTargetsFn({ data: { q: q.trim() || undefined } })
        .then((r) => setRows(r.rows))
        .catch(() => setRows([]))
    }, 200)
    return () => clearTimeout(t)
  }, [q, ids])
  return (
    <Modal
      open={ids != null}
      onOpenChange={(o) => {
        if (!o) {
          onClose()
          setPick(null)
        }
      }}
      icon="arrow"
      title="移动到其他表情包"
      actions={
        <div className="adm-section" style={{ width: '100%' }}>
          <Input size="sm" icon="search" placeholder="标题或 packKey" aria-label="搜索目标包" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
          <div className="adm-target-list" style={{ textAlign: 'left' }}>
            {rows.slice(0, 8).map((p) => (
              <button key={p.id} type="button" aria-pressed={pick?.id === p.id} onClick={() => setPick(p)}>
                <Thumb src={p.thumb} size={32} />
                <span style={{ minWidth: 0 }}>
                  <b>{p.title}</b>
                  <small>{p.packKey}</small>
                </span>
              </button>
            ))}
          </div>
          <div className="adm-inline" style={{ justifyContent: 'flex-end' }}>
            <ModalClose render={<Button size="sm" variant="ghost" />}>取消</ModalClose>
            <Button size="sm" variant="primary" disabled={!pick} onClick={() => pick && onMove(pick.id)}>
              移动
            </Button>
          </div>
        </div>
      }
    >
      共 {ids?.length ?? 0} 张。文件不搬动：图片地址保持不变，只是改归属。与目标包里已有的相同文件会被跳过。
    </Modal>
  )
}
