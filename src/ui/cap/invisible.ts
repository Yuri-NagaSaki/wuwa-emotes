// Cap for one form (登录 / 注册 / 找回密码, a guest comment); the React side is useInvisibleCap.ts and
// the account forms' status line is CapStatus.tsx. The proof of work starts in the background as soon
// as the form is on screen, so the token is usually ready when the visitor submits; otherwise submit
// waits for it (`waiting`, the button says 验证中…). Every solve is retried once, silently.
//
// Two views of the same session:
// - `phase` (idle → solving → ready, or failed) and `progress` describe the background solve. The
//   account forms show them in a quiet line above the submit button (CapStatus.tsx), 重试 calls
//   retry(). With `refresh`, a ready token is solved again before it gets old, so 「已通过」 never sits
//   on a stale token.
// - `failed` is set only when a submit got no token. Comments show nothing until then (their line
//   with 重试 submits again), so a background failure alone does not set it.
//
// Tokens are single-use and the server checks them before anything else happens
// (src/server/auth/auth.ts), so a request rejected for its token alone (expired, already used) is sent
// once more with a fresh one. After any other failed request the next token is solved right away, so
// a second attempt (a mistyped password) does not wait. Pure: the solver, the clock and the timer are
// injected.

/** Server error codes that mean "this token", not "this request". */
export const TOKEN_REJECTED: ReadonlySet<string> = new Set(['CAPTCHA_MISSING', 'CAPTCHA_INVALID'])

/** A token older than this is solved again; Cap's own expiry is longer. */
export const MAX_TOKEN_AGE_MS = 4 * 60_000

/** Shape of a Better Auth client result. */
export interface CapRequestResult {
  error: { code?: string } | null
}

/**
 * The background solve: `idle` before the first one starts (and after a token was spent), `solving`
 * while a proof of work runs, `ready` with a fresh token, `failed` when a solve failed twice.
 */
export type CapPhase = 'idle' | 'solving' | 'ready' | 'failed'

export interface CapStatus {
  /** submit is waiting for a proof of work that has not finished yet */
  waiting: boolean
  /** a submit got no token (after the silent retry): show the line with a retry action */
  failed: boolean
  phase: CapPhase
  /** 0–100 as reported by the solver while solving; null before its first report */
  progress: number | null
}

export const INITIAL_CAP_STATUS: CapStatus = { waiting: false, failed: false, phase: 'idle', progress: null }

/** Cancels a scheduled callback. */
export type CancelTimer = () => void

export interface CapSessionDeps {
  /** One invisible solve (solveInvisible); rejects on failure. `onProgress` gets 0–100. */
  solve: (signal: AbortSignal, onProgress: (progress: number) => void) => Promise<string>
  onStatus?: (status: CapStatus) => void
  now?: () => number
  /** Solve again MAX_TOKEN_AGE_MS after a token is ready, while it is unused (the account forms). */
  refresh?: boolean
  /** setTimeout stand-in for `refresh`. */
  timer?: (fn: () => void, ms: number) => CancelTimer
}

function defaultTimer(fn: () => void, ms: number): CancelTimer {
  const t = setTimeout(fn, ms)
  return () => clearTimeout(t)
}

export class CapSession {
  private token: string | null = null
  private solvedAt = 0
  private pending: Promise<string | null> | null = null
  /** the last solve failed (both tries): warm() waits for the next submit or retry() */
  private lastFailed = false
  private readonly ctrl = new AbortController()
  private status: CapStatus = INITIAL_CAP_STATUS
  private readonly now: () => number
  private cancelRefresh: CancelTimer | null = null

  constructor(private readonly deps: CapSessionDeps) {
    this.now = deps.now ?? Date.now
  }

  get waiting(): boolean {
    return this.status.waiting
  }

  get failed(): boolean {
    return this.status.failed
  }

  get phase(): CapPhase {
    return this.status.phase
  }

  get progress(): number | null {
    return this.status.progress
  }

  /** Solve in the background unless a token is ready or on its way, or the last solve failed. */
  warm(): void {
    if (this.ctrl.signal.aborted || this.lastFailed || this.pending || this.fresh()) return
    this.dropToken()
    void this.solve()
  }

  /** The visitor asked for another try after a failure (重试): solve again now. */
  retry(): void {
    if (this.ctrl.signal.aborted) return
    this.lastFailed = false
    this.set({ failed: false })
    this.warm()
  }

  /**
   * Run one Cap-protected request with a fresh token. Resolves with the request's result, or null when
   * no token could be had (`failed` is then true). A request that throws is rethrown.
   */
  async run<T extends CapRequestResult>(request: (token: string) => Promise<T>): Promise<T | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.fresh()) this.set({ waiting: true, failed: false })
      const token = await this.take()
      if (!token) {
        this.set({ waiting: false, failed: !this.ctrl.signal.aborted })
        return null
      }
      this.set({ waiting: false })
      let res: T
      try {
        res = await request(token)
      } catch (err) {
        this.warm()
        throw err
      }
      if (!res.error) {
        // the token is spent and nothing is on its way
        if (!this.pending && !this.token) this.set({ phase: 'idle', progress: null })
        return res
      }
      const code = res.error.code
      if (code && TOKEN_REJECTED.has(code)) continue
      this.warm()
      return res
    }
    // the server refused two fresh tokens
    this.set({ failed: true, phase: 'failed', progress: null })
    return null
  }

  /** Stop: abort a running solve and drop the token. */
  dispose(): void {
    this.ctrl.abort()
    this.dropToken()
    this.pending = null
  }

  private fresh(): boolean {
    return this.token != null && this.now() - this.solvedAt < MAX_TOKEN_AGE_MS
  }

  private dropToken() {
    this.token = null
    this.cancelRefresh?.()
    this.cancelRefresh = null
  }

  private set(patch: Partial<CapStatus>) {
    const next = { ...this.status, ...patch }
    const cur = this.status
    if (next.waiting === cur.waiting && next.failed === cur.failed && next.phase === cur.phase && next.progress === cur.progress) return
    this.status = next
    if (!this.ctrl.signal.aborted) this.deps.onStatus?.(next)
  }

  /** The token being solved, or a new solve (one silent retry). Never rejects. */
  private solve(): Promise<string | null> {
    if (this.pending) return this.pending
    const signal = this.ctrl.signal
    if (signal.aborted) return Promise.resolve(null)
    let p!: Promise<string | null>
    const onProgress = (value: number) => {
      if (this.pending !== p || signal.aborted || !Number.isFinite(value)) return
      const rounded = Math.max(0, Math.min(100, Math.round(value)))
      // a report of 0 is "started", not a position on the bar
      if (rounded > 0) this.set({ progress: rounded })
    }
    const attempt = () => {
      this.set({ phase: 'solving', progress: null })
      return this.deps.solve(signal, onProgress)
    }
    p = attempt()
      .catch(() => (signal.aborted ? null : attempt()))
      .catch(() => null)
      .then((token) => {
        if (this.pending === p) this.pending = null
        if (signal.aborted) return null
        this.lastFailed = !token
        if (token) {
          this.token = token
          this.solvedAt = this.now()
          this.set({ phase: 'ready', progress: null })
          this.scheduleRefresh(token)
        } else {
          this.set({ phase: 'failed', progress: null })
        }
        return token
      })
    this.pending = p
    return p
  }

  /** With `refresh`: an unused token is replaced before it gets old. */
  private scheduleRefresh(token: string) {
    if (!this.deps.refresh) return
    this.cancelRefresh?.()
    const timer = this.deps.timer ?? defaultTimer
    this.cancelRefresh = timer(() => {
      this.cancelRefresh = null
      if (this.ctrl.signal.aborted || this.token !== token) return
      this.dropToken()
      void this.solve()
    }, MAX_TOKEN_AGE_MS)
  }

  /** The ready token, or the one being solved; spent by the caller. */
  private async take(): Promise<string | null> {
    if (!this.fresh()) {
      this.dropToken()
      await this.solve()
    }
    const token = this.token
    this.dropToken()
    return token
  }
}
