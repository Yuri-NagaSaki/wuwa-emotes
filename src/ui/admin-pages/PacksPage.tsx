import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { adminCreatePackFn, adminPacksStatusFn } from '#/server/admin/fns/content'
import type { PackListData, PackStatus } from '#/server/admin/types'
import { Button, buttonClass } from '../Button'
import { Tag } from '../Chip'
import { Check, Field, Input } from '../Field'
import { fmtN, fmtW } from '../format'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { Modal, ModalClose } from '../Modal'
import { BulkBar, fmtDay, PackStatusPill, PageHead, Pager, Panel, SelectField, Thumb, toggled, useAction } from './bits'
import { swatch } from './swatch'

export interface PacksSearch {
  q?: string
  status?: PackStatus
  kind?: 'animated' | 'static' | 'mixed'
  source?: 'community' | 'official'
  sort?: 'updated' | 'created' | 'title' | 'downloads'
  page?: number
}

const KIND_LABEL = { animated: '动图', static: '静态', mixed: '混合' } as const

export function PacksPage({ data, search }: { data: PackListData; search: PacksSearch }) {
  const navigate = useNavigate()
  const { run, busy } = useAction()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [q, setQ] = useState(search.q ?? '')

  const go = (patch: Partial<PacksSearch>) => {
    setSelected(new Set())
    void navigate({ to: '/admin/packs', search: { ...search, page: undefined, ...patch } })
  }

  async function create(e: FormEvent) {
    e.preventDefault()
    const r = await run('create', () => adminCreatePackFn({ data: { title } }), '已新建草稿')
    if (r) {
      setCreating(false)
      setTitle('')
      void navigate({ to: '/admin/packs/$id', params: { id: String(r.id) } })
    }
  }

  async function bulk(status: PackStatus) {
    const ids = [...selected]
    const label = status === 'published' ? '发布' : status === 'hidden' ? '隐藏' : '转为草稿'
    const r = await run(`bulk-${status}`, () => adminPacksStatusFn({ data: { ids, status } }), (x) => `已${label} ${x.changed} 个包`)
    if (r) setSelected(new Set())
  }

  const allOnPage = data.rows.length > 0 && data.rows.every((r) => selected.has(r.id))
  const { counts } = data

  return (
    <>
      <PageHead
        title="表情包"
        sub={`${fmtN(counts.published)} 个已发布 · ${fmtN(counts.draft)} 个草稿 · ${fmtN(counts.hidden)} 个已隐藏`}
        actions={
          <>
            <AppLink to="/admin/upload" className={buttonClass({ size: 'sm' })}>
              <Icon name="upload" />
              上传表情
            </AppLink>
            <Button size="sm" variant="primary" icon="plus" onClick={() => setCreating(true)}>
              新建表情包
            </Button>
          </>
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
          <Input size="sm" icon="search" wrapClassName="adm-search" placeholder="标题、packKey、角色、画师" aria-label="搜索表情包" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        </form>
        <SelectField
          label="状态"
          value={search.status ?? ''}
          onChange={(v) => go({ status: v || undefined })}
          options={[
            { value: '', label: '全部' },
            { value: 'published', label: '已发布' },
            { value: 'draft', label: '草稿' },
            { value: 'hidden', label: '已隐藏' },
          ]}
        />
        <SelectField
          label="类型"
          value={search.kind ?? ''}
          onChange={(v) => go({ kind: v || undefined })}
          options={[
            { value: '', label: '全部' },
            { value: 'animated', label: '动图' },
            { value: 'static', label: '静态' },
            { value: 'mixed', label: '混合' },
          ]}
        />
        <SelectField
          label="来源"
          value={search.source ?? ''}
          onChange={(v) => go({ source: v || undefined })}
          options={[
            { value: '', label: '全部' },
            { value: 'community', label: '社区' },
            { value: 'official', label: '官转' },
          ]}
        />
        <SelectField
          label="排序"
          value={search.sort && search.sort !== 'updated' ? search.sort : ''}
          onChange={(v) => go({ sort: v || undefined })}
          options={[
            { value: '', label: '更新时间' },
            { value: 'created', label: '创建时间' },
            { value: 'title', label: '标题' },
            { value: 'downloads', label: '下载量' },
          ]}
        />
      </div>

      <BulkBar count={selected.size} unit="个" onClear={() => setSelected(new Set())}>
        <Button size="sm" disabled={busy != null} onClick={() => bulk('published')}>
          发布
        </Button>
        <Button size="sm" disabled={busy != null} onClick={() => bulk('hidden')}>
          隐藏
        </Button>
        <Button size="sm" disabled={busy != null} onClick={() => bulk('draft')}>
          转为草稿
        </Button>
      </BulkBar>

      <Panel title="列表" flush acts={<span className="hint">共 {fmtN(data.total)} 个</span>}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <Check checked={allOnPage} onChange={(v) => setSelected(v ? new Set(data.rows.map((r) => r.id)) : new Set())}>
                    <span className="sr">全选本页</span>
                  </Check>
                </th>
                <th>表情包</th>
                <th className="col-opt">角色</th>
                <th className="n">张数</th>
                <th>状态</th>
                <th className="n col-opt">下载</th>
                <th className="col-opt">更新</th>
                <th>
                  <span className="sr">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr className="adm-empty-row">
                  <td colSpan={8}>没有符合条件的表情包</td>
                </tr>
              ) : null}
              {data.rows.map((p) => (
                <tr key={p.id} className={selected.has(p.id) ? 'is-sel' : undefined}>
                  <td>
                    <Check checked={selected.has(p.id)} onChange={() => setSelected((s) => toggled(s, p.id))}>
                      <span className="sr">选择 {p.title}</span>
                    </Check>
                  </td>
                  <td>
                    <div className="cell">
                      <Thumb src={p.thumb} className="th-img" />
                      <div style={{ minWidth: 0 }}>
                        <AppLink to={`/admin/packs/${p.id}`}>
                          <b>{p.title}</b>
                        </AppLink>
                        <small>{p.packKey}</small>
                      </div>
                    </div>
                  </td>
                  <td className="col-opt">
                    <div className="tags">
                      {p.characters.slice(0, 2).map((c) => (
                        <Tag key={c.name} color={c.color ? swatch(c.color) : undefined}>
                          {c.name}
                        </Tag>
                      ))}
                      {p.characters.length > 2 ? <Tag color="var(--tp-line-2)">+{p.characters.length - 2}</Tag> : null}
                    </div>
                  </td>
                  <td className="n">
                    {fmtN(p.emojiCount)}
                    {p.totalEmojis !== p.emojiCount ? <span className="sub">共 {fmtN(p.totalEmojis)}</span> : null}
                  </td>
                  <td>
                    <div className="tags">
                      <PackStatusPill status={p.status} />
                      {p.pendingEmojis ? <span className="st warn">{p.pendingEmojis} 张待审</span> : null}
                      {p.sourceKind === 'official' ? <span className="st mute">官转</span> : null}
                    </div>
                  </td>
                  <td className="n col-opt">{fmtW(p.downloadCount)}</td>
                  <td className="col-opt muted">{fmtDay(p.updatedAt)}</td>
                  <td>
                    <div className="row-acts">
                      <AppLink to={`/admin/packs/${p.id}`} className="ibtn" aria-label={`编辑 ${p.title}`} title="编辑">
                        <Icon name="edit" />
                      </AppLink>
                      {p.status === 'published' ? (
                        <a href={`/packs/${encodeURIComponent(p.slug)}`} className="ibtn" aria-label={`在前台查看 ${p.title}`} title="前台预览" target="_blank" rel="noreferrer">
                          <Icon name="eye" />
                        </a>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(page) => go({ page })} />
      </Panel>
      <p className="hint">packKey 是 R2 存储键，创建后不变；类型（{Object.values(KIND_LABEL).join(' / ')}）按包内表情判断。</p>

      <Modal
        open={creating}
        onOpenChange={setCreating}
        icon="plus"
        title="新建表情包"
        actions={
          <form onSubmit={create} className="adm-section" style={{ width: '100%' }}>
            <Field label="标题" hint="先建成草稿，之后在编辑页补全信息、上传表情、发布。">
              <Input value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={80} required autoFocus />
            </Field>
            <div className="adm-inline" style={{ justifyContent: 'flex-end' }}>
              <ModalClose render={<Button variant="ghost" size="sm" />}>取消</ModalClose>
              <Button type="submit" variant="primary" size="sm" disabled={!title.trim() || busy === 'create'}>
                新建草稿
              </Button>
            </div>
          </form>
        }
      />
    </>
  )
}
