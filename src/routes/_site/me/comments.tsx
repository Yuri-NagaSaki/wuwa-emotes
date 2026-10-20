import { createFileRoute } from '@tanstack/react-router'
import { MyComments } from '#/ui/comments'

// 个人中心 › 我的评论. The list is per account and loads in the browser (myCommentsFn, requireUser);
// the /me layout already sends anonymous visitors to /login.
export const Route = createFileRoute('/_site/me/comments')({
  component: function MyCommentsTab() {
    return <MyComments />
  },
})
