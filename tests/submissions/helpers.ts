// Shared setup for tests/submissions and tests/account. Import FIRST: it pulls in the integration setup,
// which fixes the environment (fake Cap server, fresh database, local S3) before any singleton exists.
//
//   CHAOCHI_TEST_DB=chaochi_lane_g_test CHAOCHI_TEST_BUCKET=chaochi-lane-g bun test tests/submissions tests/account
//
// The database is dropped and recreated once per process (real migrate entry, pg-boss schema included);
// the bucket is created when missing and emptied once. Jobs are never sent: ingest and derive run inline.
import { BUCKET, DATABASE_URL, mainDatabase, signUp, withClient, type TestUser } from '../integration/setup'
import { CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3'
import { eq } from 'drizzle-orm'
import type { Viewer } from '#/server/auth/session'
import { db, schema } from '#/server/db/client'
import { deriveEmoji } from '#/server/jobs/handlers/media'
import { ingestUpload } from '#/server/media/ingest'
import { publishEmojiDerivatives } from '#/server/media/publish'
import { bucket, deleteObjects, listKeys, s3 } from '#/server/media/s3'
import { completeUploads, defaultDeps, presignUploads, type SubmissionDeps } from '#/server/submissions/service'
import type { Role, SubmitMode } from '#/shared/roles'

export { makeGif, makePng } from '../media/helpers'
export { BUCKET, DATABASE_URL }

// setup.ts already refuses bucket "wuwa"; this suite also empties the bucket, so only scratch buckets
if (!/^chaochi-/.test(BUCKET)) throw new Error(`tests empty their bucket; use a scratch bucket named chaochi-*, got ${BUCKET}`)

let ready: Promise<void> | undefined

export function setup(): Promise<void> {
  ready ??= (async () => {
    const run = await mainDatabase()
    if (run.exitCode !== 0) throw new Error(`migrate failed:\n${run.output}`)
    try {
      await s3().send(new HeadBucketCommand({ Bucket: bucket() }))
    } catch {
      await s3().send(new CreateBucketCommand({ Bucket: bucket() }))
    }
    await deleteObjects(await listKeys(''))
  })()
  return ready
}

export interface Person extends TestUser {
  actor: Pick<Viewer, 'id' | 'role' | 'impersonatedBy'>
}

/** A real account (Better Auth sign-up with a Cap token), optionally with another role / submit mode. */
export async function person(label: string, role: Role = 'user', submitMode: SubmitMode = 'review'): Promise<Person> {
  const u = await signUp(label)
  if (role !== 'user' || submitMode !== 'review') {
    await db().update(schema.users).set({ role, submitMode }).where(eq(schema.users.id, u.id))
  }
  return { ...u, actor: { id: u.id, role, impersonatedBy: null } }
}

export async function setSubmitMode(userId: string, submitMode: SubmitMode) {
  await db().update(schema.users).set({ submitMode }).where(eq(schema.users.id, userId))
}

// ---------- side effects ----------

export const sent = { ingest: [] as string[], zip: [] as number[], derived: [] as string[] }

/** Real presign and publish (RustFS); ingest / zip / derive jobs are only recorded. */
export const deps: SubmissionDeps = {
  presignPut: defaultDeps.presignPut,
  async enqueueIngest(id) {
    sent.ingest.push(id)
  },
  publishDerivatives: (emojiId) =>
    publishEmojiDerivatives(emojiId, {
      async enqueueDerived(id) {
        sent.derived.push(id)
      },
    }),
  async enqueueZip(packId) {
    sent.zip.push(packId)
  },
}

export interface TestFile {
  name: string
  body: Uint8Array
  type: string
}

/**
 * The browser flow: presign → PUT to storage → complete, then the worker's part inline: media.ingest
 * and the review previews (media.derive target 'review').
 */
export async function upload(actor: Person['actor'], submissionId: string, files: TestFile[]) {
  const signed = await presignUploads(
    actor,
    submissionId,
    files.map((f) => ({ name: f.name, size: f.body.byteLength, type: f.type })),
    deps,
  )
  for (const [i, s] of signed.entries()) {
    const res = await fetch(s.url, { method: 'PUT', body: new Blob([files[i]!.body as Uint8Array<ArrayBuffer>]), headers: { 'content-type': s.contentType } })
    if (!res.ok) throw new Error(`PUT ${res.status}: ${await res.text()}`)
  }
  const before = sent.ingest.length
  await completeUploads(actor, submissionId, signed.map((s) => s.id), deps)
  const queued = sent.ingest.slice(before)
  const outcomes = []
  for (const id of queued) {
    outcomes.push(
      await ingestUpload(id, {
        async enqueueReview(emojiId) {
          await deriveEmoji({ emojiId, target: 'review' })
        },
      }),
    )
  }
  return { signed, outcomes }
}

export async function auditRows(targetId: string) {
  return db().select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, targetId))
}

export async function sqlRows<T>(text: string, params: unknown[] = []): Promise<T[]> {
  return withClient(DATABASE_URL, async (c) => (await c.query(text, params)).rows as T[])
}

/** Expect an HttpError with this status (and optionally a message fragment). */
export async function rejects(p: Promise<unknown>, status: number, fragment?: string) {
  try {
    await p
  } catch (err) {
    const e = err as { status?: number; message?: string }
    if (e.status !== status) throw new Error(`expected HTTP ${status}, got ${e.status ?? 'no status'}: ${e.message}`)
    if (fragment && !e.message?.includes(fragment)) throw new Error(`expected message containing "${fragment}", got "${e.message}"`)
    return e
  }
  throw new Error(`expected HTTP ${status}, but it resolved`)
}
