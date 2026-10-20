// Comment components for other pages:
//   <CommentsSection threadType="pack" threadId={String(pack.id)} packStickers={pack.emojis} />  (pack page)
//   <CommentsSection threadType="emoji" threadId={emoji.id} packId={pack.id} />                 (single emoji)
//   <MyComments />                                                                               (/me 我的评论)
// Both load their own stylesheet (comments.css via <link precedence>), so pages need no extra CSS.
export { CommentsSection, type CommentsSectionProps } from './CommentsSection'
export { MyComments, type MyCommentsProps } from './MyComments'
export { default as commentsCssUrl } from './comments.css?url'
