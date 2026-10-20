import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../Toast'
import type { DownloadResult, DownloadTarget } from './download'

// UI wrapper around download.ts: one in-flight download per component, toasts for progress and
// errors, aborted on unmount. The helper and the Cap widget are loaded on first use.

export type DownloadFailure = Extract<DownloadResult, { ok: false }>

export interface DownloadState {
  /** the target key while a request runs ("zip:<slug>", "save:<id>", "view:<id>") */
  busy: string | null
  building: boolean
  error: DownloadFailure | null
}

const IN_APP: DownloadFailure = {
  ok: false,
  status: 0,
  reason: 'in_app_browser',
  message: '微信、QQ 内置浏览器无法下载压缩包，请点右上角「在浏览器打开」',
  retryAfter: null,
  loginRaisesLimit: false,
}

export function targetKey(t: DownloadTarget): string {
  return t.kind === 'zip' ? `zip:${t.slug}` : `${t.mode}:${t.id}`
}

export function useDownload() {
  const [state, setState] = useState<DownloadState>({ busy: null, building: false, error: null })
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const run = useCallback(async (target: DownloadTarget): Promise<DownloadResult | null> => {
    const mod = await import('./download')
    if (target.kind === 'zip' && mod.isInAppBrowser(navigator.userAgent)) {
      setState({ busy: null, building: false, error: IN_APP })
      toast({ message: IN_APP.message, icon: 'warn', duration: 4000 })
      return IN_APP
    }
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    const key = targetKey(target)
    setState({ busy: key, building: false, error: null })
    let announced = false
    try {
      const result = await mod.requestDownload(
        target,
        {
          fetch: (url, init) => fetch(url, init),
          sleep: mod.abortableSleep,
          solveCap: async () => (await import('../cap/load')).solveInvisible(),
          navigate: (url) => {
            window.location.href = url
          },
        },
        {
          signal: ctl.signal,
          onEvent: (e) => {
            if (e.type === 'building') {
              setState((s) => ({ ...s, building: true }))
              if (!announced) {
                announced = true
                toast({ message: '正在生成整包 ZIP', detail: '好了会自动开始下载，不用离开页面', icon: 'box', duration: 4000 })
              }
            } else if (e.type === 'captcha') {
              toast({ message: '正在进行人机验证…', icon: 'shield' })
            }
          },
        },
      )
      if (ctl.signal.aborted) return null
      if (result.ok) {
        setState({ busy: null, building: false, error: null })
        if (target.kind === 'zip' || target.mode === 'save') toast({ message: '开始下载', detail: result.filename ?? undefined, icon: 'download' })
      } else {
        setState({ busy: null, building: false, error: result })
        toast({ message: result.message, detail: result.loginRaisesLimit ? '登录后额度更高' : undefined, icon: 'warn', duration: 4000 })
      }
      return result
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || ctl.signal.aborted) return null
      throw err
    } finally {
      if (abort.current === ctl) abort.current = null
    }
  }, [])

  const clearError = useCallback(() => setState((s) => ({ ...s, error: null })), [])
  return { ...state, run, clearError }
}
