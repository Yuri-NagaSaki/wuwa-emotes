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
      // sharp is only used by the worker; keep native/optional packages out of the web bundle.
      rollupConfig: { external: ['sharp', 'pg-native'] },
    }),
    tanstackStart(),
    viteReact(),
  ],
})
