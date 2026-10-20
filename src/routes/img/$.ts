import { createFileRoute } from '@tanstack/react-router'
import { imgDeps } from '#/server/http/img-deps'
import { handleImg, type ImgDeps } from '#/server/media/img'

// /img/v1/<variant>/<packKey>/<emojiId>.r<rev>.webp and /img/v1/portrait/<name>.<hash8>-<w>.webp —
// the only public paths to web images (src/server/media/img.ts).
// Deliberately session-free: no getViewer/auth call, no Set-Cookie, so Cloudflare can cache it.

/** HEAD never sends the object, so release the S3 stream right away instead of leaving it open. */
const headDeps: ImgDeps = {
  ...imgDeps,
  async getObject(key, ifNoneMatch) {
    const obj = await imgDeps.getObject(key, ifNoneMatch)
    if (obj?.body) await obj.body.cancel().catch(() => {})
    return obj && { ...obj, body: null }
  },
}

export const Route = createFileRoute('/img/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleImg(request, imgDeps),
      HEAD: ({ request }) => handleImg(request, headDeps),
      // other methods get handleImg's 405 instead of falling through to the page router
      ANY: ({ request }) => handleImg(request, imgDeps),
    },
  },
})
