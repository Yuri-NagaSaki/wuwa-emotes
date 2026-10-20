import { describe, expect, test } from 'bun:test'
import { ConfigError, parseEnv } from '#/server/env'

// parseEnv only; never env(), so nothing here is cached for other test files.

const R2 = 'https://0123456789abcdef.r2.cloudflarestorage.com'

const PROD_BASE = {
  NODE_ENV: 'production',
  SITE_URL: 'https://chaochi.example',
  DATABASE_URL: 'postgres://u:p@db:5432/chaochi',
  AUTH_SECRET: 'x'.repeat(40),
  IP_HASH_SALT: 'salt-salt-salt',
  S3_ENDPOINT: R2,
  S3_BUCKET: 'wuwa',
  S3_ACCESS_KEY_ID: 'id',
  S3_SECRET_ACCESS_KEY: 'secret',
  CAP_SECRET_KEY: 'sk-test',
}

describe('storage guard', () => {
  test.each(['development', 'test', undefined])('refuses R2 + bucket wuwa when NODE_ENV=%p', (nodeEnv) => {
    expect(() => parseEnv({ NODE_ENV: nodeEnv, S3_ENDPOINT: R2, S3_BUCKET: 'wuwa' })).toThrow(ConfigError)
  })

  test('allows other buckets on R2 outside production', () => {
    expect(parseEnv({ NODE_ENV: 'development', S3_ENDPOINT: R2, S3_BUCKET: 'chaochi-scratch' }).S3_BUCKET).toBe('chaochi-scratch')
  })

  test('allows a local S3 bucket named wuwa (not R2)', () => {
    expect(parseEnv({ NODE_ENV: 'development', S3_ENDPOINT: 'http://127.0.0.1:9000', S3_BUCKET: 'wuwa' }).S3_BUCKET).toBe('wuwa')
  })

  test('ALLOW_PROD_BUCKET is the explicit override', () => {
    expect(parseEnv({ NODE_ENV: 'development', S3_ENDPOINT: R2, S3_BUCKET: 'wuwa', ALLOW_PROD_BUCKET: '1' }).S3_BUCKET).toBe('wuwa')
  })

  test('development defaults point at local services', () => {
    const e = parseEnv({ NODE_ENV: 'development' })
    expect(new URL(e.S3_ENDPOINT).hostname).toBe('127.0.0.1')
    expect(e.S3_BUCKET).not.toBe('wuwa')
  })
})

describe('production requirements', () => {
  test('a complete production config parses', () => {
    const e = parseEnv(PROD_BASE)
    expect(e.NODE_ENV).toBe('production')
    expect(e.S3_BUCKET).toBe('wuwa')
  })

  test('requires CAP_SECRET_KEY', () => {
    expect(() => parseEnv({ ...PROD_BASE, CAP_SECRET_KEY: '' })).toThrow(/CAP_SECRET_KEY/)
    const { CAP_SECRET_KEY: _omit, ...rest } = PROD_BASE
    expect(() => parseEnv(rest)).toThrow(ConfigError)
  })

  test('rejects CAP_DISABLED', () => {
    expect(() => parseEnv({ ...PROD_BASE, CAP_DISABLED: '1' })).toThrow(/CAP_DISABLED/)
  })

  test('gets no development defaults', () => {
    const { DATABASE_URL: _omit, ...rest } = PROD_BASE
    expect(() => parseEnv(rest)).toThrow(/DATABASE_URL/)
  })

  test('rejects a short AUTH_SECRET', () => {
    expect(() => parseEnv({ ...PROD_BASE, AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/)
  })
})
