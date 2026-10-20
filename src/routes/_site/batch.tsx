import { createFileRoute } from '@tanstack/react-router'
import { BatchPage } from '#/ui/batch/BatchPage'
import { pageHead } from '#/ui/pages/seo'

// /batch: the 打包清单 (kept in the browser; the header 打包 button opens the same list as a tray).
export const Route = createFileRoute('/_site/batch')({
  head: ({ matches }) =>
    pageHead(matches, {
      title: '打包清单',
      description: '跨包挑选表情，在浏览器里一次打包下载原图，附 CREDITS.txt 署名与许可。',
      path: '/batch',
      // the list is per visitor: nothing to index
      noindex: true,
    }),
  component: BatchPage,
})
