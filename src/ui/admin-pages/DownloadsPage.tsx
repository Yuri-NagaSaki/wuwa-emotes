import { useRouter } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { saveRiskSettings, setSourceMode } from '#/server/downloads/admin-fns'
import type { DownloadSettings } from '#/server/downloads/policy'
import type { RiskOverview, SuspiciousSource } from '#/server/downloads/risk'
import { Button } from '../Button'
import { cx } from '../cx'
import { Input } from '../Field'
import { fmtN, fmtW } from '../format'
import { Icon } from '../Icon'
import { Modal, ModalClose } from '../Modal'
import { Switch } from '../Switch'
import { fmtDateTime, Kpi, PageHead, Panel, Pill, useAction } from './bits'

// 下载与风控 (站长 only). Limits and the alert threshold are a form with a save bar; the switches save
// on their own, the two emergency switches only after a confirmation when turned on.

export interface DownloadsData {
  overview: RiskOverview
  settings: DownloadSettings
  sources: SuspiciousSource[]
}

type NumKey = 'perIpOriginalsPerDay' | 'perUserOriginalsPerDay' | 'perIpPacksPerDay' | 'maxBatchItems' | 'batchItemsPerMinute' | 'singleSignsPerMinute' | 'r2ReadAlertMonthly'
type EmergencyKey = 'originalsRequireLogin' | 'pauseZipAndBatch'

interface NumField {
  key: NumKey
  title: string
  note: string
  unit: string
  /** what a blank field means */
  blank: string
}

const LIMITS: NumField[] = [
  { key: 'perIpOriginalsPerDay', title: '每个 IP 每天原图张数', note: '游客按 IP 计；单张原图和打包清单里的每一张都算', unit: '张', blank: '不限' },
  { key: 'perUserOriginalsPerDay', title: '每个账号每天原图张数', note: '登录用户改按账号计，IP 限额不再适用', unit: '张', blank: '不限' },
  { key: 'perIpPacksPerDay', title: '每个 IP 每天整包次数', note: '整包 ZIP 和打包下载都算，每个压缩包计 1 次；登录也按 IP 计', unit: '次', blank: '不限' },
  { key: 'maxBatchItems', title: '单次打包张数上限', note: '一个压缩包最多装多少张，超出时提示分成多个压缩包', unit: '张', blank: '不限' },
  { key: 'batchItemsPerMinute', title: '每个 IP 每分钟打包张数', note: '和单张限速分开计，正常打包不会触发单张限速', unit: '张', blank: '不限' },
]
const GUARDS: NumField[] = [
  { key: 'singleSignsPerMinute', title: '单张下载速率', note: '每个 IP 每分钟最多签发的单张原图链接，超出返回 429；默认 60', unit: '次/分钟', blank: '不限' },
  { key: 'r2ReadAlertMonthly', title: 'R2 读操作月度告警', note: '本月签发的原图与 ZIP 超过这个数时，每天最多给站长发一封邮件；默认 900 万，留空不告警', unit: '次', blank: '不告警' },
]
const NUM_FIELDS = [...LIMITS, ...GUARDS]
const NUM_KEYS = NUM_FIELDS.map((f) => f.key)

const EMERGENCY: { key: EmergencyKey; title: string; note: string; confirm: string }[] = [
  {
    key: 'originalsRequireLogin',
    title: '原图仅限登录用户',
    note: '游客只能看 WebP 预览，单张原图、整包和打包下载都要先登录',
    confirm: '打开后游客不能再下载原图、整包 ZIP 或打包清单，只能看 WebP 预览，登录用户不受影响。立即对所有访客生效，可以随时关闭。',
  },
  {
    key: 'pauseZipAndBatch',
    title: '暂停整包与打包下载',
    note: '只保留单张原图下载；整包 ZIP 和打包清单对所有人暂停',
    confirm: '打开后所有人（包括登录用户）都不能下载整包 ZIP 或打包清单，单张原图下载照常。立即生效，可以随时关闭。',
  },
]

type Parsed = { ok: true; value: number | null } | { ok: false; error: string }

/** Blank = null (unlimited); otherwise a positive integer. Thousands separators are ignored. */
function parseNum(raw: string): Parsed {
  const s = raw.replace(/[\s,，_]/g, '')
  if (!s) return { ok: true, value: null }
  if (!/^\d+$/.test(s)) return { ok: false, error: '请填正整数，或者留空' }
  const n = Number(s)
  if (n < 1) return { ok: false, error: '至少为 1；不想限制请留空' }
  if (!Number.isSafeInteger(n)) return { ok: false, error: '数字太大了' }
  return { ok: true, value: n }
}

function wan(n: number): { value: string; unit?: string } {
  if (n < 10_000) return { value: fmtN(n) }
  return { value: (n / 10_000).toFixed(n >= 1_000_000 ? 0 : 1).replace(/\.0$/, ''), unit: '万' }
}

export function DownloadsPage({ data }: { data: DownloadsData }) {
  const router = useRouter()
  const { overview: o, settings: s, sources } = data
  const r2 = wan(o.monthToDate.r2Reads)
  const over = o.monthToDate.threshold != null && o.monthToDate.r2Reads > o.monthToDate.threshold
  const on = EMERGENCY.filter((e) => s[e.key])
  return (
    <>
      <PageHead
        title="下载与风控"
        sub="默认对所有人开放下载；限额留空即不限制，用来防止有人批量刷 R2。每次修改都写入审计日志。"
        actions={
          <Button size="sm" icon="refresh" onClick={() => void router.invalidate()}>
            刷新
          </Button>
        }
      />

      {on.length ? (
        <div className="alert-box" role="status">
          <Icon name="warn" />
          <div>
            <b>紧急开关已打开：{on.map((e) => `「${e.title}」`).join('')}</b>
            <span className="muted">{on.map((e) => e.note).join('；')}。情况缓解后记得在下方关闭。</span>
          </div>
        </div>
      ) : null}

      <div className="kpis">
        <Kpi icon="download" label="今日原图下载" value={fmtN(o.todayOriginals)} note={`昨天 ${fmtN(o.yesterdayOriginals)} · 今日整包 ${fmtN(o.todayPacks)} 次`} />
        <Kpi
          icon="cloud"
          label="R2 读操作（本月估算）"
          value={r2.value}
          unit={r2.unit}
          note={o.monthToDate.threshold != null ? `${over ? '已超过' : ''}告警阈值 ${fmtW(o.monthToDate.threshold)} · 按签发次数估算` : '按签发次数估算 · 未设告警'}
          alert={over}
        />
        <Kpi icon="shield" label="今日触发限流" value={fmtN(o.throttled.events)} note={o.throttled.events ? `来自 ${fmtN(o.throttled.ips)} 个 IP` : '今天没有被拒绝的请求'} alert={o.throttled.events > 0} />
        <Kpi icon="ban" label="封禁中的来源" value={fmtN(o.sources.blocked)} note={`观察中 ${fmtN(o.sources.watched)} 个`} />
      </div>

      <EmergencyPanel settings={s} />

      <LimitsForm key={NUM_KEYS.map((k) => s[k] ?? '').join('|')} settings={s} />

      <SourcesPanel sources={sources} />
    </>
  )
}

// ---------- 紧急开关 ----------

function EmergencyPanel({ settings }: { settings: DownloadSettings }) {
  const { run, busy } = useAction()
  // the modal keeps its last switch while it animates out
  const [pending, setPending] = useState<(typeof EMERGENCY)[number] | null>(null)
  const [open, setOpen] = useState(false)
  const save = (key: EmergencyKey, value: boolean) => {
    const title = EMERGENCY.find((e) => e.key === key)!.title
    const patch = { [key]: value } as Partial<DownloadSettings>
    return run(key, () => saveRiskSettings({ data: patch }), value ? `已打开「${title}」` : `已关闭「${title}」，下载恢复正常`)
  }
  return (
    <Panel title="紧急开关" className="adm-emg" acts={<span className="hint">有人刷 R2 时一键收紧，立即生效</span>}>
      <div className="adm-emg-grid">
        {EMERGENCY.map((e) => (
          <div key={e.key} className={cx('set-row', settings[e.key] && 'is-on')}>
            <div>
              <b>
                {e.title}
                {settings[e.key] ? <Pill tone="warn">已打开</Pill> : null}
              </b>
              <small>{e.note}</small>
            </div>
            <Switch
              checked={settings[e.key]}
              disabled={busy != null}
              onCheckedChange={(v) => {
                if (!v) return void save(e.key, false)
                setPending(e)
                setOpen(true)
              }}
            >
              <span className="sr">{e.title}</span>
            </Switch>
          </div>
        ))}
      </div>
      <Modal
        open={open}
        onOpenChange={setOpen}
        icon="warn"
        title={`打开「${pending?.title ?? ''}」？`}
        actions={
          <>
            <ModalClose render={<Button size="sm" variant="ghost" />}>取消</ModalClose>
            <Button
              size="sm"
              variant="danger"
              disabled={busy != null}
              onClick={async () => {
                if (pending) await save(pending.key, true)
                setOpen(false)
              }}
            >
              打开
            </Button>
          </>
        }
      >
        {pending?.confirm}
      </Modal>
    </Panel>
  )
}

// ---------- 限额与防刷 ----------

function LimitsForm({ settings }: { settings: DownloadSettings }) {
  const { run, busy } = useAction()
  const initial = Object.fromEntries(NUM_KEYS.map((k) => [k, settings[k] == null ? '' : String(settings[k])])) as Record<NumKey, string>
  const [draft, setDraft] = useState(initial)
  const parsed = Object.fromEntries(NUM_KEYS.map((k) => [k, parseNum(draft[k])])) as Record<NumKey, Parsed>
  const invalid = NUM_KEYS.some((k) => !parsed[k].ok)
  const changed = NUM_KEYS.filter((k) => {
    const p = parsed[k]
    return p.ok ? p.value !== settings[k] : draft[k] !== initial[k]
  })

  function save() {
    const patch: Partial<Record<NumKey, number | null>> = {}
    for (const k of changed) {
      const p = parsed[k]
      if (p.ok) patch[k] = p.value
    }
    void run('limits', () => saveRiskSettings({ data: patch }), '已保存，约 10 秒内全站生效')
  }

  const row = (f: NumField) => {
    const p = parsed[f.key]
    const err = p.ok ? null : p.error
    const big = p.ok && p.value != null && p.value >= 10_000 ? fmtW(p.value) : null
    return (
      <div key={f.key} className="rule-row">
        <div>
          <b id={`dl-${f.key}`}>{f.title}</b>
          <small>{f.note}</small>
          {err ? (
            <small className="adm-err adm-num-err" id={`dl-${f.key}-err`}>
              {err}
            </small>
          ) : null}
        </div>
        <div className="adm-num">
          <Input
            size="sm"
            inputMode="numeric"
            name={f.key}
            aria-labelledby={`dl-${f.key}`}
            aria-describedby={err ? `dl-${f.key}-err` : undefined}
            invalid={err != null}
            placeholder={f.blank}
            value={draft[f.key]}
            onChange={(e) => {
              const v = e.currentTarget.value
              setDraft((d) => ({ ...d, [f.key]: v }))
            }}
          />
          <span>
            {f.unit}
            {big ? <small>{big}</small> : null}
          </span>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="cols-2e">
        <Panel title="限额（留空 = 不限）">
          {LIMITS.map(row)}
          <p className="hint adm-dl-note">
            天按北京时间计，0 点重置。WebP 预览始终不计数。达到每日限额时提示「明天 0 点恢复」；账号限额比 IP 限额宽松（或不限）时，还会引导游客登录。
          </p>
        </Panel>
        <Panel title="防刷">
          <ChallengeRow settings={settings} />
          {GUARDS.map(row)}
        </Panel>
      </div>
      {changed.length ? (
        <div className="savebar" role="status">
          <span className="grow">
            有 {changed.length} 处未保存的修改：{changed.map((k) => NUM_FIELDS.find((f) => f.key === k)!.title).join('、')}
            {invalid ? '（请先改正标红的数字）' : ''}
          </span>
          <Button size="sm" variant="ghost" disabled={busy != null} onClick={() => setDraft(initial)}>
            放弃
          </Button>
          <Button size="sm" variant="primary" icon="check" disabled={invalid || busy != null} onClick={save}>
            保存
          </Button>
        </div>
      ) : null}
    </>
  )
}

function ChallengeRow({ settings }: { settings: DownloadSettings }) {
  const { run, busy } = useAction()
  return (
    <div className="rule-row">
      <div>
        <b>可疑时要求人机验证</b>
        <small>没有本站 Referer，或同一 IP 5 分钟内连续抓取 30 张以上不同表情时，先通过 Cap 验证，通过后 10 分钟内不再询问。关闭后也不再检测连续抓取。</small>
      </div>
      <Switch
        checked={settings.challengeSuspicious}
        disabled={busy != null}
        onCheckedChange={(v) => void run('challenge', () => saveRiskSettings({ data: { challengeSuspicious: v } }), v ? '已打开「可疑时要求人机验证」' : '已关闭「可疑时要求人机验证」')}
      >
        <span className="sr">可疑时要求人机验证</span>
      </Switch>
    </div>
  )
}

// ---------- 可疑来源 ----------

const DAY_MS = 86_400_000

function SourcesPanel({ sources }: { sources: SuspiciousSource[] }) {
  const { run, busy } = useAction()
  const [blocking, setBlocking] = useState<SuspiciousSource | null>(null)
  const [open, setOpen] = useState(false)

  const setMode = (src: SuspiciousSource, mode: 'block' | 'watch' | 'none', until: string | null = null) => {
    const ok = { block: `已封禁「${src.label}」`, watch: `已把「${src.label}」加入观察`, none: `已解除「${src.label}」` }[mode]
    return run(`${src.subject}:${mode}`, () => setSourceMode({ data: { subject: src.subject, mode, until } }), ok)
  }

  return (
    <Panel title="可疑来源" flush acts={<span className="hint">今天和昨天（北京时间）签发最多、带可疑特征或在名单里的来源</span>}>
      <div className="tbl-wrap">
        <table className="tbl adm-src">
          <thead>
            <tr>
              <th>来源</th>
              <th className="n col-opt">原图</th>
              <th className="n col-opt">整包</th>
              <th className="col-opt">特征</th>
              <th>
                <span className="sr">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {!sources.length ? (
              <tr className="adm-empty-row">
                <td colSpan={5}>今天和昨天还没有下载记录，名单也是空的</td>
              </tr>
            ) : null}
            {sources.map((src) => {
              const listed = src.mode != null
              const mode = src.active ? src.mode : null
              return (
                <tr key={src.subject} data-subject={src.subject}>
                  <td>
                    <div className="adm-src-who">
                      <b className={cx(src.kind === 'user' && 'adm-dyn')}>{src.label}</b>
                      <small>{src.kind === 'user' ? '登录账号' : '游客 IP'}</small>
                      <SourceState src={src} />
                      {/* phones: the count and feature columns move in here */}
                      <span className="adm-src-ph">
                        <small>
                          原图 {fmtN(src.originals)} · 整包 {fmtN(src.packs)}
                        </small>
                        <Features f={src.features} empty={null} />
                      </span>
                    </div>
                  </td>
                  <td className="n col-opt">{fmtN(src.originals)}</td>
                  <td className="n col-opt">{fmtN(src.packs)}</td>
                  <td className="col-opt">
                    <Features f={src.features} />
                  </td>
                  <td>
                    <div className="row-acts adm-src-acts">
                      {mode !== 'block' ? (
                        <Button
                          size="xs"
                          variant="danger"
                          icon="ban"
                          disabled={busy != null}
                          onClick={() => {
                            setBlocking(src)
                            setOpen(true)
                          }}
                        >
                          封禁
                        </Button>
                      ) : null}
                      {mode !== 'watch' ? (
                        <Button size="xs" icon="eye" disabled={busy != null} onClick={() => void setMode(src, 'watch')}>
                          {mode === 'block' ? '改为观察' : '观察'}
                        </Button>
                      ) : null}
                      {listed ? (
                        <Button size="xs" variant="ghost" disabled={busy != null} onClick={() => void setMode(src, 'none')}>
                          {src.active ? '解除' : '移除'}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <ul className="rules adm-dl-legend">
        <li>
          <b>连续抓取</b>：同一 IP 在 5 分钟内签发了 30 张以上不同表情的原图，像是脚本在按顺序批量下载。只在「可疑时要求人机验证」打开时检测。
        </li>
        <li>
          <b>无 Referer</b>：下载请求不是从本站页面发起的（没有来源页，或来源是别的网站），常见于脚本直接请求或外站盗链。
        </li>
        <li>
          <b>被限流</b>：超过每分钟速率或每日限额而被拒绝。特征后面的数字是今天和昨天出现的次数。
        </li>
        <li>
          <b>观察</b>：这个来源每次下载前都要先通过人机验证，通过后 10 分钟内不再询问。<b>封禁</b>：原图、整包和打包下载一律拒绝，WebP 预览照常。
        </li>
        <li>登录用户的原图按账号计，其余按 IP 计；IP 只保存加盐哈希，看不到原始地址。</li>
      </ul>

      <Modal
        open={open}
        onOpenChange={setOpen}
        icon="ban"
        title={`封禁「${blocking?.label ?? ''}」？`}
        actions={
          <>
            <ModalClose render={<Button size="sm" variant="ghost" />}>取消</ModalClose>
            <Button
              size="sm"
              disabled={busy != null}
              onClick={async () => {
                if (blocking) await setMode(blocking, 'block', new Date(Date.now() + DAY_MS).toISOString())
                setOpen(false)
              }}
            >
              封禁 24 小时
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy != null}
              onClick={async () => {
                if (blocking) await setMode(blocking, 'block')
                setOpen(false)
              }}
            >
              封禁到手动解除
            </Button>
          </>
        }
      >
        {blocking?.kind === 'user'
          ? '这个账号登录时不能再下载原图、整包或打包清单，WebP 预览照常；退出登录后按所在 IP 判断。可以随时解除。'
          : '这个 IP 不能再下载原图、整包或打包清单，WebP 预览照常。同一网络下的其他访客（校园网、公司网络）也会受影响。可以随时解除。'}
      </Modal>
    </Panel>
  )
}

function SourceState({ src }: { src: SuspiciousSource }) {
  if (!src.mode) return null
  const label = src.mode === 'block' ? '已封禁' : '观察中'
  const until = src.until ? fmtDateTime(src.until) : null
  return (
    <span className="adm-src-state">
      {src.active ? <Pill tone={src.mode === 'block' ? 'err' : 'warn'}>{label}</Pill> : <Pill tone="mute">已过期</Pill>}
      <small>
        {src.active ? (until ? `到 ${until}` : '直到解除') : `${label}已于 ${until} 到期`}
        {src.reason ? ` · ${src.reason}` : ''}
      </small>
    </span>
  )
}

function Features({ f, empty = <span className="muted">无</span> }: { f: SuspiciousSource['features']; empty?: ReactNode }) {
  if (!f.burst && !f.noReferer && !f.throttled) return empty
  return (
    <div className="adm-src-flags">
      {f.burst ? <Pill tone="err">连续抓取 {fmtN(f.burst)}</Pill> : null}
      {f.noReferer ? <Pill tone="warn">无 Referer {fmtN(f.noReferer)}</Pill> : null}
      {f.throttled ? <Pill tone="warn">被限流 {fmtN(f.throttled)}</Pill> : null}
    </div>
  )
}
