// Web image URLs on the client. The server decides where a page loads posters, previews and portraits
// from (src/server/media/keys.ts webImageUrl): the origin's /img, or the bucket's public domain
// (PUBLIC_IMG_BASE, whose paths are the object keys). Scripts that read image bytes (drawing on a
// canvas for the clipboard) must stay on the origin, where nothing depends on bucket CORS, so they map
// any web image URL back to its /img path here. No configuration needed: the key layout identifies it.

const DERIVED = /\/derived\/v1\/(p240|a160|full)\/([a-z0-9][a-z0-9-]*)\/(r-[0-9a-f]{20}\.r[1-9][0-9]{0,8}\.webp)$/
const PORTRAIT = /\/characters\/v1\/portraits\/([a-z0-9][a-z0-9-]*\.[0-9a-f]{8}-[0-9]{3}\.webp)$/
const ORIGIN_IMG = /^\/img\/v1\/(?:(?:p240|a160|full)\/[a-z0-9][a-z0-9-]*\/r-[0-9a-f]{20}\.r[1-9][0-9]{0,8}|portrait\/[a-z0-9][a-z0-9-]*\.[0-9a-f]{8}-[0-9]{3})\.webp$/

function pathOf(url: string): string | null {
  if (url.startsWith('/')) return url.split(/[?#]/)[0]!
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.pathname : null
  } catch {
    return null
  }
}

/** The origin's /img path for a web image URL (from the public base or /img itself); null otherwise. */
export function originImagePath(url: string): string | null {
  const path = pathOf(url)
  if (!path) return null
  if (ORIGIN_IMG.test(path)) return path
  const d = DERIVED.exec(path)
  if (d) return `/img/v1/${d[1]}/${d[2]}/${d[3]}`
  const p = PORTRAIT.exec(path)
  return p ? `/img/v1/portrait/${p[1]}` : null
}

/** Whether a URL is one of the site's web images (an /img path or the same object on the public base). */
export function isWebImageUrl(url: string): boolean {
  return originImagePath(url) !== null
}
