import { useCallback, useEffect, useRef, useState } from 'react'
import { useOptionalSiteConfig } from '../site-config'
import { CapSession, INITIAL_CAP_STATUS, type CancelTimer, type CapRequestResult, type CapStatus } from './invisible'
import { solveInvisible } from './load'

// React side of the background Cap (src/ui/cap/invisible.ts): one CapSession while the form is on
// screen. The endpoint comes from the site config directly: the root layout's setCapEndpoint() runs in
// a parent effect, after this one.

export interface InvisibleCap extends CapStatus {
  /** solve in the background now unless a token is ready or on its way (form focus) */
  warm(): void
  /** solve again after a failure (the status line's 重试) */
  retry(): void
  /** one Cap-protected request with a fresh token; null when no token could be had (`failed`) */
  run<T extends CapRequestResult>(request: (token: string) => Promise<T>): Promise<T | null>
}

export interface InvisibleCapOptions {
  /**
   * Keep a ready token fresh: solve again before it gets old (the account forms, whose status line
   * says 「已通过人机验证」). A hidden tab waits until it is shown again.
   */
  refresh?: boolean
}

/** setTimeout that, when it fires in a hidden tab, waits until the tab is visible again. */
function visibleTimer(fn: () => void, ms: number): CancelTimer {
  let done = false
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return
    document.removeEventListener('visibilitychange', onVisible)
    if (!done) {
      done = true
      fn()
    }
  }
  const t = setTimeout(() => {
    if (document.visibilityState === 'visible') {
      done = true
      fn()
    } else document.addEventListener('visibilitychange', onVisible)
  }, ms)
  return () => {
    done = true
    clearTimeout(t)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

/** `active`: the form is on screen (false in a 「邮件已发出」 state, where nothing is solved). */
export function useInvisibleCap(active = true, { refresh = false }: InvisibleCapOptions = {}): InvisibleCap {
  const endpoint = useOptionalSiteConfig()?.cap.endpoint ?? null
  const [status, setStatus] = useState<CapStatus>(INITIAL_CAP_STATUS)
  const session = useRef<CapSession | null>(null)

  useEffect(() => {
    const missing = !endpoint && active
    setStatus({ ...INITIAL_CAP_STATUS, failed: missing, phase: missing ? 'failed' : 'idle' })
    if (!active || !endpoint) return
    const s = new CapSession({
      solve: (signal, onProgress) => solveInvisible(endpoint, signal, onProgress),
      onStatus: setStatus,
      refresh,
      timer: visibleTimer,
    })
    session.current = s
    // after hydration, not during it
    const timer = setTimeout(() => s.warm(), 0)
    return () => {
      clearTimeout(timer)
      s.dispose()
      if (session.current === s) session.current = null
    }
  }, [active, endpoint, refresh])

  const warm = useCallback(() => session.current?.warm(), [])
  const retry = useCallback(() => session.current?.retry(), [])
  const run = useCallback(<T extends CapRequestResult>(request: (token: string) => Promise<T>): Promise<T | null> => {
    const s = session.current
    return s ? s.run(request) : Promise.resolve(null)
  }, [])

  return { ...status, warm, retry, run }
}
