import { createFileRoute } from '@tanstack/react-router'
import { downloadDeps } from '#/server/downloads/deps'
import { handleEmojiDownload } from '#/server/downloads/handlers'

// /dl/e/<emojiId>?mode=view|save — 查看原图 / 保存原图: policy check, then 302 to a presigned GET.
export const Route = createFileRoute('/dl/e/$emojiId')({
  server: {
    handlers: {
      GET: ({ request, params }) => handleEmojiDownload(request, params.emojiId, downloadDeps),
      ANY: ({ request, params }) => handleEmojiDownload(request, params.emojiId, downloadDeps),
    },
  },
})
