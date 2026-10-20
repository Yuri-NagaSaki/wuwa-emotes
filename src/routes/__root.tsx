import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'

// Placeholder shell; the UI lane replaces this with the 潮池 layout (header, footer, tabbar, fonts).
export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }, { title: '潮池' }],
  }),
  component: () => <Outlet />,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
