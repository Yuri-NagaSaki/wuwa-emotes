// Invisible Cap for one form (登录 / 注册 / 找回密码); the React side is useInvisibleCap.ts. Nothing
// is shown: the proof of work starts in the background as soon as the form is on screen, so the token
// is usually ready when the visitor submits; otherwise submit waits for it (`waiting`, the button says
// 验证中…). Every solve is retried once, silently. A background solve that still fails stays silent
// (submit tries again); a submit that gets no token sets `failed`, and the form shows one line whose
// retry action submits again.
//
// Tokens are single-use and the server checks them before anything else happens
// (src/server/auth/auth.ts), so a request rejected for its token alone (expired, already used) is sent
// once more with a fresh one. After any other failed request the next token is solved right away, so
// a second attempt (a mistyped password) does not wait. Pure: the solver and the clock are injected.

/** Server error codes that mean "this token", not "this request". */
export const TOKEN_REJECTED: ReadonlySet<string> = new Set(['CAPTCHA_MISSING', 'CAPTCHA_INVALID'])

/** A token older than this is solved again; Cap's own expiry is longer. */
export const MAX_TOKEN_AGE_MS = 4 * 60_000

/** Shape of a Better Auth client result. */
export interface CapRequestResult {
  error: { code?: string } | null
}

export interface CapStatus {
  /** submit is waiting for a proof of work that has not finished yet */
  waiting: boolean
  /** no token after the silent retry: show the line with a retry action */
  failed: boolean
}

export interface CapSessionDeps {
  /** One invisible solve (solveInvisible); rejects on failure. */
  solve: (signal: AbortSignal) => Promise<string>
  onStatus?: (status: CapStatus) => void
  now?: () => number
}

export class CapSession {
  private token: string | null = null
  private solvedAt = 0
  private pending: Promise<string | null> | null = null
  /** the last solve failed (both tries): warm() waits for the next submit */
  private lastFailed = false
  private readonly ctrl = new AbortController()
  private status: CapStatus = { waiting: false, failed: false }
  private readonly now: () => number

  constructor(private readonly deps: CapSessionDeps) {
    this.now = deps.now ?? Date.now
  }

  get waiting(): boolean {
    return this.status.waiting
  }

  get failed(): boolean {
    return this.status.failed
  }

  /** Solve in the background unless a token is ready or on its way, or the last solve failed. */
  warm(): void {
    if (this.ctrl.signal.aborted || this.lastFailed || this.pending || this.fresh()) return
    this.token = null
    void this.solve()
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
      if (!res.error) return res
      const code = res.error.code
      if (code && TOKEN_REJECTED.has(code)) continue
      this.warm()
      return res
    }
    // the server refused two fresh tokens
    this.set({ failed: true })
    return null
  }

  /** Stop: abort a running solve and drop the token. */
  dispose(): void {
    this.ctrl.abort()
    this.token = null
    this.pending = null
  }

  private fresh(): boolean {
    return this.token != null && this.now() - this.solvedAt < MAX_TOKEN_AGE_MS
  }

  private set(patch: Partial<CapStatus>) {
    const next = { ...this.status, ...patch }
    if (next.waiting === this.status.waiting && next.failed === this.status.failed) return
    this.status = next
    if (!this.ctrl.signal.aborted) this.deps.onStatus?.(next)
  }

  /** The token being solved, or a new solve (one silent retry). Never rejects. */
  private solve(): Promise<string | null> {
    if (this.pending) return this.pending
    const signal = this.ctrl.signal
    if (signal.aborted) return Promise.resolve(null)
    const attempt = () => this.deps.solve(signal)
    const p: Promise<string | null> = attempt()
      .catch(() => (signal.aborted ? null : attempt()))
      .catch(() => null)
      .then((token) => {
        if (this.pending === p) this.pending = null
        if (signal.aborted) return null
        this.lastFailed = !token
        if (token) {
          this.token = token
          this.solvedAt = this.now()
        }
        return token
      })
    this.pending = p
    return p
  }

  /** The ready token, or the one being solved; spent by the caller. */
  private async take(): Promise<string | null> {
    if (!this.fresh()) {
      this.token = null
      await this.solve()
    }
    const token = this.token
    this.token = null
    return token
  }
}
