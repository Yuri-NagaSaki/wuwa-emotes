import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import { verifyCapToken } from '../auth/cap'
import { db, schema } from '../db/client'
import type { CounterKind } from '../db/schema/downloads'
import { log } from '../log'
import { hitWindow } from '../ratelimit'
import type { Feature, PolicyDeps, SourceEntry, VolumeState } from './policy'

// PostgreSQL side of the download policy. Everything is shared by both web replicas: download_counters
// for daily limits, rate_windows (UNLOGGED) for minute rates and the short-lived state below, and
// blocked_sources for the 可疑来源 list. An in-process cache would let a visitor who passed Cap on one
// replica be challenged again on the other, so nothing here is kept in memory.
//
// rate_windows rows written here, by bucket:
//   dl:single, dl:batch    per-minute rate windows (src/server/ratelimit.ts hitWindow)
//   seen:<emojiId>, burst  burst detection: one row per (IP, emoji id, 5-minute window) plus a counter
//                          of distinct ids in that window
//   cap-ok                 challenge cleared: window_start holds the expiry (now + 10 minutes)
//   vol:<uuid>             batch volume: n = items signed; window_start holds the expiry (first seen + 1 day)
//   flag:<feature>         features for 可疑来源 (burst, noref, throttled), per Shanghai day; window_start
//                          holds the expiry (end of the following day)
// The daily cleanup (pruneWindows) deletes rows whose window_start is more than an hour old, so rows
// that store an expiry live until an hour after it, and ordinary windows for about a day.

export const CLEARED_BUCKET = 'cap-ok'
export const BURST_BUCKET = 'burst'
export const flagBucket = (f: Feature) => `flag:${f}`
export const volumeBucket = (id: string) => `vol:${id}`

/** 00:00 Asia/Shanghai of a counter day (YYYY-MM-DD). */
export function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00+08:00`)
}

/** Expiry of the flag rows of `day`: the end of the following day, so "today and yesterday" are always there. */
export function flagExpiry(day: string): Date {
  return new Date(dayStart(day).getTime() + 2 * 86_400_000)
}

function windowStart(now: number, windowSeconds: number): Date {
  const ms = windowSeconds * 1000
  return new Date(Math.floor(now / ms) * ms)
}

export const pgPolicyDeps: PolicyDeps = {
  now: () => new Date(),

  async sources(subjects): Promise<SourceEntry[]> {
    if (!subjects.length) return []
    const { blockedSources: b } = schema
    return db().select({ subject: b.subject, mode: b.mode, until: b.until }).from(b).where(inArray(b.subject, subjects))
  },

  async hitRate(subject, bucket, windowSeconds, amount) {
    const n = await hitWindow(subject, bucket, windowSeconds, amount)
    const now = Date.now()
    const end = windowStart(now, windowSeconds).getTime() + windowSeconds * 1000
    return { n, retryAfter: Math.max(1, Math.ceil((end - now) / 1000)) }
  },

  async counts(subject, day) {
    const { downloadCounters: c } = schema
    const rows = await db()
      .select({ kind: c.kind, n: c.n })
      .from(c)
      .where(and(eq(c.subject, subject), eq(c.day, day)))
    return Object.fromEntries(rows.map((r) => [r.kind, r.n])) as Partial<Record<CounterKind, number>>
  },

  async addCount(subject, day, kind, n) {
    if (n <= 0) return
    const { downloadCounters: c } = schema
    await db()
      .insert(c)
      .values({ subject, day, kind, n })
      .onConflictDoUpdate({ target: [c.subject, c.day, c.kind], set: { n: sql`${c.n} + ${n}` } })
  },

  async observeEmoji(ip, emojiId, windowSeconds) {
    const ws = windowStart(Date.now(), windowSeconds)
    // count the id only the first time this IP signs it in the window; the final SELECT reads the
    // snapshot from before the CTEs, so it returns the stored count when nothing was bumped
    const res = await db().execute<{ n: number }>(sql`
      WITH seen AS (
        INSERT INTO rate_windows (subject, bucket, window_start, n)
        VALUES (${ip}, ${'seen:' + emojiId}, ${ws}, 1)
        ON CONFLICT DO NOTHING
        RETURNING 1
      ), bump AS (
        INSERT INTO rate_windows (subject, bucket, window_start, n)
        SELECT ${ip}, ${BURST_BUCKET}, ${ws}, 1 FROM seen
        ON CONFLICT (subject, bucket, window_start) DO UPDATE SET n = rate_windows.n + 1
        RETURNING n
      )
      SELECT coalesce(
        (SELECT n FROM bump),
        (SELECT n FROM rate_windows WHERE subject = ${ip} AND bucket = ${BURST_BUCKET} AND window_start = ${ws}),
        0
      )::int AS n
    `)
    return Number(res.rows[0]?.n ?? 0)
  },

  async isCleared(ip) {
    const { rateWindows: r } = schema
    const rows = await db()
      .select({ n: r.n })
      .from(r)
      .where(and(eq(r.subject, ip), eq(r.bucket, CLEARED_BUCKET), gt(r.windowStart, new Date())))
      .limit(1)
    return rows.length > 0
  },

  async markCleared(ip, seconds) {
    const { rateWindows: r } = schema
    await db()
      .insert(r)
      .values({ subject: ip, bucket: CLEARED_BUCKET, windowStart: new Date(Date.now() + seconds * 1000), n: 1 })
      .onConflictDoNothing()
  },

  verifyCap: (token) => verifyCapToken(token),

  async volume(ip, id): Promise<VolumeState | null> {
    const { rateWindows: r } = schema
    const [row] = await db()
      .select({ n: r.n, since: r.windowStart })
      .from(r)
      .where(and(eq(r.subject, ip), eq(r.bucket, volumeBucket(id))))
      .orderBy(desc(r.windowStart))
      .limit(1)
    return row ? { signed: row.n, since: row.since } : null
  },

  async addVolume(ip, id, n, prev) {
    const { rateWindows: r } = schema
    if (prev) {
      // window_start was written from a JS Date (millisecond precision), so it round-trips exactly
      await db()
        .update(r)
        .set({ n: sql`${r.n} + ${n}` })
        .where(and(eq(r.subject, ip), eq(r.bucket, volumeBucket(id)), eq(r.windowStart, prev.since)))
      return
    }
    await db()
      .insert(r)
      .values({ subject: ip, bucket: volumeBucket(id), windowStart: new Date(Date.now() + 86_400_000), n })
      .onConflictDoUpdate({ target: [r.subject, r.bucket, r.windowStart], set: { n: sql`${r.n} + ${n}` } })
  },

  async flag(subjects, feature, day) {
    const { rateWindows: r } = schema
    try {
      for (const subject of subjects) {
        await db()
          .insert(r)
          .values({ subject, bucket: flagBucket(feature), windowStart: flagExpiry(day), n: 1 })
          .onConflictDoUpdate({ target: [r.subject, r.bucket, r.windowStart], set: { n: sql`${r.n} + 1` } })
      }
    } catch (err) {
      // features only feed the admin list; never fail a download because of them
      log().warn({ err: (err as Error).message, feature }, 'downloads: could not record a source feature')
    }
  },
}
