import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { PassThrough, type Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { BACKUP_PREFIX, BACKUP_SUFFIX } from './keys'
import { decryptStream, encryptStream } from './backup-crypto'
import { createUpload, deleteObjects, getObject, headObject, listKeys } from './s3'

// Operator side of the encrypted backups (src/cli.ts `backup …`): restore-time decryption and the
// one-off conversion of the plaintext dumps written before encryption existed.

/** Pass-through that hashes what flows through it (SHA-256, hex after the stream ended). */
function hashTap() {
  const hash = createHash('sha256')
  let bytes = 0
  const t = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk)
      bytes += chunk.length
      cb(null, chunk)
    },
  })
  return { stream: t, digest: () => hash.digest('hex'), bytes: () => bytes }
}

async function objectStream(key: string): Promise<Readable> {
  const res = await getObject(key)
  if (!res.Body) throw new Error(`${key}: empty response body`)
  return res.Body as Readable
}

/** Whether a decrypt source is a bucket key rather than a local file. */
export function isBackupObjectKey(source: string): boolean {
  return source.startsWith(BACKUP_PREFIX) && !existsSync(source)
}

/**
 * Decrypt a backup (a local file, or an object key under backups/) to `out`. The plaintext goes to
 * `<out>.partial` and is renamed only once the authentication tag checks out, so a wrong key or a
 * truncated file never leaves a usable-looking dump behind.
 */
export async function decryptBackupFile(source: string, out: string, key: Buffer): Promise<{ bytes: number; sha256: string }> {
  const input = isBackupObjectKey(source) ? await objectStream(source) : createReadStream(source)
  const partial = `${out}.partial`
  const tap = hashTap()
  try {
    await pipeline(input, decryptStream(key), tap.stream, createWriteStream(partial, { mode: 0o600 }))
    await rename(partial, out)
  } catch (err) {
    await rm(partial, { force: true })
    throw err
  }
  return { bytes: tap.bytes(), sha256: tap.digest() }
}

/** SHA-256 of an object's plaintext after decryption (verifies the tag on the way). */
async function decryptedDigest(key: string, encKey: Buffer): Promise<string> {
  const tap = hashTap()
  const sink = new PassThrough()
  sink.resume()
  await pipeline(await objectStream(key), decryptStream(encKey), tap.stream, sink)
  return tap.digest()
}

export interface EncryptExistingResult {
  /** plaintext `.dump` objects found under backups/ */
  found: number
  encrypted: number
  /** encrypted copies that decrypted to the plaintext's SHA-256 */
  verified: number
  /** plaintext objects deleted after verification */
  deleted: number
  failed: { key: string; error: string }[]
  lines: string[]
}

/**
 * For every plaintext `<…>.dump` under backups/: stream it through the cipher into `<…>.dump.enc`
 * (hashing the plaintext on the way), download the new object again and decrypt it, and delete the
 * plaintext only when both SHA-256 digests match. An existing `.dump.enc` that already verifies is kept.
 */
export async function encryptExistingBackups(encKey: Buffer, opts: { dryRun?: boolean; log?: (line: string) => void } = {}): Promise<EncryptExistingResult> {
  const log = opts.log ?? (() => undefined)
  const all = await listKeys(BACKUP_PREFIX)
  const plain = all.filter((k) => k.endsWith('.dump'))
  const have = new Set(all.filter((k) => k.endsWith(BACKUP_SUFFIX)))
  const r: EncryptExistingResult = { found: plain.length, encrypted: 0, verified: 0, deleted: 0, failed: [], lines: [] }
  const say = (line: string) => {
    r.lines.push(line)
    log(line)
  }
  for (const key of plain) {
    const target = key.slice(0, -'.dump'.length) + BACKUP_SUFFIX
    if (opts.dryRun) {
      const size = (await headObject(key))?.ContentLength ?? 0
      say(`would encrypt ${key} (${size} bytes) → ${target}${have.has(target) ? ' (an encrypted copy exists; it is verified first)' : ''}, then delete the plaintext`)
      continue
    }
    try {
      let plainDigest = ''
      let reused = false
      if (have.has(target)) {
        // a previous run may have stopped between the upload and the delete
        plainDigest = await plainDigestOf(key)
        reused = (await decryptedDigest(target, encKey).catch(() => null)) === plainDigest
      }
      if (!reused) {
        const tap = hashTap()
        await upload(await objectStream(key), target, encKey, tap)
        plainDigest = tap.digest()
        r.encrypted++
        if ((await decryptedDigest(target, encKey)) !== plainDigest) throw new Error(`verification failed: ${target} does not decrypt to ${key}`)
      }
      r.verified++
      await deleteObjects([key])
      r.deleted++
      say(`${reused ? 'verified the existing' : 'encrypted'} ${target}; deleted the plaintext ${key}`)
    } catch (err) {
      r.failed.push({ key, error: (err as Error).message })
      say(`FAILED ${key}: ${(err as Error).message} (plaintext kept)`)
    }
  }
  return r
}

async function plainDigestOf(key: string): Promise<string> {
  const tap = hashTap()
  const sink = new PassThrough()
  sink.resume()
  await pipeline(await objectStream(key), tap.stream, sink)
  return tap.digest()
}

/** Stream `source` through the cipher into a multipart upload of `target`; either side failing stops both. */
async function upload(source: Readable, target: string, encKey: Buffer, tap: ReturnType<typeof hashTap>) {
  const enc = encryptStream(encKey)
  const up = createUpload(target, enc, { contentType: 'application/octet-stream' })
  const done = up.done()
  done.catch((err: unknown) => enc.destroy(err as Error))
  const piped = pipeline(source, tap.stream, enc)
  piped.catch(() => up.abort().catch(() => undefined))
  await Promise.all([piped, done])
}
