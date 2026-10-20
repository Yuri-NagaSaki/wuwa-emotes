import { createHmac } from 'node:crypto'
import { env } from '../env'

// The origin is only reachable through Cloudflare Tunnel, so CF-Connecting-IP is trustworthy.
// X-Forwarded-For is never read: anyone can send it.
export function clientIp(request: Request): string {
  const ip = request.headers.get('cf-connecting-ip')?.trim()
  if (ip) return ip
  return env().NODE_ENV === 'production' ? 'unknown' : '127.0.0.1'
}

/** Salted, truncated HMAC used wherever an IP or user agent would otherwise be stored. */
export function hashValue(value: string | null | undefined): string | null {
  if (!value) return null
  return createHmac('sha256', env().IP_HASH_SALT).update(value).digest('hex').slice(0, 32)
}

export function ipSubject(request: Request): string {
  return `ip:${hashValue(clientIp(request))}`
}
