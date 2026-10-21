import { createCipheriv, createDecipheriv, type DecipherGCM, randomBytes } from 'node:crypto'
import { Transform, type TransformCallback } from 'node:stream'
import { DEV_BACKUP_KEY, type Env } from '../env'

// Database backups are encrypted before they leave the worker (docs/ARCHITECTURE.md §12.5): the dumps
// hold every account's email, password hash and session tokens, and the bucket that stores them also has
// a public image domain. AES-256-GCM over the whole pg_dump stream, one random 96-bit IV per backup.
//
//   file = header ‖ ciphertext ‖ tag
//   header = "CHAOCHIBAK" (10 bytes) ‖ version 0x01 (1 byte) ‖ IV (12 bytes); authenticated as AAD
//   tag = the 16-byte GCM authentication tag
//
// GCM authenticates only at the end, so a decrypted file counts only after the tag checks out
// (decryptBackupFile in backup-tools.ts writes to a temporary file and renames it then). One GCM stream
// can hold up to 64 GiB, far above the size of this database.

export const BACKUP_MAGIC = Buffer.from('CHAOCHIBAK', 'ascii')
export const BACKUP_FORMAT_VERSION = 1
const IV_BYTES = 12
const TAG_BYTES = 16
export const BACKUP_HEADER_BYTES = BACKUP_MAGIC.length + 1 + IV_BYTES
export const BACKUP_KEY_BYTES = 32

export class BackupCryptoError extends Error {}

/** BACKUP_ENCRYPTION_KEY: base64 of exactly 32 bytes (`openssl rand -base64 32`). */
export function parseBackupKey(value: string): Buffer {
  const v = value.trim()
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v) || v.length % 4 !== 0) throw new BackupCryptoError('BACKUP_ENCRYPTION_KEY is not base64')
  const key = Buffer.from(v, 'base64')
  if (key.length !== BACKUP_KEY_BYTES) throw new BackupCryptoError(`BACKUP_ENCRYPTION_KEY must be ${BACKUP_KEY_BYTES} bytes, got ${key.length}`)
  return key
}

/**
 * The key backups use in this environment. Development and tests fall back to a public dev key (env.ts);
 * production has no fallback: null when BACKUP_ENCRYPTION_KEY is unset (the backup then fails without
 * uploading anything), and the dev key itself is refused.
 */
export function backupKeyFor(e: Pick<Env, 'NODE_ENV' | 'BACKUP_ENCRYPTION_KEY'>): Buffer | null {
  if (!e.BACKUP_ENCRYPTION_KEY) return null
  if (e.NODE_ENV === 'production' && e.BACKUP_ENCRYPTION_KEY.trim() === DEV_BACKUP_KEY) {
    throw new BackupCryptoError('BACKUP_ENCRYPTION_KEY is the public development key; generate one with `openssl rand -base64 32`')
  }
  return parseBackupKey(e.BACKUP_ENCRYPTION_KEY)
}

function header(iv: Buffer): Buffer {
  return Buffer.concat([BACKUP_MAGIC, Buffer.from([BACKUP_FORMAT_VERSION]), iv])
}

/** Encrypting transform: plaintext in, header ‖ ciphertext ‖ tag out. */
export function encryptStream(key: Buffer, iv: Buffer = randomBytes(IV_BYTES)): Transform {
  if (key.length !== BACKUP_KEY_BYTES) throw new BackupCryptoError(`backup key must be ${BACKUP_KEY_BYTES} bytes`)
  if (iv.length !== IV_BYTES) throw new BackupCryptoError(`IV must be ${IV_BYTES} bytes`)
  const head = header(iv)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(head)
  let started = false
  const start = (t: Transform) => {
    if (!started) {
      started = true
      t.push(head)
    }
  }
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      start(this)
      cb(null, cipher.update(chunk))
    },
    flush(cb: TransformCallback) {
      start(this)
      const rest = cipher.final()
      if (rest.length) this.push(rest)
      this.push(cipher.getAuthTag())
      cb()
    },
  })
}

/**
 * Decrypting transform. Plaintext comes out before the tag is checked (the tag is the last 16 bytes);
 * the stream errors at the end when the key is wrong or the file was cut short or changed, so consumers
 * must not trust the output until the stream finished without an error.
 */
export function decryptStream(key: Buffer): Transform {
  if (key.length !== BACKUP_KEY_BYTES) throw new BackupCryptoError(`backup key must be ${BACKUP_KEY_BYTES} bytes`)
  let head: Buffer = Buffer.alloc(0)
  let decipher: DecipherGCM | null = null
  let tail: Buffer = Buffer.alloc(0)
  const feed = (t: Transform, data: Buffer) => {
    const all: Buffer = tail.length ? Buffer.concat([tail, data]) : data
    if (all.length <= TAG_BYTES) {
      tail = all
      return
    }
    const cut = all.length - TAG_BYTES
    tail = Buffer.from(all.subarray(cut))
    const out = decipher!.update(all.subarray(0, cut))
    if (out.length) t.push(out)
  }
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      try {
        if (!decipher) {
          head = Buffer.concat([head, chunk])
          if (head.length < BACKUP_HEADER_BYTES) return cb()
          if (!head.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) throw new BackupCryptoError('not an encrypted 潮池 backup (bad magic)')
          const version = head[BACKUP_MAGIC.length]
          if (version !== BACKUP_FORMAT_VERSION) throw new BackupCryptoError(`unsupported backup format version ${version}`)
          const iv = head.subarray(BACKUP_MAGIC.length + 1, BACKUP_HEADER_BYTES)
          decipher = createDecipheriv('aes-256-gcm', key, iv) as DecipherGCM
          decipher.setAAD(head.subarray(0, BACKUP_HEADER_BYTES))
          const rest = head.subarray(BACKUP_HEADER_BYTES)
          head = Buffer.alloc(0)
          if (rest.length) feed(this, rest)
          return cb()
        }
        feed(this, chunk)
        cb()
      } catch (err) {
        cb(err as Error)
      }
    },
    flush(cb: TransformCallback) {
      if (!decipher) return cb(new BackupCryptoError('truncated backup: the header is incomplete'))
      if (tail.length < TAG_BYTES) return cb(new BackupCryptoError('truncated backup: the authentication tag is missing'))
      try {
        decipher.setAuthTag(tail)
        const rest = decipher.final()
        if (rest.length) this.push(rest)
        cb()
      } catch {
        cb(new BackupCryptoError('backup authentication failed: wrong BACKUP_ENCRYPTION_KEY, or the file is truncated or damaged'))
      }
    },
  })
}
