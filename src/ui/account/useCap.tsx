import { useCallback, useRef, useState, type ReactNode } from 'react'
import { CapWidget } from '../cap/CapWidget'

// One Cap widget per form. Tokens are single-use: `take()` hands the current token to exactly one
// request, and `renew()` (call it after every attempt, failed or not) resets the widget and starts a
// new proof of work right away, so the visitor does not have to click again.

export interface CapState {
  /** the widget, render it where the prototype shows 人机验证 */
  node: ReactNode
  token: string | null
  /** the token for one request (cleared) */
  take(): string | null
  /** the current token, or solve one now (the visitor need not click the widget first) */
  ensure(): Promise<string | null>
  /** discard the used token and solve a fresh one */
  renew(): void
  error: string | null
}

export function useCap(): CapState {
  const [key, setKey] = useState(0)
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const current = useRef<string | null>(null)

  const take = useCallback(() => {
    const t = current.current
    current.current = null
    setToken(null)
    return t
  }, [])

  const ensure = useCallback(async () => {
    const t = take()
    if (t) return t
    const el = box.current?.querySelector('cap-widget')
    if (!el || typeof el.solve !== 'function') return null
    try {
      const r = await el.solve()
      // the solve event may have stored it too; it is spent by this request either way
      current.current = null
      setToken(null)
      return r.success && r.token ? r.token : null
    } catch {
      return null
    }
  }, [take])

  const renew = useCallback(() => {
    current.current = null
    setToken(null)
    const el = box.current?.querySelector('cap-widget')
    if (el && typeof el.solve === 'function') {
      try {
        el.reset()
        el.solve().catch(() => setKey((k) => k + 1))
        return
      } catch {
        // fall through: remount a fresh widget
      }
    }
    setKey((k) => k + 1)
  }, [])

  const node = (
    <div ref={box} className="cap-slot">
      <CapWidget
        key={key}
        onToken={(t) => {
          current.current = t
          setToken(t)
          setError(null)
        }}
        onReset={() => {
          current.current = null
          setToken(null)
        }}
        onError={() => setError('人机验证没有完成，请重试')}
      />
    </div>
  )
  return { node, token, take, ensure, renew, error }
}
