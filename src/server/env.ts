import { z } from 'zod'

// Server configuration, read from process.env at runtime (never inlined into a bundle).
// Development gets local defaults (Docker PostgreSQL + MinIO); production must set everything.

const bool = z
  .enum(['1', '0', 'true', 'false', 'yes', 'no', ''])
  .transform((v) => v === '1' || v === 'true' || v === 'yes')

const DEV_DEFAULTS: Record<string, string> = {
  SITE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://chaochi:chaochi@127.0.0.1:5432/chaochi',
  AUTH_SECRET: 'dev-only-auth-secret-not-for-production-0000',
  IP_HASH_SALT: 'dev-only-ip-salt',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  // local RustFS container (S3-compatible), see README "本地开发"
  S3_BUCKET: 'chaochi-dev',
  S3_ACCESS_KEY_ID: 'devaccess',
  S3_SECRET_ACCESS_KEY: 'devsecret123',
  S3_FORCE_PATH_STYLE: 'true',
}

/** An http(s) URL without query or fragment; the trailing slash is dropped ('' when unset). */
const publicBase = z
  .union([z.url({ protocol: /^https?$/ }), z.literal('')])
  .default('')
  .refine((v) => !v || (!new URL(v).search && !new URL(v).hash), 'must not have a query or fragment')
  .transform((v) => v.replace(/\/+$/, ''))

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SITE_NAME: z.string().min(1).default('潮池'),
  SITE_SUBTITLE: z.string().default('鸣潮表情图鉴'),
  SITE_URL: z.url(),

  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  IP_HASH_SALT: z.string().min(12),

  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool.default(false),
  S3_PUBLIC_ENDPOINT: z.union([z.url(), z.literal('')]).default(''),
  ALLOW_PROD_BUCKET: bool.default(false),

  CAP_API_ENDPOINT: z.url().default('https://cap.anibt.net/3358fb7a52/'),
  CAP_SITE_KEY: z.string().default('3358fb7a52'),
  CAP_SECRET_KEY: z.string().default(''),
  // Development only: skip Cap verification when no secret is configured.
  CAP_DISABLED: bool.default(false),

  SMTP_URL: z.string().default(''),
  MAIL_FROM: z.string().default(''),

  CF_ZONE_ID: z.string().default(''),
  CF_PURGE_TOKEN: z.string().default(''),

  // Public web images (p240, a160, portraits, avatars) straight from the bucket's custom domain, e.g.
  // https://i.sparxie.moe. Empty: every image URL is the origin's /img path (src/server/media/keys.ts).
  PUBLIC_IMG_BASE: publicBase,

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
})

export type Env = z.infer<typeof schema>

export class ConfigError extends Error {}

/** Parse an env record; exported for tests. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const nodeEnv = source.NODE_ENV ?? 'development'
  const input: Record<string, string | undefined> = { ...source }
  if (nodeEnv !== 'production') {
    for (const [k, v] of Object.entries(DEV_DEFAULTS)) if (!input[k]) input[k] = v
  }
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new ConfigError(`Invalid server configuration: ${issues}`)
  }
  const env = parsed.data
  assertSafeStorage(env)
  if (env.NODE_ENV === 'production') {
    if (!env.CAP_SECRET_KEY) throw new ConfigError('CAP_SECRET_KEY is required in production')
    if (env.CAP_DISABLED) throw new ConfigError('CAP_DISABLED cannot be set in production')
  }
  return env
}

/**
 * The production bucket is R2 bucket `wuwa`. Development and tests must never point at it by accident
 * (the developer machine also holds production keys), so refuse unless explicitly overridden.
 */
export function assertSafeStorage(env: Pick<Env, 'NODE_ENV' | 'S3_ENDPOINT' | 'S3_BUCKET' | 'ALLOW_PROD_BUCKET'>) {
  if (env.NODE_ENV === 'production' || env.ALLOW_PROD_BUCKET) return
  const host = new URL(env.S3_ENDPOINT).hostname
  if (host.endsWith('.r2.cloudflarestorage.com') && env.S3_BUCKET === 'wuwa') {
    throw new ConfigError(
      'Refusing to use the production bucket "wuwa" outside production. Use MinIO, or set ALLOW_PROD_BUCKET=1 deliberately.',
    )
  }
}

let cached: Env | undefined

export function env(): Env {
  cached ??= parseEnv(process.env)
  return cached
}
