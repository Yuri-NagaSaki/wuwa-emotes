import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://chaochi:chaochi@127.0.0.1:5432/chaochi',
  },
  strict: true,
  verbose: true,
})
