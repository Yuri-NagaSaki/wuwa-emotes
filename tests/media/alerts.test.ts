import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../src/server/db/client'
import { checkR2ReadAlert, R2_ALERT_KEY } from '../../src/server/jobs/handlers/alerts'
import { getSetting, setSetting } from '../../src/server/settings'
import { insertUser, resetDb, setupTestEnv } from './helpers'

// 2026-10-20 09:00 in Asia/Shanghai
const NOW = new Date('2026-10-20T01:00:00Z')
const DAY = 24 * 3600 * 1000

let sent: { to: string; subject: string; text: string }[] = []
const mailer = async (to: string, subject: string, text: string) => {
  sent.push({ to, subject, text })
}

async function setThreshold(r2ReadAlertMonthly: number | null) {
  await setSetting('downloads', { ...(await getSetting('downloads')), r2ReadAlertMonthly }, null)
}

beforeAll(async () => {
  await setupTestEnv()
  await resetDb()
  await insertUser({ role: 'admin', email: 'boss1@example.test' })
  await insertUser({ role: 'admin', email: 'boss2@example.test' })
  // inserted banned (the last-admin trigger only guards updates and deletes)
  await insertUser({ role: 'admin', email: 'banned@example.test', banned: true })
  await insertUser({ role: 'manager', email: 'manager@example.test' })
  await insertUser({ role: 'user', email: 'user@example.test' })
  await db()
    .insert(schema.downloadStatsDaily)
    .values([
      { day: '2026-10-01', kind: 'orig', subjectCount: 10, n: 5_000_000 },
      { day: '2026-10-15', kind: 'batch_item', subjectCount: 10, n: 3_000_000 },
      { day: '2026-10-20', kind: 'zip', subjectCount: 10, n: 1_000_001 },
      // not R2 reads of originals/ZIPs, or not this month
      { day: '2026-10-16', kind: 'batch', subjectCount: 10, n: 99_999_999 },
      { day: '2026-09-30', kind: 'orig', subjectCount: 10, n: 50_000_000 },
    ])
})

beforeEach(async () => {
  sent = []
  await db().delete(schema.siteSettings).where(eq(schema.siteSettings.key, R2_ALERT_KEY))
  await setThreshold(9_000_000)
})

describe('r2.alert', () => {
  test('mails every active admin once when the month-to-date estimate exceeds the threshold', async () => {
    const r = await checkR2ReadAlert({ now: NOW, sendMail: mailer })
    expect(r).toEqual({ status: 'sent', total: 9_000_001, threshold: 9_000_000, recipients: 2 })
    expect(sent.map((m) => m.to).sort()).toEqual(['boss1@example.test', 'boss2@example.test'])
    expect(sent[0]!.subject).toContain('9,000,001')
    expect(sent[0]!.text).toContain('2026-10-01 至 2026-10-20')
    expect(sent[0]!.text).toContain('整包 ZIP：1,000,001')

    // same day: nothing more
    sent = []
    expect((await checkR2ReadAlert({ now: new Date(NOW.getTime() + 3600_000), sendMail: mailer })).status).toBe('already-sent')
    expect(sent).toEqual([])
    // next day: again
    expect((await checkR2ReadAlert({ now: new Date(NOW.getTime() + DAY), sendMail: mailer })).status).toBe('sent')
    expect(sent.length).toBe(2)
  })

  test('at or below the threshold nothing is sent', async () => {
    await setThreshold(9_000_001)
    expect(await checkR2ReadAlert({ now: NOW, sendMail: mailer })).toEqual({ status: 'below', total: 9_000_001, threshold: 9_000_001 })
    expect(sent).toEqual([])
  })

  test('a blank threshold disables the alert', async () => {
    await setThreshold(null)
    expect(await checkR2ReadAlert({ now: NOW, sendMail: mailer })).toEqual({ status: 'disabled' })
  })

  test('the month boundary is Asia/Shanghai', async () => {
    await setThreshold(4_000_000)
    // 2026-10-01 01:00 in Shanghai, still September in UTC: only the October 1 row counts
    const r = await checkR2ReadAlert({ now: new Date('2026-09-30T17:00:00Z'), sendMail: mailer })
    expect(r).toMatchObject({ status: 'sent', total: 5_000_000 })
  })

  test('a failed send releases the day so a retry mails again', async () => {
    const failing = async () => {
      throw new Error('smtp down')
    }
    await expect(checkR2ReadAlert({ now: NOW, sendMail: failing })).rejects.toThrow('smtp down')
    expect(await db().$count(schema.siteSettings, eq(schema.siteSettings.key, R2_ALERT_KEY))).toBe(0)
    expect((await checkR2ReadAlert({ now: NOW, sendMail: mailer })).status).toBe('sent')
  })
})
