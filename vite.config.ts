import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'

export default defineConfig({
  // Vite only exposes VITE_* from env/ to the client. Server settings are read
  // from process.env at runtime (see src/server/env.ts), never baked into the bundle.
  envDir: 'env',
  resolve: { tsconfigPaths: true },
  server: { port: 3000 },
  plugins: [
    nitro({
      preset: 'bun',
      // sharp runs in the worker and, for 头像 uploads, in the web process (imported on first use); like
      // pg-native it stays out of the bundle and loads its native packages from node_modules.
      rollupConfig: { external: ['sharp', 'pg-native'] },
      // Fonts in public/ get no Cache-Control by default, so Cloudflare bypassed them and browsers kept
      // revalidating. TP Rounded shards are named by content hash; the stylesheet listing them is not,
      // and nunito keeps its name across @fontsource versions.
      routeRules: {
        '/fonts/tp-rounded/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
        '/fonts/tp-rounded/tp-rounded.css': { headers: { 'cache-control': 'public, max-age=3600, stale-while-revalidate=86400' } },
        '/fonts/nunito/**': { headers: { 'cache-control': 'public, max-age=2592000' } },
      },
    }),
    tanstackStart(),
    viteReact(),
  ],
})
