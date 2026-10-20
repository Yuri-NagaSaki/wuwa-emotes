import { useCallback, useEffect, useRef, useState } from 'react'

// Invisible Cap for guest comments: no widget box. The proof of work starts in the background once the
// guest starts writing, so 发布 usually finds a token waiting; if not, 发布 waits for it (status next to
// the button: 正在验证… → 人机验证已通过). Tokens are single-use: every send takes the token and the next
// one is solved when the guest writes again. A failed or timed-out solve shows a retry; nothing is sent
// without a token. Signed-in users never get here. (Wraps solveInvisible from src/ui/cap/load.ts.)

export type CapStatus = 'idle' | 'solving' | 'ready' | 'failed'

/** A token older than this is solved again before use (Cap tokens expire). */
const TOKEN_TTL_MS = 4 * 60_000
const SOLVE_TIMEOUT_MS = 45_000

export interface GuestCap {
  status: CapStatus
  error: string | null
  /** start solving in the background (no-op while solving or holding a fresh token) */
  warm(): void
  /** the token for one request: waits for a running solve, or solves now; null when it failed */
  take(): Promise<string | null>
  /** forget a failure and try again */
  retry(): void
}

export type Solver = () => Promise<string>

const defaultSolver: Solver = async () => (await import('../cap/load')).solveInvisible()

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    )
  })
}

export function useGuestCap(enabled: boolean, solver: Solver = defaultSolver): GuestCap {
  const [status, setStatus] = useState<CapStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const token = useRef<{ value: string; at: number } | null>(null)
  const running = useRef<Promise<string | null> | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const solve = useCallback((): Promise<string | null> => {
    if (running.current) return running.current
    setStatus('solving')
    setError(null)
    const p = withTimeout(solver(), SOLVE_TIMEOUT_MS)
      .then((value) => {
        token.current = { value, at: Date.now() }
        if (alive.current) setStatus('ready')
        return value
      })
      .catch((err: Error) => {
        token.current = null
        if (alive.current) {
          setStatus('failed')
          setError(err?.message === 'timeout' ? '人机验证超时了' : '人机验证没有通过')
        }
        return null
      })
      .finally(() => {
        running.current = null
      })
    running.current = p
    return p
  }, [solver])

  const fresh = () => !!token.current && Date.now() - token.current.at < TOKEN_TTL_MS

  const warm = useCallback(() => {
    if (!enabled || running.current || fresh()) return
    if (status === 'failed') return // wait for 重试 or 发布
    void solve()
  }, [enabled, solve, status])

  const take = useCallback(async () => {
    if (!enabled) return null
    let value: string | null = null
    if (fresh()) value = token.current!.value
    else value = await solve()
    token.current = null
    if (alive.current && value) setStatus('idle')
    return value
  }, [enabled, solve])

  const retry = useCallback(() => {
    setError(null)
    void solve()
  }, [solve])

  return { status, error, warm, take, retry }
}
