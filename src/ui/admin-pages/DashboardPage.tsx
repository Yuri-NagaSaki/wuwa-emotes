import { getRouteApi } from '@tanstack/react-router'
import type { DashboardData } from '#/server/admin/types'
import { can } from '#/shared/roles'
import { buttonClass } from '../Button'
import { EmptyState } from '../EmptyState'
import { fmtN, fmtW } from '../format'
import { Icon, type IconName } from '../Icon'
import { AppLink } from '../link'
import { auditIcon, AuditLine } from './audit-format'
import { fmtAgo, fmtDateTime, Kpi, PageHead, Panel, Thumb } from './bits'
import { DailyChart } from './Chart'

const layout = getRouteApi('/admin')

function greeting(now: Date): string {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false }).format(now))
  if (h < 5) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 13) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

function wan(n: number): { value: string; unit?: string } {
  if (n < 10_000) return { value: fmtN(n) }
  return { value: (n / 10_000).toFixed(n >= 1_000_000 ? 0 : 1).replace(/\.0$/, ''), unit: '万' }
}

export function DashboardPage({ data }: { data: DashboardData }) {
  const { viewer } = layout.useLoaderData()
  const role = viewer?.role
  const r2 = wan(data.r2Reads.month)
  const total30 = data.downloads30.reduce((a, d) => a + d.n, 0)
  const todo: { icon: IconName; label: string; count: number; to: string; note: string; show: boolean }[] = [
    {
      icon: 'inbox',
      label: '待审投稿',
      count: data.pendingSubmissions.count,
      to: '/admin/review',
      note: data.pendingSubmissions.oldest ? `最早一条 ${fmtAgo(data.pendingSubmissions.oldest)}` : '没有待审的投稿',
      show: can(role, 'review'),
    },
    {
      icon: 'chat',
      label: '待审评论',
      count: data.pendingComments.count,
      to: '/admin/comments',
      note: data.pendingComments.oldest ? `最早一条 ${fmtAgo(data.pendingComments.oldest)}` : '没有待审的评论',
      show: can(role, 'comments'),
    },
    { icon: 'flag', label: '被举报的评论', count: data.openReports, to: '/admin/comments', note: data.openReports ? '需要处理' : '没有未处理的举报', show: can(role, 'comments') },
  ]
  return (
    <>
      <PageHead
        title="仪表盘"
        sub={
          <>
            {greeting(new Date(data.generatedAt))}，<span className="adm-dyn">{viewer?.name}</span> · 数据截至 {fmtDateTime(data.generatedAt)}
          </>
        }
        actions={
          <>
            {can(role, 'review') ? (
              <AppLink to="/admin/review" className={buttonClass({ variant: 'primary', size: 'sm' })}>
                <Icon name="inbox" />
                处理投稿
              </AppLink>
            ) : null}
            {can(role, 'upload') ? (
              <AppLink to="/admin/upload" className={buttonClass({ size: 'sm' })}>
                <Icon name="upload" />
                上传表情
              </AppLink>
            ) : null}
          </>
        }
      />

      <div className="kpis">
        <Kpi icon="download" label="今日原图下载" value={fmtN(data.originalsToday)} note={`单张与打包清单 · 整包 ZIP ${fmtN(data.zipsToday)} 次`} />
        <Kpi
          icon="inbox"
          label="待审投稿"
          value={fmtN(data.pendingSubmissions.count)}
          note={data.pendingSubmissions.count ? `来自 ${data.pendingSubmissions.submitters} 位投稿者` : '全部处理完了'}
          alert={data.pendingSubmissions.count > 0}
        />
        <Kpi icon="chat" label="待审评论" value={fmtN(data.pendingComments.count)} note={data.pendingComments.oldest ? `最早一条 ${fmtAgo(data.pendingComments.oldest)}` : '队列是空的'} />
        <Kpi
          icon="cloud"
          label="R2 读操作（本月估算）"
          value={r2.value}
          unit={r2.unit}
          note={data.r2Reads.threshold ? `告警阈值 ${fmtW(data.r2Reads.threshold)} · 按签发次数估算` : '按签发次数估算 · 未设告警'}
          alert={data.r2Reads.threshold != null && data.r2Reads.month > data.r2Reads.threshold}
        />
        <Kpi icon="user" label="今日新注册" value={fmtN(data.registrations.today)} note={`近 7 天 ${fmtN(data.registrations.week)} 位`} />
      </div>

      {data.hashSlugs.characters + data.hashSlugs.artists > 0 && can(role, 'taxonomy') ? (
        <div className="alert-box">
          <Icon name="warn" />
          <div>
            <b>
              还有 {data.hashSlugs.characters} 个角色和 {data.hashSlugs.artists} 位画师使用哈希 slug
            </b>
            <span className="muted">这些地址不好读，也影响搜索。可以在角色、画师页改成拼音 slug，旧地址会自动 301。</span>
          </div>
          <AppLink to="/admin/characters" className={buttonClass({ size: 'sm' })}>
            去清洗
          </AppLink>
        </div>
      ) : null}

      <div className="cols-2">
        <Panel title="近 30 天下载" acts={<span className="hint">原图与整包 ZIP 签发次数，每小时汇总</span>}>
          {total30 > 0 ? (
            <DailyChart points={data.downloads30} label={`近 30 天下载次数，合计 ${fmtN(total30)}，今天 ${fmtN(data.downloads30.at(-1)?.n ?? 0)}`} />
          ) : (
            <EmptyState icon="chart" title="还没有下载记录">
              有人下载原图或整包后，每小时汇总一次，这里会出现曲线。
            </EmptyState>
          )}
        </Panel>
        <Panel title="待处理">
          <div className="feed">
            {todo
              .filter((t) => t.show)
              .map((t) => (
                <AppLink key={t.label} to={t.to} className="it adm-todo">
                  <span className="dot">
                    <Icon name={t.icon} />
                  </span>
                  <div>
                    <b>{t.label}</b>
                    <div className="muted">{t.note}</div>
                  </div>
                  {t.count ? <span className="badge-dot">{t.count}</span> : <span className="hint">0</span>}
                </AppLink>
              ))}
          </div>
        </Panel>
      </div>

      <div className="cols-2e">
        <Panel title="累计下载最多的包">
          {data.topPacks.length ? (
            <div className="barlist">
              {data.topPacks.map((p) => (
                <AppLink key={p.id} to={`/admin/packs/${p.id}`} className="row">
                  <Thumb src={p.thumb} size={34} />
                  <div>
                    <div className="t">{p.title}</div>
                    <div className="b">
                      <i style={{ width: `${Math.max(2, (p.downloads / data.topPacks[0]!.downloads) * 100).toFixed(0)}%` }} />
                    </div>
                  </div>
                  <span className="v">{fmtW(p.downloads)}</span>
                </AppLink>
              ))}
            </div>
          ) : (
            <p className="hint">还没有包被下载过。</p>
          )}
        </Panel>
        <Panel
          title={data.recentScope === 'all' ? '最近动态' : '我的最近操作'}
          acts={
            data.recentScope === 'all' ? (
              <AppLink to="/admin/audit" className={buttonClass({ size: 'xs', variant: 'ghost' })}>
                审计日志
              </AppLink>
            ) : null
          }
        >
          {data.recent.length ? (
            <div className="feed">
              {data.recent.map((a) => (
                <div key={a.id} className="it">
                  <span className="dot">
                    <Icon name={auditIcon(a.action)} />
                  </span>
                  <AuditLine entry={a} />
                  <time dateTime={a.at}>{fmtAgo(a.at)}</time>
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">{data.recentScope === 'all' ? '还没有后台操作记录。' : '你还没有在后台做过修改。审计日志只对站长开放。'}</p>
          )}
        </Panel>
      </div>
    </>
  )
}
