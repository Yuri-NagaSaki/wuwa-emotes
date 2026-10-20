import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { adminAuditFn } from '#/server/admin/fns/system'
import { guarded } from '#/ui/admin-pages/bits'
import { pageCss } from '#/ui/admin-pages/css'
import { AuditPage } from '#/ui/admin-pages/SystemPages'

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined)

const search = z.object({
  actor: z.string().max(100).optional().catch(undefined),
  action: z.string().max(60).optional().catch(undefined),
  targetType: z.string().max(40).optional().catch(undefined),
  targetId: z.string().max(100).optional().catch(undefined),
  from: day,
  to: day,
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
})

export const Route = createFileRoute('/admin/audit')({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  head: pageCss,
  loader: ({ deps }) => guarded(() => adminAuditFn({ data: deps })),
  component: () => {
    const data = Route.useLoaderData()
    const s = Route.useSearch()
    return data ? <AuditPage data={data} search={s} actions={data.actions} /> : null
  },
})
