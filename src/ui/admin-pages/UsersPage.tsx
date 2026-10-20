import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { adminBanUserFn, adminImpersonateFn, adminRevokeSessionsFn, adminSetRoleFn, adminSetSubmitModeFn, adminUnbanUserFn } from '#/server/admin/fns/system'
import type { UserListData, UserRow } from '#/server/admin/types'
import { can, ROLES, type Perm, type Role, type SubmitMode } from '#/shared/roles'
import { Button } from '../Button'
import { Field, Input } from '../Field'
import { fmtN } from '../format'
import { Icon } from '../Icon'
import { Modal, ModalClose } from '../Modal'
import { Seg } from '../Seg'
import { Sheet } from '../Sheet'
import { errorText, fmtAgo, fmtDateTime, maskEmail, PageHead, Pager, Panel, Pill, SelectField, type Tone, useAction } from './bits'

const layout = getRouteApi('/admin')

export interface UsersSearch {
  q?: string
  role?: Role
  submitMode?: SubmitMode
  banned?: boolean
  page?: number
}

// docs/ARCHITECTURE.md §5.1, computed from ROLES so the table always mirrors the code
const MATRIX: [string, Perm[] | null][] = [
  ['浏览、下载、收藏、评论', null],
  ['投稿表情包（需审核，可设免审）', ['submit']],
  ['审核投稿，发布与下架表情包', ['review']],
  ['表情包与表情增删改查、上传中心', ['packs', 'upload']],
  ['角色、画师、标签整理与合并', ['taxonomy']],
  ['评论审核、屏蔽词、禁止评论', ['comments']],
  ['用户与角色、下载与风控', ['users', 'downloads']],
  ['存储、任务、审计、系统设置', ['storage', 'system', 'audit', 'settings']],
]
const ROLE_ORDER: Role[] = ['admin', 'manager', 'user']
const ROLE_TONE: Record<Role, Tone> = { admin: 'err', manager: 'info', user: 'mute' }
const MODE_LABEL: Record<SubmitMode, string> = { review: '需审核', trusted: '免审', blocked: '禁止投稿' }

export function UsersPage({ data, search }: { data: UserListData; search: UsersSearch }) {
  const navigate = useNavigate()
  const [q, setQ] = useState(search.q ?? '')
  const [openId, setOpenId] = useState<string | null>(null)
  const open = data.rows.find((u) => u.id === openId) ?? null
  const go = (patch: Partial<UsersSearch>) => void navigate({ to: '/admin/users', search: { ...search, page: undefined, ...patch } })

  return (
    <>
      <PageHead
        title="用户与权限"
        sub={`三种角色：站长拥有全部权限；管理员负责表情包、投稿与评论；所有用户都可以投稿。站长 ${data.counts.admin} 位 · 管理员 ${data.counts.manager} 位 · 用户 ${fmtN(data.counts.user)} 位`}
      />

      <div className="cols-2">
        <Panel title="角色与权限" flush>
          <div className="tbl-wrap">
            <table className="tbl perm">
              <thead>
                <tr>
                  <th>能做什么</th>
                  {ROLE_ORDER.map((r) => (
                    <th key={r}>{ROLES[r].name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MATRIX.map(([label, perms]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    {ROLE_ORDER.map((r) => {
                      const ok = perms == null || perms.every((p) => can(r, p))
                      return (
                        <td key={r} className={ok ? 'y' : 'n'}>
                          <Icon name={ok ? 'check' : 'minus'} size="sm" label={ok ? '可以' : '不可以'} />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="任命规则">
          <ul className="rules">
            <li>只有站长可以任命或撤销管理员和站长；管理员调用这些接口会被拒绝。</li>
            <li>至少保留一位站长：最后一位站长不能被降级、封禁或删除（数据库触发器保证）。</li>
            <li>投稿默认对所有注册用户开放；可以对单个用户设为「免审」或「禁止投稿」，只有站长能改，管理员不能给自己免审。</li>
            <li>模拟登录用于排查问题，30 分钟后失效；期间的每次写操作都记录为由站长代为操作。</li>
            <li>每次写操作都写入审计日志，记录操作人与当时的角色。</li>
          </ul>
        </Panel>
      </div>

      <div className="filters">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            go({ q: q.trim() || undefined })
          }}
        >
          <Input size="sm" icon="search" wrapClassName="adm-search" placeholder="用户名、邮箱或 ID" aria-label="搜索用户" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        </form>
        <SelectField
          label="角色"
          value={search.role ?? ''}
          onChange={(v) => go({ role: v || undefined })}
          options={[{ value: '', label: '全部' }, ...ROLE_ORDER.map((r) => ({ value: r, label: ROLES[r].name }))]}
        />
        <SelectField
          label="投稿"
          value={search.submitMode ?? ''}
          onChange={(v) => go({ submitMode: v || undefined })}
          options={[{ value: '', label: '全部' }, ...(Object.keys(MODE_LABEL) as SubmitMode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }))]}
        />
        <SelectField
          label="状态"
          value={search.banned == null ? '' : search.banned ? 'banned' : 'active'}
          onChange={(v) => go({ banned: v === '' ? undefined : v === 'banned' })}
          options={[
            { value: '', label: '全部' },
            { value: 'active', label: '正常' },
            { value: 'banned', label: '已封禁' },
          ]}
        />
      </div>

      <Panel title="用户" flush acts={<span className="hint">共 {fmtN(data.total)} 位</span>}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>用户</th>
                <th className="col-opt">邮箱</th>
                <th>角色</th>
                <th>投稿</th>
                <th className="col-opt">最近活跃</th>
                <th>
                  <span className="sr">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!data.rows.length ? (
                <tr className="adm-empty-row">
                  <td colSpan={6}>没有符合条件的用户</td>
                </tr>
              ) : null}
              {data.rows.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="cell">
                      <span className="avatar sm">{[...u.name][0] ?? '?'}</span>
                      <div style={{ minWidth: 0 }}>
                        <b>{u.name}</b>
                        {u.banned ? <span className="st err">已封禁</span> : null}
                      </div>
                    </div>
                  </td>
                  <td className="col-opt mono">{maskEmail(u.email)}</td>
                  <td>
                    <Pill tone={ROLE_TONE[u.role]}>{ROLES[u.role].name}</Pill>
                  </td>
                  <td>
                    {u.submitMode === 'blocked' ? <Pill tone="err">禁止投稿</Pill> : <span className="muted">{MODE_LABEL[u.submitMode]}{u.packs ? ` · ${u.packs} 个包` : ''}</span>}
                  </td>
                  <td className="col-opt muted">{fmtAgo(u.lastActive)}</td>
                  <td>
                    <div className="row-acts">
                      <button type="button" className="ibtn" aria-label={`管理 ${u.name}`} title="管理" onClick={() => setOpenId(u.id)}>
                        <Icon name="sliders" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(page) => go({ page })} />
      </Panel>

      <Sheet open={open != null} onOpenChange={(o) => !o && setOpenId(null)} title="管理用户">
        {open ? <UserManager key={open.id} user={open} /> : null}
      </Sheet>
    </>
  )
}

function UserManager({ user }: { user: UserRow }) {
  const { viewer } = layout.useLoaderData()
  const { run, busy } = useAction()
  const [role, setRole] = useState<Role>(user.role)
  const [reason, setReason] = useState('')
  const [days, setDays] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [impersonate, setImpersonate] = useState(false)
  const self = viewer?.id === user.id

  const act = async <T,>(key: string, fn: () => Promise<T>, ok: string) => {
    setError(null)
    const r = await run(key, async () => {
      try {
        return await fn()
      } catch (err) {
        setError(errorText(err))
        throw err
      }
    }, ok)
    return r
  }

  return (
    <>
      <div className="adm-user-head">
        <span className="avatar lg">{[...user.name][0] ?? '?'}</span>
        <div style={{ minWidth: 0 }}>
          <b className="adm-dyn">{user.name}</b>
          <small className="mono">{user.email}</small>
          <small>
            注册于 {fmtDateTime(user.createdAt)} · 最近活跃 {fmtAgo(user.lastActive)} · 已通过投稿 {user.approved} 次
          </small>
        </div>
      </div>
      {error ? (
        <div className="note-box warn" role="alert">
          <Icon name="warn" size="sm" />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="adm-section">
        <h4>角色</h4>
        <Seg size="sm" label="角色" value={role} onChange={setRole} options={ROLE_ORDER.map((r) => ({ value: r, label: ROLES[r].name }))} />
        <div className="adm-inline">
          <Button size="sm" variant="primary" disabled={role === user.role || busy != null} onClick={() => act('role', () => adminSetRoleFn({ data: { userId: user.id, role } }), `已改为${ROLES[role].name}`)}>
            保存角色
          </Button>
          {self ? <span className="hint">这是你自己的账号；降级后会立即失去对应权限。</span> : null}
        </div>
      </section>

      <section className="adm-section">
        <h4>投稿模式</h4>
        <Seg
          size="sm"
          label="投稿模式"
          value={user.submitMode}
          onChange={(mode) => void act('mode', () => adminSetSubmitModeFn({ data: { userId: user.id, mode } }), `投稿模式：${MODE_LABEL[mode]}`)}
          options={(Object.keys(MODE_LABEL) as SubmitMode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }))}
        />
        <span className="hint">免审：提交后直接发布（仍写审计日志）；禁止投稿：不能新建或提交投稿。</span>
      </section>

      <section className="adm-section">
        <h4>封禁</h4>
        {user.banned ? (
          <>
            <span className="hint">
              已封禁{user.banReason ? `：${user.banReason}` : ''}
              {user.banExpires ? `，到 ${fmtDateTime(user.banExpires)} 解除` : '，没有期限'}
            </span>
            <Button size="sm" disabled={busy != null} onClick={() => act('unban', () => adminUnbanUserFn({ data: { userId: user.id } }), '已解除封禁')}>
              解除封禁
            </Button>
          </>
        ) : (
          <>
            <Field label="原因" aside="选填，用户登录时会看到">
              <Input size="sm" value={reason} maxLength={200} onChange={(e) => setReason(e.currentTarget.value)} />
            </Field>
            <div className="adm-inline">
              <SelectField
                plain
                label="期限"
                value={days}
                onChange={setDays}
                options={[
                  { value: '', label: '永久' },
                  { value: '1', label: '1 天' },
                  { value: '7', label: '7 天' },
                  { value: '30', label: '30 天' },
                ]}
              />
              <Button size="sm" variant="danger" icon="ban" disabled={self || busy != null} onClick={() => act('ban', () => adminBanUserFn({ data: { userId: user.id, reason: reason || undefined, days: days ? Number(days) : undefined } }), '已封禁')}>
                封禁
              </Button>
            </div>
            <span className="hint">封禁会同时让这个账号的所有会话失效。</span>
          </>
        )}
      </section>

      <section className="adm-section">
        <h4>会话</h4>
        <div className="adm-inline">
          <span className="hint">{user.sessions} 个有效会话</span>
          <Button size="sm" icon="logout" disabled={!user.sessions || busy != null} onClick={() => act('revoke', () => adminRevokeSessionsFn({ data: { userId: user.id } }), '已强制下线')}>
            强制下线
          </Button>
        </div>
      </section>

      <section className="adm-section">
        <h4>模拟登录</h4>
        <span className="hint">以这个用户的身份浏览 30 分钟，用于排查问题；不能模拟其他站长。</span>
        <Button size="sm" icon="user" disabled={self || user.role === 'admin' || user.banned || busy != null} onClick={() => setImpersonate(true)}>
          模拟登录
        </Button>
      </section>

      <Modal
        open={impersonate}
        onOpenChange={setImpersonate}
        icon="user"
        title="以这个用户的身份登录？"
        actions={
          <>
            <ModalClose render={<Button size="sm" variant="ghost" />}>取消</ModalClose>
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                const r = await act('imp', () => adminImpersonateFn({ data: { userId: user.id } }), '已切换身份')
                setImpersonate(false)
                // the session cookie changed: reload everything as the impersonated user
                if (r) window.location.assign(r.role === 'user' ? '/' : '/admin')
              }}
            >
              模拟登录
            </Button>
          </>
        }
      >
        你会以「{user.name}」的身份进入网站，当前的站长会话保留，30 分钟后模拟结束。期间的操作会记录为由你代为操作。
      </Modal>
    </>
  )
}
