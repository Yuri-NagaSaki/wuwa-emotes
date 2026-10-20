import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSubmissionFn, getSubmitContextFn } from '#/server/submissions/fn'
import { EmptyState } from '#/ui/EmptyState'
import { privateHead } from '#/ui/account/head'
import { errorStatus, errorText } from '#/ui/account/text'
import submitCss from '#/ui/submit/submit.css?url'
import { SubmitForm } from '#/ui/submit/SubmitForm'

// One 投稿: edit a draft, revise a returned one, or view it (pending, published, withdrawn).
export const Route = createFileRoute('/_site/me/submissions/$id')({
  loader: async ({ params, location }) => {
    try {
      const detail = await getSubmissionFn({ data: { id: params.id } })
      const ctx = await getSubmitContextFn({ data: { packSlug: detail.kind === 'new_pack' ? undefined : detail.pack.slug } })
      return { detail, ctx }
    } catch (err) {
      if (errorStatus(err) === 401) throw redirect({ to: '/login', search: { next: location.href } })
      throw err
    }
  },
  head: ({ matches }) => privateHead(matches, '投稿详情', [submitCss]),
  errorComponent: ({ error }) => (
    <div className="wrap narrow">
      <EmptyState icon="info" title="打不开这条投稿">
        {errorText(error, '投稿不存在，或者你没有权限查看。')}
      </EmptyState>
    </div>
  ),
  component: function SubmissionPage() {
    const { detail, ctx } = Route.useLoaderData()
    return <SubmitForm key={detail.id} ctx={ctx} detail={detail} kind={detail.kind} />
  },
})
