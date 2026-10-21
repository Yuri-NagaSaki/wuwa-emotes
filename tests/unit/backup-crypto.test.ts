import { describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { PassThrough, Readable, type Transform } from 'node:stream'
import { DEV_BACKUP_KEY } from '#/server/env'
import {
  BACKUP_HEADER_BYTES,
  BACKUP_MAGIC,
  BackupCryptoError,
  backupKeyFor,
  decryptStream,
  encryptStream,
  parseBackupKey,
} from '#/server/media/backup-crypto'

// AES-256-GCM backup format (src/server/media/backup-crypto.ts): header ‖ ciphertext ‖ tag.

const KEY = randomBytes(32)

/** Run `input` (split into chunks of `chunk` bytes) through a transform and collect the output. */
async function run(t: Transform, input: Buffer, chunk = 7919): Promise<Buffer> {
  const parts: Buffer[] = []
  for (let i = 0; i < input.length; i += chunk) parts.push(input.subarray(i, i + chunk))
  const out: Buffer[] = []
  const src = Readable.from(parts)
  const sink = new PassThrough()
  sink.on('data', (b: Buffer) => out.push(b))
  await new Promise<void>((resolve, reject) => {
    src.on('error', reject)
    t.on('error', reject)
    sink.on('end', resolve)
    src.pipe(t).pipe(sink)
  })
  return Buffer.concat(out)
}

const encrypt = (plain: Buffer, key = KEY, chunk?: number) => run(encryptStream(key), plain, chunk)
const decrypt = (data: Buffer, key = KEY, chunk?: number) => run(decryptStream(key), data, chunk)

describe('backup encryption', () => {
  test.each([0, 1, 15, 16, 17, 100_000, 1_048_577])('round trip of %d bytes, any chunking', async (n) => {
    const plain = randomBytes(n)
    const enc = await encrypt(plain, KEY, 4093)
    expect(enc.length).toBe(BACKUP_HEADER_BYTES + n + 16)
    expect(enc.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)).toBe(true)
    expect(enc[BACKUP_MAGIC.length]).toBe(1)
    for (const chunk of [1, 13, 16, 65_536]) {
      if (chunk === 1 && n > 20_000) continue
      expect((await decrypt(enc, KEY, chunk)).equals(plain)).toBe(true)
    }
  })

  test('the ciphertext does not contain the plaintext; two backups of the same data differ (random IV)', async () => {
    const plain = Buffer.from('PGDMP… user@example.test $argon2id$v=19$… session-token-1234567890'.repeat(50))
    const a = await encrypt(plain)
    const b = await encrypt(plain)
    expect(a.includes(Buffer.from('PGDMP'))).toBe(false)
    expect(a.includes(Buffer.from('user@example.test'))).toBe(false)
    expect(a.equals(b)).toBe(false)
  })

  test('a wrong key fails', async () => {
    const enc = await encrypt(randomBytes(5000))
    await expect(decrypt(enc, randomBytes(32))).rejects.toThrow(/authentication failed/)
  })

  test.each([1, 16, 17, 1000])('a file truncated by %d bytes fails', async (cut) => {
    const enc = await encrypt(randomBytes(5000))
    await expect(decrypt(enc.subarray(0, enc.length - cut))).rejects.toThrow(BackupCryptoError)
  })

  test('a file cut inside the header or the tag fails', async () => {
    const enc = await encrypt(randomBytes(100))
    await expect(decrypt(enc.subarray(0, 10))).rejects.toThrow(/header is incomplete/)
    await expect(decrypt(enc.subarray(0, BACKUP_HEADER_BYTES + 5))).rejects.toThrow(/tag is missing/)
  })

  test('a flipped bit in the body, the tag or the header (IV, version) fails', async () => {
    const enc = await encrypt(randomBytes(3000))
    for (const at of [BACKUP_HEADER_BYTES + 100, enc.length - 1, BACKUP_HEADER_BYTES - 1]) {
      const bad = Buffer.from(enc)
      bad[at]! ^= 0x01
      await expect(decrypt(bad)).rejects.toThrow(BackupCryptoError)
    }
    const v2 = Buffer.from(enc)
    v2[BACKUP_MAGIC.length] = 2
    await expect(decrypt(v2)).rejects.toThrow(/version 2/)
  })

  test('a plaintext dump is rejected, not passed through', async () => {
    await expect(decrypt(Buffer.concat([Buffer.from('PGDMP'), randomBytes(500)]))).rejects.toThrow(/bad magic/)
  })
})

describe('BACKUP_ENCRYPTION_KEY', () => {
  const good = randomBytes(32).toString('base64')

  test('base64 of exactly 32 bytes', () => {
    expect(parseBackupKey(good).length).toBe(32)
    expect(parseBackupKey(` ${good}\n`).length).toBe(32)
    expect(() => parseBackupKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/)
    expect(() => parseBackupKey(randomBytes(32).toString('hex'))).toThrow(BackupCryptoError)
    expect(() => parseBackupKey('not base64!')).toThrow(/not base64/)
  })

  test('production: no key means no backup; the public dev key is refused', () => {
    expect(backupKeyFor({ NODE_ENV: 'production', BACKUP_ENCRYPTION_KEY: '' })).toBeNull()
    expect(() => backupKeyFor({ NODE_ENV: 'production', BACKUP_ENCRYPTION_KEY: DEV_BACKUP_KEY })).toThrow(/development key/)
    expect(backupKeyFor({ NODE_ENV: 'production', BACKUP_ENCRYPTION_KEY: good })?.equals(Buffer.from(good, 'base64'))).toBe(true)
    expect(() => backupKeyFor({ NODE_ENV: 'production', BACKUP_ENCRYPTION_KEY: 'abc' })).toThrow(BackupCryptoError)
  })

  test('development and tests use the dev key', () => {
    expect(backupKeyFor({ NODE_ENV: 'development', BACKUP_ENCRYPTION_KEY: DEV_BACKUP_KEY })?.length).toBe(32)
  })
})
