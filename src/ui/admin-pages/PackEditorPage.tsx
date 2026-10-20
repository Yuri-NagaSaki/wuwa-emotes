import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import {
  adminDeleteEmojisFn,
  adminDeletePackFn,
  adminEmojiStatusFn,
  adminPublishEmojisFn,
  adminRebuildZipFn,
  adminRegenerateFn,
  adminReorderFn,
  adminUpdatePackFn,
} from '#/server/admin/fns/content'
import type { PackEditorData, PackStatus, SourceKind } from '#/server/admin/types'
import { LICENSE_LABELS } from '#/server/media/credits'
import { Button, buttonClass } from '../Button'
import { Field, Input, Textarea } from '../Field'
import { fmtB, fmtN } from '../format'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { Modal, ModalClose } from '../Modal'
import { Seg } from '../Seg'
import { Switch } from '../Switch'
import { fmtDateTime, PackStatusPill, PageHead, Panel, Pill, SelectField, toggled, useAction } from './bits'
import { Markdown } from './Markdown'
import { Picker } from './Picker'
import { SortGrid } from './SortGrid'

const layout = getRouteApi('/admin')

type Pack = PackEditorData['pack']
interface Form {
  title: string
  slug: string
  excerpt: string
  descriptionMd: string
  status: PackStatus
  sourceKind: SourceKind
  license: string
  downloadable: boolean
  pinLevel: number
  memorial: boolean
  commissioner: string
  creditsText: string
  sourceUrl: string
  coverEmojiId: string | null
  characterIds: number[]
  artistIds: number[]
  commissionerIds: number[]
  tagIds: number[]
}

const LABELS: Record<keyof Form | 'order', string> = {
  title: '标题',
  slug: 'slug',
  excerpt: '简介',
  descriptionMd: '介绍',
  status: '发布状态',
  sourceKind: '来源',
  license: '许可',
  downloadable: '允许下载',
  pinLevel: '置顶',
  memorial: '纪念',
  commissioner: '约稿人',
  creditsText: '署名补充',
  sourceUrl: '来源链接',
  coverEmojiId: '封面',
  characterIds: '角色',
  artistIds: '画师',
  commissionerIds: '约稿人',
  tagIds: '标签',
  order: '排序',
}

function formOf(p: Pack): Form {
  return {
    title: p.title,
    slug: p.slug,
    excerpt: p.excerpt ?? '',
    descriptionMd: p.descriptionMd ?? '',
    status: p.status,
    sourceKind: p.sourceKind,
    license: p.license,
    downloadable: p.downloadable,
    pinLevel: p.pinLevel,
    memorial: p.memorial,
    commissioner: p.commissioner ?? '',
    creditsText: p.creditsText ?? '',
    sourceUrl: p.sourceUrl ?? '',
    coverEmojiId: p.coverEmojiId,
    characterIds: p.characterIds,
    artistIds: p.artistIds,
    commissionerIds: p.commissionerIds,
    tagIds: p.tagIds,
  }
}

const sameSet = (a: number[], b: number[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join()

function changedKeys(a: Form, b: Form): (keyof Form)[] {
  return (Object.keys(a) as (keyof Form)[]).filter((k) => {
    const x = a[k]
    const y = b[k]
    return Array.isArray(x) && Array.isArray(y) ? !sameSet(x, y) : x !== y
  })
}

export function PackEditorPage({ data }: { data: PackEditorData }) {
  return <Editor key={data.pack.updatedAt} data={data} />
}

function Editor({ data }: { data: PackEditorData }) {
  const { viewer } = layout.useLoaderData()
  const navigate = useNavigate()
  const { run, busy } = useAction()
  const p = data.pack
  const initial = useMemo(() => formOf(p), [p])
  const [form, setForm] = useState<Form>(initial)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))
  const serverOrder = data.emojis.map((e) => e.id)
  const [order, setOrder] = useState<string[]>(serverOrder)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<'edit' | 'preview'>('edit')
  const [confirm, setConfirm] = useState<null | 'delete-emojis' | 'regenerate-all' | 'hard-delete'>(null)
  const [typed, setTyped] = useState('')

  // emojis deleted or added by an action since load: keep the local order of the rest
  const serverKey = serverOrder.join(',')
  useEffect(() => {
    setOrder((cur) => {
      const ids = new Set(serverOrder)
      const kept = cur.filter((id) => ids.has(id))
      return [...kept, ...serverOrder.filter((id) => !kept.includes(id))]
    })
    setSelected((s) => new Set([...s].filter((id) => serverOrder.includes(id))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey])

  const items = useMemo(() => new Map(data.emojis.map((e) => [e.id, e])), [data.emojis])
  const changed = changedKeys(form, initial)
  const orderChanged = order.join(',') !== serverKey
  const dirty = changed.length > 0 || orderChanged
  const official = form.sourceKind === 'official'

  async function save() {
    const patch: Record<string, unknown> = {}
    for (const k of changed) {
      const v = form[k]
      patch[k] = typeof v === 'string' && k !== 'title' && k !== 'slug' && k !== 'license' && k !== 'status' && k !== 'sourceKind' ? v.trim() || null : v
    }
    await run(
      'save',
      async () => {
        let notes: string[] = []
        if (changed.length) notes = (await adminUpdatePackFn({ data: { id: p.id, expectedUpdatedAt: p.updatedAt, patch } })).notes
        if (orderChanged) await adminReorderFn({ data: { packId: p.id, emojiIds: order } })
        return notes
      },
      (notes) => (notes.length ? `已保存。${notes.join('；')}` : '已保存'),
    )
  }

  const sel = [...selected]
  const selRows = sel.map((id) => items.get(id)).filter((e) => e != null)
  const ids = (status?: string) => selRows.filter((e) => !status || e.status === status).map((e) => e.id)
  const clear = () => setSelected(new Set())

  const published = data.emojis.filter((e) => e.status === 'published')
  const animated = published.filter((e) => e.frames > 1)
  const zip = data.zip
  const zipState = !zip.eligible
    ? (['mute', '不生成'] as const)
    : zip.queued
      ? (['info', '排队中'] as const)
      : !zip.objectKey
        ? (['warn', '未生成'] as const)
        : zip.stale
          ? (['warn', '待重建'] as const)
          : (['ok', '已生成'] as const)

  return (
    <>
      <PageHead
        title="编辑表情包"
        sub={
          <>
            <span className="adm-dyn">{p.title}</span> · <span className="mono">{p.packKey}</span>
          </>
        }
        actions={
          <>
            {p.status === 'published' ? (
              <a href={`/packs/${encodeURIComponent(p.slug)}`} target="_blank" rel="noreferrer" className={buttonClass({ size: 'sm' })}>
                <Icon name="eye" />
                前台预览
              </a>
            ) : null}
            <Button size="sm" variant="primary" icon="check" disabled={!dirty || busy != null} onClick={save}>
              保存
            </Button>
          </>
        }
      />

      <div className="cols-2 adm-editor">
        <div className="adm-col">
          <Panel title="基本信息">
            <div className="form-grid">
              <Field label="标题" className="full">
                <Input value={form.title} maxLength={80} onChange={(e) => set('title', e.currentTarget.value)} />
              </Field>
              <Field label="packKey" hint="R2 存储键，创建后不能修改">
                <Input value={p.packKey} readOnly wrapClassName="adm-locked-input" tail={<Icon name="lock" size="sm" />} />
              </Field>
              <Field
                label="URL slug"
                hint={
                  <>
                    修改后旧地址自动 301 到新地址
                    {data.oldSlugs.length ? (
                      <span className="adm-oldslugs">
                        {data.oldSlugs.map((s) => (
                          <span key={s} className="slug-ok">
                            {s}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </>
                }
              >
                <Input value={form.slug} maxLength={100} onChange={(e) => set('slug', e.currentTarget.value.toLowerCase())} />
              </Field>
              <Field label="简介" className="full" aside="列表和卡片上的一句话">
                <Textarea value={form.excerpt} maxLength={300} rows={2} style={{ minHeight: 72 }} onChange={(e) => set('excerpt', e.currentTarget.value)} />
              </Field>
              <Field label="发布状态">
                <Seg
                  size="sm"
                  label="发布状态"
                  value={form.status}
                  onChange={(v) => set('status', v)}
                  options={[
                    { value: 'published', label: '已发布' },
                    { value: 'draft', label: '草稿' },
                    { value: 'hidden', label: '已隐藏' },
                  ]}
                />
              </Field>
              <Field label="置顶级别">
                <Seg
                  size="sm"
                  label="置顶级别"
                  value={String(form.pinLevel) as '0' | '1' | '2' | '3'}
                  onChange={(v) => set('pinLevel', Number(v))}
                  options={[
                    { value: '0', label: '无' },
                    { value: '1', label: '1' },
                    { value: '2', label: '2' },
                    { value: '3', label: '3' },
                  ]}
                />
              </Field>
              <Field label="来源">
                <Seg
                  size="sm"
                  label="来源"
                  value={form.sourceKind}
                  onChange={(v) => setForm((f) => ({ ...f, sourceKind: v, downloadable: v === 'official' ? false : f.downloadable }))}
                  options={[
                    { value: 'community', label: '社区' },
                    { value: 'official', label: '官方转载' },
                  ]}
                />
              </Field>
              <Field label="纪念">
                <div>
                  <Switch checked={form.memorial} onCheckedChange={(v) => set('memorial', v)}>
                    {form.memorial ? '纪念包' : '普通'}
                  </Switch>
                </div>
              </Field>
            </div>
          </Panel>

          <Panel
            title="介绍"
            acts={
              <Seg
                size="sm"
                label="介绍"
                value={preview}
                onChange={setPreview}
                options={[
                  { value: 'edit', label: '编辑' },
                  { value: 'preview', label: '预览' },
                ]}
              />
            }
          >
            {preview === 'edit' ? (
              <Field label="Markdown" aside="支持标题、列表、粗体、斜体、行内代码和链接">
                <Textarea value={form.descriptionMd} rows={6} maxLength={20_000} onChange={(e) => set('descriptionMd', e.currentTarget.value)} />
              </Field>
            ) : form.descriptionMd.trim() ? (
              <Markdown source={form.descriptionMd} />
            ) : (
              <p className="hint">还没有介绍。</p>
            )}
          </Panel>

          <Panel title="分类">
            <div className="form-grid">
              <div className="field full">
                <span className="lab">角色</span>
                <Picker label="角色" addLabel="添加角色" options={data.options.characters} value={form.characterIds} onChange={(v) => set('characterIds', v)} />
              </div>
              <div className="field">
                <span className="lab">画师</span>
                <Picker label="画师" options={data.options.artists} value={form.artistIds} onChange={(v) => set('artistIds', v)} />
              </div>
              <div className="field">
                <span className="lab">约稿人（画师库）</span>
                <Picker label="约稿人" options={data.options.artists} value={form.commissionerIds} onChange={(v) => set('commissionerIds', v)} />
              </div>
              <div className="field full">
                <span className="lab">标签</span>
                <Picker label="标签" addLabel="添加标签" options={data.options.tags} value={form.tagIds} onChange={(v) => set('tagIds', v)} />
              </div>
            </div>
          </Panel>

          <Panel title="署名与许可">
            <div className="form-grid">
              <div className="full set-row">
                <div>
                  <b>允许下载</b>
                  <small>
                    {official ? '官方转载的表情固定只提供预览，不能开启下载。' : '关闭后只提供 WebP 预览；原图、整包和打包清单都不签发。'}
                  </small>
                </div>
                <Switch checked={form.downloadable && !official} disabled={official} onCheckedChange={(v) => set('downloadable', v)} />
              </div>
              <Field label="许可协议">
                <SelectField
                  plain
                  label="许可协议"
                  value={form.license}
                  onChange={(v) => set('license', v || 'unknown')}
                  options={Object.entries(LICENSE_LABELS).map(([value, label]) => ({ value, label }))}
                />
              </Field>
              <Field label="约稿人（文字）" hint="群名、个人名等不在画师库里的署名">
                <Input value={form.commissioner} maxLength={200} onChange={(e) => set('commissioner', e.currentTarget.value)} />
              </Field>
              <Field label="来源链接" className="full">
                <Input value={form.sourceUrl} maxLength={500} placeholder="https://" onChange={(e) => set('sourceUrl', e.currentTarget.value)} />
              </Field>
              <Field label="署名补充" className="full" hint="众筹名单、致谢等；写入 ZIP 里的 CREDITS.txt">
                <Textarea value={form.creditsText} rows={3} maxLength={4000} style={{ minHeight: 80 }} onChange={(e) => set('creditsText', e.currentTarget.value)} />
              </Field>
            </div>
          </Panel>

          <Panel
            title={`表情 · ${fmtN(data.emojis.length)} 张`}
            acts={
              <>
                <span className="hint">拖动或用键盘排序 · 星标为封面</span>
                <AppLink to={`/admin/upload?pack=${p.id}`} className={buttonClass({ size: 'xs' })}>
                  <Icon name="upload" />
                  上传
                </AppLink>
              </>
            }
          >
            {selected.size ? (
              <div className="bulk" role="toolbar" aria-label="表情操作" style={{ marginBottom: 12 }}>
                <span>
                  <b>{selected.size}</b> 张已选
                </span>
                <Button size="sm" disabled={selRows.length !== 1 || selRows[0]?.status !== 'published'} onClick={() => set('coverEmojiId', sel[0]!)}>
                  设为封面
                </Button>
                {ids('pending').length ? (
                  <Button
                    size="sm"
                    disabled={busy != null}
                    onClick={() =>
                      run('publish', () => adminPublishEmojisFn({ data: { ids: ids('pending') } }), (r) =>
                        r.waiting.length ? `已发布 ${r.published.length} 张，${r.waiting.length} 张的预览还在生成` : `已发布 ${r.published.length} 张`,
                      ).then(clear)
                    }
                  >
                    发布
                  </Button>
                ) : null}
                {ids('published').length + ids('pending').length ? (
                  <Button size="sm" disabled={busy != null} onClick={() => run('hide', () => adminEmojiStatusFn({ data: { ids: sel, status: 'hidden' } }), (r) => `已隐藏 ${r.changed} 张`).then(clear)}>
                    隐藏
                  </Button>
                ) : null}
                {ids('hidden').length ? (
                  <Button size="sm" disabled={busy != null} onClick={() => run('unhide', () => adminEmojiStatusFn({ data: { ids: ids('hidden'), status: 'published' } }), (r) => `已恢复 ${r.changed} 张`).then(clear)}>
                    恢复
                  </Button>
                ) : null}
                {ids('published').length ? (
                  <Button
                    size="sm"
                    disabled={busy != null}
                    onClick={() => run('regen', () => adminRegenerateFn({ data: { ids: ids('published') } }), (r) => `已排队 ${r.queued.length} 张${r.skipped.length ? `，跳过 ${r.skipped.length} 张` : ''}`)}
                  >
                    重新生成
                  </Button>
                ) : null}
                <Button size="sm" className="danger-on-deep" disabled={busy != null} onClick={() => setConfirm('delete-emojis')}>
                  删除
                </Button>
                <button type="button" className="btn sm ghost adm-bulk-clear" onClick={clear}>
                  取消选择
                </button>
              </div>
            ) : null}
            {data.emojis.length ? (
              <SortGrid items={items} order={order} onOrder={setOrder} coverId={form.coverEmojiId} selected={selected} onToggle={(id) => setSelected((s) => toggled(s, id))} />
            ) : (
              <p className="hint">这个包还没有表情。到上传中心把图片传到这里。</p>
            )}
            <p className="hint" style={{ marginTop: 10 }}>
              隐藏只是不在前台显示，旧的 /img 地址在 CDN 上仍可访问；版权下架请用「删除」，会删除原图、所有衍生图和 ZIP，并清除 CDN 缓存。
            </p>
          </Panel>

          {dirty ? (
            <div className="savebar" role="status">
              <span className="grow">
                有 {changed.length + (orderChanged ? 1 : 0)} 处未保存的修改：{[...new Set([...changed.map((k) => LABELS[k]), ...(orderChanged ? [LABELS.order] : [])])].join('、')}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setForm(initial)
                  setOrder(serverOrder)
                }}
              >
                放弃
              </Button>
              <Button size="sm" variant="primary" icon="check" disabled={busy != null} onClick={save}>
                保存
              </Button>
            </div>
          ) : null}
        </div>

        <aside className="adm-col">
          <Panel title="概况">
            <dl className="kv">
              <dt>状态</dt>
              <dd>
                <PackStatusPill status={p.status} />
              </dd>
              <dt>所有者</dt>
              <dd>{p.ownerName ?? '—'}</dd>
              <dt>创建</dt>
              <dd className="num">{fmtDateTime(p.createdAt)}</dd>
              <dt>发布</dt>
              <dd className="num">{fmtDateTime(p.publishedAt)}</dd>
              <dt>下载 / 收藏</dt>
              <dd className="num">
                {fmtN(p.downloadCount)} / {fmtN(p.favoriteCount)}
              </dd>
            </dl>
          </Panel>

          <Panel title="下载包 ZIP">
            <dl className="kv">
              <dt>状态</dt>
              <dd>
                <Pill tone={zipState[0]}>{zipState[1]}</Pill>
              </dd>
              {zip.objectKey ? (
                <>
                  <dt>大小</dt>
                  <dd className="num">{zip.bytes != null ? fmtB(zip.bytes) : '—'}</dd>
                  <dt>生成于</dt>
                  <dd className="num">{fmtDateTime(zip.builtAt)}</dd>
                  <dt>对象键</dt>
                  <dd className="mono">{zip.objectKey}</dd>
                </>
              ) : null}
            </dl>
            {!zip.eligible ? <p className="hint" style={{ marginTop: 8 }}>只有已发布、允许下载并且有已发布表情的包才生成 ZIP。</p> : null}
            <div style={{ marginTop: 12 }}>
              <Button size="sm" block icon="refresh" disabled={!zip.eligible || zip.queued || busy != null} onClick={() => run('zip', () => adminRebuildZipFn({ data: { id: p.id } }), '已排队重建 ZIP')}>
                重新生成
              </Button>
            </div>
          </Panel>

          <Panel title="衍生图">
            <dl className="kv">
              <dt>海报 p240</dt>
              <dd>
                <Pill tone={published.every((e) => e.derivedReady) ? 'ok' : 'warn'}>
                  {published.filter((e) => e.derivedReady).length} / {published.length}
                </Pill>
              </dd>
              <dt>动图预览 a160</dt>
              <dd>
                {animated.length ? (
                  <Pill tone={animated.every((e) => e.derivedReady && e.a160Bytes != null) ? 'ok' : 'warn'}>
                    {animated.filter((e) => e.derivedReady && e.a160Bytes != null).length} / {animated.length}
                  </Pill>
                ) : (
                  <Pill tone="mute">没有动图</Pill>
                )}
              </dd>
              <dt>弹窗动图 full</dt>
              <dd>
                <Pill tone="mute">
                  {published.filter((e) => e.fullReady).length} / {published.length} · 首次查看时生成
                </Pill>
              </dd>
            </dl>
            <div style={{ marginTop: 12 }}>
              <Button size="sm" block icon="refresh" disabled={!published.length || busy != null} onClick={() => setConfirm('regenerate-all')}>
                全部重新生成
              </Button>
            </div>
          </Panel>

          <Panel title="危险操作">
            <div style={{ display: 'grid', gap: 8 }}>
              {p.status !== 'hidden' ? (
                <Button size="sm" block icon="eye" disabled={busy != null} onClick={() => run('hide-pack', () => adminDeletePackFn({ data: { id: p.id, hard: false } }), '已隐藏这个包')}>
                  隐藏此包
                </Button>
              ) : null}
              {viewer?.role === 'admin' ? (
                <Button size="sm" block icon="trash" variant="danger" onClick={() => setConfirm('hard-delete')}>
                  彻底删除
                </Button>
              ) : (
                <span className="hint">彻底删除（连同文件）只有站长可以操作。</span>
              )}
            </div>
          </Panel>
        </aside>
      </div>

      <Modal
        open={confirm === 'delete-emojis'}
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
                const r = await run('delete', () => adminDeleteEmojisFn({ data: { ids: sel } }), (x) =>
                  x.purgeError ? `已删除 ${x.deleted} 张，但 CDN 缓存清除失败：${x.purgeError}` : x.purgeSkipped ? `已删除 ${x.deleted} 张（未配置 CDN 清除）` : `已删除 ${x.deleted} 张并清除 CDN 缓存`,
                )
                if (r) clear()
                setConfirm(null)
              }}
            >
              删除并清除缓存
            </Button>
          </>
        }
      >
        共 {selected.size} 张。原图、所有版本的衍生图、待审核预览和受影响的 ZIP 都会删除，并按 URL 清除 CDN 缓存。已经下载到访客设备上的副本无法收回。这个操作不能撤销。
      </Modal>

      <Modal
        open={confirm === 'regenerate-all'}
        onOpenChange={(o) => !o && setConfirm(null)}
        icon="refresh"
        title="重新生成全部衍生图？"
        actions={
          <>
            <ModalClose render={<Button size="sm" variant="ghost" />}>取消</ModalClose>
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                await run('regen-all', () => adminRegenerateFn({ data: { packId: p.id } }), (r) => `已排队 ${r.queued.length} 张${r.skipped.length ? `，跳过 ${r.skipped.length} 张` : ''}`)
                setConfirm(null)
              }}
            >
              重新生成
            </Button>
          </>
        }
      >
        {published.length} 张已发布表情的版本号会加 1，网页地址随之更换；worker 逐张生成海报和动图预览，完成前前台显示占位。
      </Modal>

      <Modal
        open={confirm === 'hard-delete'}
        onOpenChange={(o) => {
          if (!o) {
            setConfirm(null)
            setTyped('')
          }
        }}
        icon="warn"
        title="彻底删除这个表情包？"
        actions={
          <div className="adm-section" style={{ width: '100%' }}>
            <Field label={`输入 packKey「${p.packKey}」确认`}>
              <Input value={typed} onChange={(e) => setTyped(e.currentTarget.value)} autoComplete="off" />
            </Field>
            <div className="adm-inline" style={{ justifyContent: 'flex-end' }}>
              <ModalClose render={<Button size="sm" variant="ghost" />}>取消</ModalClose>
              <Button
                size="sm"
                variant="danger"
                disabled={typed !== p.packKey || busy != null}
                onClick={async () => {
                  const r = await run('hard-delete', () => adminDeletePackFn({ data: { id: p.id, hard: true } }), (x) =>
                    x.purgeError ? `已删除，但 CDN 缓存清除失败：${x.purgeError}` : `已删除 ${x.deletedObjects} 个对象`,
                  )
                  if (r) void navigate({ to: '/admin/packs' })
                }}
              >
                彻底删除
              </Button>
            </div>
          </div>
        }
      >
        {fmtN(data.emojis.length)} 张表情的原图、衍生图、预览和这个包的 ZIP 会全部删除，CDN 缓存一并清除，包里的投稿记录也会删除。不想删文件的话，用「隐藏此包」。
      </Modal>
    </>
  )
}
