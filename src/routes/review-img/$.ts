import { createFileRoute } from '@tanstack/react-router'
import { getViewer } from '#/server/auth/session'
import { getImgObject } from '#/server/http/img-deps'
import { handleReviewImg, lookupReviewEmoji, type ReviewImgDeps } from '#/server/http/review-img'

// /review-img/v1/<p240|a160>/<packKey>/<emojiId>.webp — pending previews for the submitter and reviewers.
const deps: ReviewImgDeps = {
  getViewer,
  lookupEmoji: lookupReviewEmoji,
  getObject: (key) => getImgObject(key),
}

export const Route = createFileRoute('/review-img/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleReviewImg(request, deps),
      HEAD: ({ request }) => handleReviewImg(request, deps),
      ANY: ({ request }) => handleReviewImg(request, deps),
    },
  },
})
