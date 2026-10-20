import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '../Button'
import { cx } from '../cx'
import { fmtB } from '../format'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { Modal, ModalClose } from '../Modal'
import { isInAppBrowser } from '../pages/download'
import { packHref } from '../pages/model'
import { batchStore } from './store'
import { batchJob, IDLE_JOB, type JobState } from './job'
import { reasonText, volumeCount, type BatchGroup, type BatchView } from './plan'
import batchCss from './batch.css?url'

// Pieces shared by the 打包清单 tray and the /batch page: the summary, the list grouped by pack, and the
// download action with its progress. The list comes from src/ui/batch/store.ts (ids in localStorage).

export function BatchStyles() {
  return <link rel="stylesheet" href={batchCss} precedence="default" />
}

const subscribeJob = (l: () => void) => batchJob.subscribe(l)

export function useBatchJob(): JobState {
  return useSyncExternalStore(subscribeJob, batchJob.get, () => IDLE_JOB)
}

/** WeChat / QQ in-app browsers cannot save ZIP files. Client only (false in the server HTML). */
function useInAppBrowser(): boolean {
  const [inApp, setInApp] = useState(false)
  useEffect(() => setInApp(isInAppBrowser(navigator.userAgent)), [])
  return inApp
}

export function BatchSummary({ view }: { view: BatchView }) {
  const n = view.packable.length
  return (
    <div className="pk-sum">
      <div>
        <b className="num">{n}</b> 张<span>来自 {view.groups.length} 个包</span>
      </div>
      <div>
        <b className="num">{fmtB(view.bytes)}</b>
        <span>原图合计 · 附 CREDITS.txt</span>
      </div>
    </div>
  )
}

function Thumbs({ group, onRemove }: { group: BatchGroup; onRemove: (ids: string[]) => void }) {
  return (
    <div className="bthumbs">
      {group.items.map((i) => (
        <span key={i.id} className="bthumb">
          <img src={i.poster} width={240} height={240} alt={`${group.title} 第 ${i.index + 1} 张`} loading="lazy" decoding="async" />
          <button type="button" aria-label={`移出 ${group.title} 第 ${i.index + 1} 张`} onClick={() => onRemove([i.id])}>
            <Icon name="close" />
          </button>
        </span>
      ))}
    </div>
  )
}

/** The list grouped by pack; packs that only offer previews and stickers that are gone are shown apart. */
export function BatchGroups({ view, divided, onLinkClick }: { view: BatchView; divided?: boolean; onLinkClick?: () => void }) {
  const remove = (ids: string[]) => batchStore().remove(ids)
  const blocks: ReactNode[] = view.groups.map((g) => (
    <section key={g.slug} className="bgroup">
      <h4>
        <AppLink to={packHref(g.slug)} onClick={onLinkClick}>
          {g.title}
        </AppLink>
        <small>{g.items.length} 张</small>
      </h4>
      <Thumbs group={g} onRemove={remove} />
    </section>
  ))
  for (const g of view.previewOnly) {
    blocks.push(
      <section key={`pv:${g.slug}`} className="bgroup is-off">
        <h4>
          <AppLink to={packHref(g.slug)} onClick={onLinkClick}>
            {g.title}
          </AppLink>
          <small>不能打包</small>
        </h4>
        <div className="note-box warn">
          <Icon name="lock" size="sm" />
          <span>
            这个包<b>只提供预览</b>：可以浏览、收藏和复制链接，不提供原图，也不会放进压缩包。
            <button type="button" className="bg-link" onClick={() => remove(g.items.map((i) => i.id))}>
              移出这 {g.items.length} 张
            </button>
          </span>
        </div>
        <Thumbs group={g} onRemove={remove} />
      </section>,
    )
  }
  if (view.missing.length) {
    blocks.push(
      <section key="missing" className="bgroup is-off">
        <h4>
          已下架的表情<small>{view.missing.length} 张</small>
        </h4>
        <div className="note-box warn">
          <Icon name="info" size="sm" />
          <span>
            这些表情已经下架或暂时不可见，不会放进压缩包。
            <button type="button" className="bg-link" onClick={() => remove(view.missing)}>
              全部移出
            </button>
          </span>
        </div>
      </section>,
    )
  }
  if (view.loading.length) {
    blocks.push(
      <p key="loading" className="bg-loading">
        <span className="wave-loader" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        正在读取 {view.loading.length} 张表情…
      </p>,
    )
  }
  return (
    <>
      {blocks.map((b, k) => (
        <div key={k} className="bgroup-wrap">
          {divided && k > 0 ? <hr className="pk-hr" /> : null}
          {b}
        </div>
      ))}
    </>
  )
}

const PHASE_TEXT: Record<string, string> = {
  sign: '正在签发下载链接…',
  fetch: '正在下载原图并打包…',
  captcha: '正在进行人机验证…',
}

function failureSummary(failed: JobState['failed']): string[] {
  const by = new Map<string, number>()
  for (const f of failed) by.set(f.reason, (by.get(f.reason) ?? 0) + 1)
  return [...by.entries()].map(([reason, n]) => `${reasonText(reason)} ${n} 张`)
}

/** Start / progress / next volume / result. `view` is the current list (the job keeps its own copy). */
export function BatchAction({ view, onDone }: { view: BatchView; onDone?: () => void }) {
  const job = useBatchJob()
  const inApp = useInAppBrowser()
  const n = view.packable.length
  const vols = volumeCount(n)

  if (job.status === 'running') {
    const pct = job.total ? Math.max(1, Math.min(99, Math.floor((job.done / job.total) * 100))) : 1
    const label = job.phase === 'wait' && job.waitSeconds ? `签发太频繁，${job.waitSeconds} 秒后继续` : (PHASE_TEXT[job.phase ?? 'sign'] ?? '正在打包…')
    return (
      <div className="batch-act">
        <Button variant="primary" block icon="box" progress={pct}>
          正在打包 {pct}%
        </Button>
        <div className="batch-status" role="status">
          <span>
            {label}
            {job.volumes > 1 ? ` 第 ${job.volume} / ${job.volumes} 个压缩包` : ''}
          </span>
          <button type="button" className="bg-link" onClick={() => batchJob.cancel()}>
            取消
          </button>
        </div>
        <span className="hint">原图直接从存储读取，不经过网站服务器。打包完成前请不要关闭页面。</span>
      </div>
    )
  }

  const saved = job.saved.length ? (
    <ul className="batch-saved">
      {job.saved.map((z) => (
        <li key={z.url}>
          <Icon name="check" size="sm" />
          <span>
            <b>{z.name}</b>
            <small>
              {z.count} 张 · {fmtB(z.bytes)}
            </small>
          </span>
          <a href={z.url} download={z.name} className="bg-link">
            再次保存
          </a>
        </li>
      ))}
    </ul>
  ) : null

  if (job.status === 'between') {
    return (
      <div className="batch-act">
        {saved}
        <Button variant="primary" block icon="download" onClick={() => batchJob.next()}>
          继续打包第 {job.volume + 1} 个压缩包（还剩 {job.remaining.length} 张）
        </Button>
        <div className="batch-status">
          <span>每个压缩包最多 200 张，浏览器会逐个询问保存。</span>
          <button type="button" className="bg-link" onClick={() => batchJob.reset()}>
            结束
          </button>
        </div>
      </div>
    )
  }

  if (job.status === 'done' || job.status === 'cancelled') {
    const failures = failureSummary(job.failed)
    const notPacked = job.remaining.length
    const stop = job.stop
    const finish = () => {
      batchJob.reset()
      onDone?.()
    }
    return (
      <div className="batch-act">
        {saved}
        {job.status === 'cancelled' ? (
          <div className="note-box">
            <Icon name="info" size="sm" />
            <span>已取消。{job.saved.length ? '已经保存的压缩包不受影响。' : '没有生成压缩包。'}</span>
          </div>
        ) : null}
        {stop ? (
          <div className="note-box warn" role="alert">
            <Icon name="warn" size="sm" />
            <span>
              {stop.message}
              {stop.loginRaisesLimit || stop.reason === 'login_required' ? (
                <>
                  {' '}
                  <AppLink to="/login" className="bg-link">
                    登录
                  </AppLink>
                </>
              ) : null}
              {notPacked ? `（还有 ${notPacked} 张没有打包）` : ''}
            </span>
          </div>
        ) : null}
        {failures.length ? (
          <div className="note-box warn">
            <Icon name="warn" size="sm" />
            <span>没有打包：{failures.join('，')}。这些表情留在清单里。</span>
          </div>
        ) : null}
        {job.packed.length ? (
          <Button variant="sun" block icon="check" onClick={() => (batchStore().remove(job.packed), finish())}>
            从清单移出已打包的 {job.packed.length} 张
          </Button>
        ) : null}
        <Button block onClick={finish}>
          {job.packed.length ? '保留清单' : '好的'}
        </Button>
      </div>
    )
  }

  return (
    <div className="batch-act">
      {inApp ? (
        <div className="note-box warn">
          <Icon name="warn" size="sm" />
          <span>微信、QQ 内置浏览器无法下载压缩包，请点右上角「在浏览器打开」。</span>
        </div>
      ) : null}
      <Button variant="primary" block icon="download" disabled={!n || inApp || view.loading.length > 0} onClick={() => batchJob.start(view.packable)}>
        打包下载原图（{n} 张）
      </Button>
      <span className="hint">
        在浏览器里打包，默认不需要登录；{vols > 1 ? `将分成 ${vols} 个压缩包。` : '每 200 张一个压缩包。'}站长开启下载限额后，按设置计数。
      </span>
    </div>
  )
}

/** 清空 with a confirmation. */
export function ClearBatch({ count, className }: { count: number; className?: string }) {
  const [open, setOpen] = useState(false)
  const job = useBatchJob()
  if (!count) return null
  return (
    <>
      <button type="button" className={cx('bg-link', className)} onClick={() => setOpen(true)} disabled={job.status === 'running'}>
        清空清单
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        icon="trash"
        title="清空打包清单？"
        actions={
          <>
            <Button variant="danger" onClick={() => (batchStore().clear(), setOpen(false))}>
              清空 {count} 张
            </Button>
            <ModalClose render={<Button variant="ghost" />}>取消</ModalClose>
          </>
        }
      >
        清单里的表情会全部移出，已经下载的压缩包不受影响。
      </Modal>
    </>
  )
}
