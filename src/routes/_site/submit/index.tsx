import { createFileRoute, redirect } from '@tanstack/react-router'
import type { SubmissionKind } from '#/server/db/schema/submissions'
import { getSubmitContextFn } from '#/server/submissions/fn'
import accountCss from '#/ui/account/account.css?url'
import { privateHead } from '#/ui/account/head'
import { errorStatus } from '#/ui/account/text'
import submitCss from '#/ui/submit/submit.css?url'
import { SubmitPage } from '#/ui/submit/SubmitPage'

interface SubmitSearch {
  kind?: SubmissionKind
  pack?: string
  /** an existing submission: edited at /me/submissions/$id */
  id?: string
}

const KINDS: SubmissionKind[] = ['new_pack', 'add_emojis', 'edit_pack']

// 投稿表情包 (signed-in users). The draft is created on the first save or upload.
export const Route = createFileRoute('/_site/submit/')({
  validateSearch: (s: Record<string, unknown>): SubmitSearch => ({
    ...(KINDS.includes(s.kind as SubmissionKind) ? { kind: s.kind as SubmissionKind } : {}),
    ...(typeof s.pack === 'string' && s.pack ? { pack: s.pack } : {}),
    ...(typeof s.id === 'string' && s.id ? { id: s.id } : {}),
  }),
  beforeLoad: ({ search }) => {
    if (search.id) throw redirect({ to: '/me/submissions/$id', params: { id: search.id } })
  },
  loaderDeps: ({ search }) => ({ pack: search.pack, kind: search.kind }),
  loader: async ({ deps, location }) => {
    try {
      return { ctx: await getSubmitContextFn({ data: { packSlug: deps.kind && deps.kind !== 'new_pack' ? deps.pack : undefined } }) }
    } catch (err) {
      if (errorStatus(err) === 401) throw redirect({ to: '/login', search: { next: location.href } })
      throw err
    }
  },
  head: ({ matches }) => privateHead(matches, '投稿表情包', [accountCss, submitCss]),
  component: function Submit() {
    const { ctx } = Route.useLoaderData()
    const search = Route.useSearch()
    return <SubmitPage key={`${search.kind ?? 'new_pack'}:${search.pack ?? ''}`} ctx={ctx} kind={search.kind ?? 'new_pack'} packSlug={search.pack} />
  },
})
