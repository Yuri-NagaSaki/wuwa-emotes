import { useNavigate, useRouter } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { adminCancelJobFn, adminRetryJobFn, adminSaveSiteFn } from '#/server/admin/fns/system'
import type { AuditEntry, JobRow, JobsData, Json, Paged, SettingsData, StorageData } from '#/server/admin/types'
import { Button } from '../Button'
import { Field, Input, Textarea } from '../Field'
import { fmtB, fmtN, fmtW } from '../format'
import { Icon, type IconName } from '../Icon'
import { Tabs, TabPanel } from '../Tabs'
import { toast } from '../Toast'
import { actionLabel, ACTION_LABELS, auditIcon, roleName, TARGET_LABELS, targetText } from './audit-format'
import { errorText, fmtAgo, fmtDateTime, Kpi, PageHead, Pager, Panel, Pill, SelectField, useAction } from './bits'

// 存储 · 任务队列 · 审计日志 · 系统设置 (站长 only).

// ---------- 存储 ----------

const GROUP_COLOR: Record<string, string> = {
  originals: 'var(--tp-teal)',
  p240: 'var(--c-purple)',
  a160: 'var(--c-blue)',
  full: 'var(--c-pink)',
  review: 'var(--c-orange)',
  zips: 'var(--c-yellow)',
  uploads: 'var(--c-brown)',
}
const GROUP_ICON: Record<string, IconName> = { originals: 'folder', p240: 'image', a160: 'image', full: 'image', review: 'eye', zips: 'box', uploads: 'upload', old: 'history' }

export function StoragePage({ data }: { data: StorageData }) {
  const sized = data.groups.filter((g) => g.bytes != null && g.bytes > 0)
  const total = sized.reduce((a, g) => a + (g.bytes ?? 0), 0)
  return (
    <>
      <PageHead
        title="存储"
        sub={
          <>
            单桶 <span className="mono">{data.bucket}</span> · {data.endpointHost} · 网页图片经 /img 由 CDN 缓存，原图与 ZIP 用签名链接
          </>
        }
      />
      <Panel title="用量" acts={<span className="hint">按数据库记录汇总，不列举整个桶</span>}>
        <div className="usage">
          <div className="bar" role="img" aria-label={`已记录对象合计 ${fmtB(total)}`}>
            {sized.map((g) => (
              <i key={g.key} style={{ width: `${Math.max(0.6, ((g.bytes ?? 0) / Math.max(1, total)) * 100)}%`, background: GROUP_COLOR[g.key] }} title={`${g.label} ${fmtB(g.bytes ?? 0)}`} />
            ))}
          </div>
          <div className="lg">
            {sized.map((g) => (
              <span key={g.key}>
                <i style={{ background: GROUP_COLOR[g.key] }} />
                {g.label} {fmtB(g.bytes ?? 0)}
              </span>
            ))}
          </div>
          <span className="hint">合计 {fmtB(total)}。备份（backups/postgres/）与 v1 快照（meta/v1/、sync/v1/）不在数据库里，没有计入。</span>
        </div>
      </Panel>

      <div className="cols-2">
        <Panel title="前缀" flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>前缀</th>
                  <th className="n">对象</th>
                  <th className="n">大小</th>
                  <th className="col-opt">说明</th>
                </tr>
              </thead>
              <tbody>
                {data.groups.map((g) => (
                  <tr key={g.key}>
                    <td>
                      <div className="cell">
                        <Icon name={GROUP_ICON[g.key] ?? 'folder'} size="sm" />
                        <div style={{ minWidth: 0 }}>
                          <b>{g.label}</b>
                          <small>{g.prefix}</small>
                        </div>
                      </div>
                    </td>
                    <td className="n">{fmtN(g.objects)}</td>
                    <td className="n">{g.bytes == null ? '未记录' : fmtB(g.bytes)}</td>
                    <td className="col-opt muted">{g.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <div style={{ display: 'grid', gap: 18 }}>
          <Panel title="R2 读操作（本月估算）">
            <div className="stats">
              <div className="stat">
                <b>{fmtW(data.r2Reads.month)}</b>
                <span>本月签发次数</span>
              </div>
              <div className="stat">
                <b>{data.r2Reads.threshold ? fmtW(data.r2Reads.threshold) : '未设'}</b>
                <span>告警阈值</span>
              </div>
            </div>
            <ul className="rules" style={{ marginTop: 12 }}>
              {data.r2Reads.byKind.length ? (
                data.r2Reads.byKind.map((k) => (
                  <li key={k.kind}>
                    {{ orig: '单张原图', batch_item: '打包清单中的单张', zip: '整包 ZIP' }[k.kind] ?? k.kind}：{fmtN(k.n)} 次
                  </li>
                ))
              ) : (
                <li>本月还没有原图或 ZIP 签发。</li>
              )}
              <li>按「原图与 ZIP 签发次数」估算，每小时汇总；/img 回源次数不在其中。阈值在「下载与风控」里设置。</li>
            </ul>
          </Panel>
          <Panel title="生命周期与只读前缀">
            <div className="rule-row">
              <div>
                <b>uploads/tmp/ 7 天、backups/ 30 天</b>
                <small>R2 生命周期规则，在 Cloudflare 控制台配置；这里无法读取，请定期核对</small>
              </div>
              <Pill tone="mute">需人工核对</Pill>
            </div>
            <div className="rule-row">
              <div>
                <b>meta/v1/、sync/v1/、assets/v1/packs/*/pack.json</b>
                <small>v1 快照，只作导入来源，应用不写入</small>
              </div>
              <Pill tone="info">只读</Pill>
            </div>
            <div className="rule-row">
              <div>
                <b>对象写入后不搬动</b>
                <small>表情改归属时 storage_pack_key 不变；删除表情时按对象逐个删除</small>
              </div>
              <Pill tone="ok">规则</Pill>
            </div>
          </Panel>
        </div>
      </div>

      <Panel title="占用最多的存储目录" flush acts={<span className="hint">按入库时的包（storage_pack_key）</span>}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>目录</th>
                <th className="n">原图</th>
                <th className="n">大小</th>
              </tr>
            </thead>
            <tbody>
              {data.topPacks.map((t) => (
                <tr key={t.packKey}>
                  <td>
                    <div className="cell">
                      <div style={{ minWidth: 0 }}>
                        <b>{t.title ?? '（包已删除或改名）'}</b>
                        <small>assets/v1/packs/{t.packKey}/</small>
                      </div>
                    </div>
                  </td>
                  <td className="n">{fmtN(t.objects)}</td>
                  <td className="n">{fmtB(t.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}

// ---------- 任务队列 ----------

const QUEUE_LABEL: Record<string, string> = {
  'media.ingest': '上传校验入库',
  'media.derive': '海报与预览',
  'media.full': '弹窗动图 full',
  'zip.build': '整包 ZIP',
  'stats.rollup': '下载计数汇总',
  'db.backup': '数据库备份',
  'cleanup.daily': '每日清理',
  'r2.alert': 'R2 读操作告警',
}

function jobTarget(j: JobRow): string {
  const d = j.data
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    const o = d as Record<string, Json>
    if (o.emojiId) return `表情 ${String(o.emojiId)}${o.target ? ` → ${String(o.target)}` : ''}`
    if (o.packId != null) return `包 #${String(o.packId)}`
    if (o.uploadItemId) return `上传 ${String(o.uploadItemId).slice(0, 8)}…`
  }
  return '—'
}

function jobError(j: JobRow): string | null {
  const o = j.output
  if (!o) return null
  if (typeof o === 'string') return o
  if (typeof o === 'object' && !Array.isArray(o)) {
    const m = (o as Record<string, Json>).message
    if (typeof m === 'string') return m
  }
  return JSON.stringify(o).slice(0, 200)
}

function duration(j: JobRow): string {
  if (!j.startedOn) return '—'
  const end = j.completedOn ? new Date(j.completedOn).getTime() : Date.now()
  const s = Math.max(0, Math.round((end - new Date(j.startedOn).getTime()) / 1000))
  return s < 60 ? `${s} 秒` : `${Math.round(s / 60)} 分钟`
}

export function JobsPage({ data }: { data: JobsData }) {
  const { run, busy } = useAction()
  const router = useRouter()
  const sum = (k: keyof JobsData['queues'][number]['counts']) => data.queues.reduce((a, q) => a + q.counts[k], 0)
  const STATE: Record<string, [string, 'info' | 'mute' | 'warn']> = { active: ['运行中', 'info'], created: ['排队', 'mute'], retry: ['等待重试', 'warn'] }
  return (
    <>
      <PageHead
        title="任务队列"
        sub={`pg-boss · 计数直接取自任务表 · 更新于 ${fmtDateTime(data.generatedAt)}`}
        actions={
          <Button size="sm" icon="refresh" onClick={() => void router.invalidate()}>
            刷新
          </Button>
        }
      />
      <div className="kpis">
        <Kpi icon="play2" label="运行中" value={fmtN(sum('active'))} />
        <Kpi icon="clock" label="排队" value={fmtN(sum('created') + sum('retry'))} note={sum('retry') ? `其中 ${sum('retry')} 个等待重试` : undefined} />
        <Kpi icon="check" label="已完成" value={fmtN(sum('completed'))} note="仍在保留期内的任务" />
        <Kpi icon="warn" label="失败" value={fmtN(sum('failed'))} note={sum('failed') ? '可重试' : '没有失败的任务'} alert={sum('failed') > 0} />
      </div>

      <Panel title="队列" flush>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>队列</th>
                <th className="col-opt">策略</th>
                <th className="n">排队</th>
                <th className="n">运行中</th>
                <th className="n col-opt">已完成</th>
                <th className="n">失败</th>
              </tr>
            </thead>
            <tbody>
              {data.queues.map((q) => (
                <tr key={q.name}>
                  <td>
                    <div className="cell">
                      <div>
                        <b>{QUEUE_LABEL[q.name] ?? q.name}</b>
                        <small>{q.name}</small>
                      </div>
                    </div>
                  </td>
                  <td className="col-opt muted">{q.policy ?? '—'}</td>
                  <td className="n">{fmtN(q.counts.created + q.counts.retry)}</td>
                  <td className="n">{fmtN(q.counts.active)}</td>
                  <td className="n col-opt">{fmtN(q.counts.completed)}</td>
                  <td className="n">{q.counts.failed ? <span className="adm-err">{fmtN(q.counts.failed)}</span> : '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="最近失败的任务" flush>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>队列</th>
                <th>对象</th>
                <th>错误</th>
                <th className="col-opt">结束</th>
                <th className="n col-opt">重试</th>
                <th>
                  <span className="sr">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!data.failed.length ? (
                <tr className="adm-empty-row">
                  <td colSpan={6}>没有失败的任务</td>
                </tr>
              ) : null}
              {data.failed.map((j) => (
                <tr key={j.id}>
                  <td className="mono">{j.name}</td>
                  <td>{jobTarget(j)}</td>
                  <td>
                    <span className="adm-err">{jobError(j) ?? '—'}</span>
                  </td>
                  <td className="col-opt muted">{fmtAgo(j.completedOn)}</td>
                  <td className="n col-opt">
                    {j.retryCount} / {j.retryLimit}
                  </td>
                  <td>
                    <div className="row-acts">
                      <button type="button" className="ibtn" aria-label="重试" title="重试" disabled={busy != null} onClick={() => run(`retry-${j.id}`, () => adminRetryJobFn({ data: { name: j.name, id: j.id } }), '已重新排队')}>
                        <Icon name="refresh" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="排队与运行中" flush>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>队列</th>
                <th>对象</th>
                <th>状态</th>
                <th className="col-opt">创建</th>
                <th className="col-opt">耗时</th>
                <th>
                  <span className="sr">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!data.active.length ? (
                <tr className="adm-empty-row">
                  <td colSpan={6}>队列是空的</td>
                </tr>
              ) : null}
              {data.active.map((j) => {
                const [label, tone] = STATE[j.state] ?? [j.state, 'mute']
                return (
                  <tr key={j.id}>
                    <td className="mono">{j.name}</td>
                    <td>{jobTarget(j)}</td>
                    <td>
                      <Pill tone={tone} run={j.state === 'active'}>
                        {label}
                      </Pill>
                    </td>
                    <td className="col-opt muted">{fmtAgo(j.createdOn)}</td>
                    <td className="col-opt">{duration(j)}</td>
                    <td>
                      <div className="row-acts">
                        <button type="button" className="ibtn" aria-label="取消" title="取消" disabled={busy != null} onClick={() => run(`cancel-${j.id}`, () => adminCancelJobFn({ data: { name: j.name, id: j.id } }), '已取消')}>
                          <Icon name="close" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="定时任务">
        {data.schedules.map((s) => (
          <div key={`${s.name}:${s.key}`} className="rule-row">
            <div>
              <b>{QUEUE_LABEL[s.name] ?? s.name}</b>
              <small className="mono">
                {s.cron} · {s.timezone}
              </small>
            </div>
            <span className="hint">{s.nextRuns[0] ? `下次 ${fmtDateTime(s.nextRuns[0])}` : '—'}</span>
          </div>
        ))}
        <p className="hint" style={{ marginTop: 8 }}>
          ZIP 不定时重建：只在包发布、内容或署名变化时排队，文件按内容哈希命名。
        </p>
      </Panel>
    </>
  )
}

// ---------- 审计日志 ----------

export interface AuditSearch {
  actor?: string
  action?: string
  targetType?: string
  targetId?: string
  from?: string
  to?: string
  page?: number
}

function DiffView({ diff }: { diff: Json }) {
  if (diff == null) return null
  if (typeof diff === 'object' && !Array.isArray(diff)) {
    const entries = Object.entries(diff)
    const pairs = entries.every(([, v]) => Array.isArray(v) && v.length === 2)
    if (pairs && entries.length) {
      return (
        <div className="diff adm-diff">
          {entries.map(([k, v]) => {
            const [a, b] = v as [Json, Json]
            const show = (x: Json) => (typeof x === 'string' ? x : JSON.stringify(x))
            return (
              <div key={k}>
                <span className="k">{k}：</span>
                <span className="del">{show(a) || '（空）'}</span> → <span className="add">{show(b) || '（空）'}</span>
              </div>
            )
          })}
        </div>
      )
    }
  }
  return (
    <div className="diff adm-diff">
      <pre>{JSON.stringify(diff, null, 2)}</pre>
    </div>
  )
}

export function AuditPage({ data, search, actions }: { data: Paged<AuditEntry>; search: AuditSearch; actions: string[] }) {
  const navigate = useNavigate()
  const [actor, setActor] = useState(search.actor ?? '')
  const [target, setTarget] = useState(search.targetId ?? '')
  const [openId, setOpenId] = useState<number | null>(null)
  const go = (patch: Partial<AuditSearch>) => void navigate({ to: '/admin/audit', search: { ...search, page: undefined, ...patch } })
  return (
    <>
      <PageHead title="审计日志" sub="后台的每次写操作都会记录操作人、当时的角色和改动内容" />
      <div className="filters">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            go({ actor: actor.trim() || undefined, targetId: target.trim() || undefined })
          }}
          className="adm-inline"
        >
          <Input size="sm" icon="user" wrapClassName="adm-search adm-audit-q" placeholder="操作人：名称、邮箱或 ID" aria-label="按操作人筛选" value={actor} onChange={(e) => setActor(e.currentTarget.value)} />
          <Input size="sm" icon="hash" wrapClassName="adm-search adm-audit-q" placeholder="对象 ID" aria-label="按对象 ID 筛选" value={target} onChange={(e) => setTarget(e.currentTarget.value)} />
          <button type="submit" className="sr">
            筛选
          </button>
        </form>
        <SelectField
          label="动作"
          value={search.action ?? ''}
          onChange={(v) => go({ action: v || undefined })}
          options={[{ value: '', label: '全部' }, ...[...new Set([...actions])].sort().map((a) => ({ value: a, label: ACTION_LABELS[a] ?? a }))]}
        />
        <SelectField
          label="对象"
          value={search.targetType ?? ''}
          onChange={(v) => go({ targetType: v || undefined })}
          options={[{ value: '', label: '全部' }, ...Object.entries(TARGET_LABELS).map(([value, label]) => ({ value, label }))]}
        />
        <div className="input sm adm-select adm-date">
          <span className="adm-select-l">从</span>
          <input type="date" aria-label="开始日期" value={search.from ?? ''} onChange={(e) => go({ from: e.currentTarget.value || undefined })} />
        </div>
        <div className="input sm adm-select adm-date">
          <span className="adm-select-l">到</span>
          <input type="date" aria-label="结束日期" value={search.to ?? ''} onChange={(e) => go({ to: e.currentTarget.value || undefined })} />
        </div>
      </div>
      <Panel title="记录" flush acts={<span className="hint">共 {fmtN(data.total)} 条 · 时间为北京时间</span>}>
        <div className="feed adm-audit" style={{ padding: '4px 16px' }}>
          {!data.rows.length ? <p className="hint" style={{ padding: '16px 0' }}>没有符合条件的记录。</p> : null}
          {data.rows.map((a) => (
            <div key={a.id} className="it">
              <span className="dot">
                <Icon name={auditIcon(a.action)} />
              </span>
              <div style={{ minWidth: 0 }}>
                <b>{a.actorName ?? (a.actorId ? '已删除的用户' : '系统')}</b>
                {a.actorRole ? <span className="hint">（{roleName(a.actorRole)}）</span> : null} · {actionLabel(a.action)} · <span className="muted">{targetText(a)}</span>
                {a.impersonatedBy ? <span className="hint"> · 由 {a.impersonatorName ?? a.impersonatedBy} 模拟登录操作</span> : null}
                <div className="hint mono">{a.action}{a.targetId ? ` · ${a.targetType ?? ''} #${a.targetId}` : ''}</div>
                {a.diff != null ? (
                  openId === a.id ? (
                    <DiffView diff={a.diff} />
                  ) : (
                    <button type="button" className="btn xs ghost" onClick={() => setOpenId(a.id)}>
                      查看改动
                    </button>
                  )
                ) : null}
              </div>
              <time dateTime={a.at} title={fmtDateTime(a.at)}>
                {fmtDateTime(a.at)}
              </time>
            </div>
          ))}
        </div>
        <Pager page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(page) => go({ page })} />
      </Panel>
    </>
  )
}

// ---------- 系统设置 ----------

function Status({ ok, yes = '已配置', no = '未配置' }: { ok: boolean; yes?: string; no?: string }) {
  return <Pill tone={ok ? 'ok' : 'warn'}>{ok ? yes : no}</Pill>
}

function Row({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="rule-row">
      <div>
        <b>{title}</b>
        {note ? <small>{note}</small> : null}
      </div>
      <div>{children}</div>
    </div>
  )
}

export function SettingsPage({ data }: { data: SettingsData }) {
  const router = useRouter()
  const [tab, setTab] = useState<'site' | 'int'>('site')
  const [name, setName] = useState(data.site.name ?? '')
  const [subtitle, setSubtitle] = useState(data.site.subtitle ?? '')
  const [announcement, setAnnouncement] = useState(data.site.announcement ?? '')
  const [saving, setSaving] = useState(false)
  const dirty = name !== (data.site.name ?? '') || subtitle !== (data.site.subtitle ?? '') || announcement !== (data.site.announcement ?? '')
  const i = data.integrations

  async function save() {
    setSaving(true)
    try {
      const r = await adminSaveSiteFn({ data: { name: name.trim() || null, subtitle: subtitle.trim() || null, announcement: announcement.trim() || null } })
      toast({ message: r.changed ? `已保存，站名现在是「${r.effective.name}」` : '没有改动', icon: 'check' })
      // the root loader caches the site config forever (staleTime: Infinity): reload it everywhere
      await router.invalidate()
    } catch (err) {
      toast({ message: errorText(err), icon: 'warn' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHead title="系统设置" sub="修改即时生效，无需重新部署；密钥类配置只读，只显示是否已配置" />
      <Tabs
        label="设置分类"
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'site', label: '站点' },
          { value: 'int', label: '集成' },
        ]}
      >
        <TabPanel value="site">
          <Panel
            title="站点"
            acts={
              <Button size="xs" variant="primary" icon="check" disabled={!dirty || saving} onClick={save}>
                保存
              </Button>
            }
          >
            <div className="form-grid">
              <Field label="站点名称" hint={`留空则使用环境变量 SITE_NAME（${data.defaults.name}）；修改后全站即时更新`}>
                <Input value={name} maxLength={20} placeholder={data.defaults.name} onChange={(e) => setName(e.currentTarget.value)} />
              </Field>
              <Field label="副标题" hint={`留空则使用 SITE_SUBTITLE（${data.defaults.subtitle}）`}>
                <Input value={subtitle} maxLength={40} placeholder={data.defaults.subtitle} onChange={(e) => setSubtitle(e.currentTarget.value)} />
              </Field>
              <Field label="顶部公告" className="full" hint="显示在每个页面顶部、可关闭的横条；留空则不显示">
                <Textarea value={announcement} maxLength={200} rows={2} style={{ minHeight: 64 }} onChange={(e) => setAnnouncement(e.currentTarget.value)} />
              </Field>
            </div>
            <p className="hint" style={{ marginTop: 12 }}>
              当前生效：<span className="adm-dyn">{data.effective.name}</span> · <span className="adm-dyn">{data.effective.subtitle}</span>
              {data.updatedAt ? ` · ${data.updatedBy ?? '未知'} 于 ${fmtDateTime(data.updatedAt)} 修改` : ''}
            </p>
          </Panel>
        </TabPanel>
        <TabPanel value="int">
          <Panel title="集成" className="adm-int">
            <Row title="人机验证 Cap" note={<span className="mono">{i.cap.endpoint}</span>}>
              <Status ok={i.cap.secretConfigured && !i.cap.disabled} yes="密钥已配置" no={i.cap.disabled ? '开发模式：已关闭验证' : '密钥未配置'} />
            </Row>
            <Row title="Cap 站点" note={<span className="mono">site key {i.cap.siteKey}</span>}>
              <Pill tone="mute">公开</Pill>
            </Row>
            <Row title="发信 SMTP" note={i.smtp.configured ? `发件地址 ${i.smtp.from ?? ''}` : '未配置时不要求邮箱验证，也发不出重置密码邮件'}>
              <Status ok={i.smtp.configured} />
            </Row>
            <Row
              title="对象存储（R2）"
              note={
                <>
                  <span className="mono">{i.storage.endpointHost}</span> · 桶 <span className="mono">{i.storage.bucket}</span>
                  {i.storage.publicEndpointHost ? (
                    <>
                      {' '}
                      · 浏览器端点 <span className="mono">{i.storage.publicEndpointHost}</span>
                    </>
                  ) : null}
                </>
              }
            >
              <Pill tone="mute">环境变量</Pill>
            </Row>
            <Row title="Cloudflare 缓存清除" note="下架表情时按 URL 清除 /img 缓存；令牌只有缓存清除权限">
              <Status ok={i.purge.configured} />
            </Row>
            <Row title="站点地址 SITE_URL" note={<span className="mono">{i.siteUrl}</span>}>
              <Pill tone="mute">环境变量</Pill>
            </Row>
            <p className="hint" style={{ marginTop: 8 }}>
              密钥只通过环境变量或 Docker secrets 注入，这里不显示、也不能修改。
            </p>
          </Panel>
        </TabPanel>
      </Tabs>
    </>
  )
}
