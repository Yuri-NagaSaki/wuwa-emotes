import type { Viewer } from './auth/session'
import { db, schema } from './db/client'

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0]

/** Record a write action. Pass the transaction when the change itself runs in one. */
export async function audit(
  actor: Pick<Viewer, 'id' | 'role' | 'impersonatedBy'> | null,
  action: string,
  target: { type?: string; id?: string | number } = {},
  diff?: unknown,
  tx?: Tx,
) {
  const runner = tx ?? db()
  await runner.insert(schema.auditLogs).values({
    actorId: actor?.id ?? null,
    actorRole: actor?.role ?? null,
    impersonatedBy: actor?.impersonatedBy ?? null,
    action,
    targetType: target.type ?? null,
    targetId: target.id == null ? null : String(target.id),
    diff: diff ?? null,
  })
}
