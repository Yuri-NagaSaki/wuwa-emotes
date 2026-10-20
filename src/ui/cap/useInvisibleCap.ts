import { useCallback, useEffect, useRef, useState } from 'react'
import { useOptionalSiteConfig } from '../site-config'
import { CapSession, type CapRequestResult, type CapStatus } from './invisible'
import { solveInvisible } from './load'

// React side of the invisible Cap (src/ui/cap/invisible.ts): one CapSession while the form is on
// screen. The endpoint comes from the site config directly: the root layout's setCapEndpoint() runs in
// a parent effect, after this one.

export interface InvisibleCap extends CapStatus {
  /** solve in the background now unless a token is ready or on its way (form focus) */
  warm(): void
  /** one Cap-protected request with a fresh token; null when no token could be had (`failed`) */
  run<T extends CapRequestResult>(request: (token: string) => Promise<T>): Promise<T | null>
}

/** `active`: the form is on screen (false in a 「邮件已发出」 state, where nothing is solved). */
export function useInvisibleCap(active = true): InvisibleCap {
  const endpoint = useOptionalSiteConfig()?.cap.endpoint ?? null
  const [status, setStatus] = useState<CapStatus>({ waiting: false, failed: false })
  const session = useRef<CapSession | null>(null)

  useEffect(() => {
    setStatus({ waiting: false, failed: !endpoint && active })
    if (!active || !endpoint) return
    const s = new CapSession({ solve: (signal) => solveInvisible(endpoint, signal), onStatus: setStatus })
    session.current = s
    // after hydration, not during it
    const timer = setTimeout(() => s.warm(), 0)
    return () => {
      clearTimeout(timer)
      s.dispose()
      if (session.current === s) session.current = null
    }
  }, [active, endpoint])

  const warm = useCallback(() => session.current?.warm(), [])
  const run = useCallback(<T extends CapRequestResult>(request: (token: string) => Promise<T>): Promise<T | null> => {
    const s = session.current
    return s ? s.run(request) : Promise.resolve(null)
  }, [])

  return { ...status, warm, run }
}
