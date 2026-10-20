import { volumeCount, zipFileName } from './plan'
import type { Phase, RunnerDeps, Stop } from './runner'

// The batch download in progress, shared by the tray and /batch (one job per page; it survives client
// navigation and closing the tray). The runner and client-zip load on start. Volumes are built one at a
// time: the first ZIP is saved as soon as it is ready; each further ZIP waits for a click (browsers block
// a series of automatic downloads), which also keeps only one ZIP in memory while it is being built.

export interface SavedZip {
  name: string
  /** object URL, kept for 再次保存 until the job is reset */
  url: string
  count: number
  bytes: number
}

export interface JobFailure {
  id: string
  reason: string
  message: string
}

export interface JobState {
  status: 'idle' | 'running' | 'between' | 'done' | 'cancelled'
  phase: Phase | null
  /** ids the job started with */
  total: number
  /** ids handled so far (packed or failed) */
  done: number
  bytes: number
  waitSeconds: number | null
  /** volume being built (or last built), 1-based */
  volume: number
  /** volumes expected, given what is left */
  volumes: number
  saved: SavedZip[]
  failed: JobFailure[]
  packed: string[]
  /** ids not packed yet: the next volume's, or never (after a stop or cancel) */
  remaining: string[]
  stop: Stop | null
}

const IDLE: JobState = {
  status: 'idle',
  phase: null,
  total: 0,
  done: 0,
  bytes: 0,
  waitSeconds: null,
  volume: 0,
  volumes: 0,
  saved: [],
  failed: [],
  packed: [],
  remaining: [],
  stop: null,
}

let state: JobState = IDLE
let ctl: AbortController | null = null
const listeners = new Set<() => void>()

function set(patch: Partial<JobState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function saveBlob(blob: Blob, name: string): string {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.append(a)
  a.click()
  a.remove()
  return url
}

async function realDeps(): Promise<RunnerDeps> {
  const [{ downloadZip }, { abortableSleep }] = await Promise.all([import('client-zip'), import('../pages/download')])
  return {
    sign: (body, { capToken, signal }) =>
      fetch('/api/batch/sign', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...(capToken ? { 'x-cap-token': capToken } : {}) },
        body: JSON.stringify(body),
        credentials: 'same-origin',
        signal,
      }),
    // a simple CORS GET: no custom headers, no cookies
    fetchFile: (url, signal) => fetch(url, { mode: 'cors', credentials: 'omit', signal }),
    zip: (entries) => downloadZip(entries).blob(),
    sleep: abortableSleep,
    solveCap: async () => (await import('../cap/load')).solveInvisible(),
    uuid: () => crypto.randomUUID(),
  }
}

async function runVolume() {
  ctl?.abort()
  const mine = new AbortController()
  ctl = mine
  const doneBefore = state.done
  const bytesBefore = state.bytes
  const volume = state.volume + 1
  set({ status: 'running', phase: 'sign', volume, waitSeconds: null, stop: null })
  try {
    const { buildVolume } = await import('./runner')
    const deps = await realDeps()
    const r = await buildVolume(state.remaining, deps, {
      signal: mine.signal,
      onProgress: (p) => set({ phase: p.phase, done: doneBefore + p.done, bytes: bytesBefore + p.bytes, waitSeconds: p.waitSeconds ?? null }),
    })
    let saved = state.saved
    if (r.blob) {
      const multi = volume > 1 || (r.rest.length > 0 && !r.stop)
      const name = zipFileName(window.location.hostname, r.files.length, volume, multi ? 2 : 1)
      const bytes = r.files.reduce((s, f) => s + f.bytes, 0)
      saved = [...saved, { name, url: saveBlob(r.blob, name), count: r.files.length, bytes }]
    }
    const more = !r.stop && r.rest.length > 0
    set({
      status: more ? 'between' : 'done',
      phase: null,
      waitSeconds: null,
      saved,
      failed: [...state.failed, ...r.failed],
      packed: [...state.packed, ...r.files.map((f) => f.id)],
      remaining: r.rest,
      stop: r.stop,
      done: doneBefore + r.files.length + r.failed.length,
      volumes: more ? volume + volumeCount(r.rest.length) : volume,
    })
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'AbortError' || mine.signal.aborted) set({ status: 'cancelled', phase: null, waitSeconds: null })
    else set({ status: 'done', phase: null, waitSeconds: null, stop: { reason: 'error', message: '打包时出错了，请稍后再试', retryAfter: null, loginRaisesLimit: false } })
  } finally {
    if (ctl === mine) ctl = null
  }
}

function revokeAll() {
  for (const z of state.saved) URL.revokeObjectURL(z.url)
}

export const batchJob = {
  get: (): JobState => state,
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  /** Start packing these ids (the packable ones, in list order). */
  start(ids: readonly string[]) {
    if (state.status === 'running' || !ids.length) return
    revokeAll()
    state = { ...IDLE, total: ids.length, remaining: [...ids], volumes: volumeCount(ids.length) }
    void runVolume()
  },
  /** Build the next ZIP (status 'between'). */
  next() {
    if (state.status !== 'between') return
    void runVolume()
  },
  cancel() {
    ctl?.abort()
  },
  /** Back to idle; forgets the saved ZIPs. */
  reset() {
    ctl?.abort()
    revokeAll()
    state = IDLE
    listeners.forEach((l) => l())
  },
}

export const IDLE_JOB = IDLE
