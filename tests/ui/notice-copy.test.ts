import { describe, expect, test } from 'bun:test'
import type { NoticeKind, NoticePayloads } from '#/server/account/notifications'
import { noticeCopy } from '#/ui/account/notice-copy'

// Every kind the server writes (NoticePayloads) has its own line in 通知: this record does not
// typecheck when a kind is added without a sample here.
const SAMPLES: { [K in NoticeKind]: NoticePayloads[K] } = {
  'submission.approved': { submissionId: 's1', packId: 1, slug: 'aimisi-01', title: '爱弥斯动态表情包' },
  'submission.returned': { submissionId: 's2', packId: 1, slug: 'aimisi-01', title: '爱弥斯动态表情包', reason: '缺少画师授权说明' },
  'comment.reply': {
    commentId: 42,
    parentId: 41,
    rootId: 41,
    threadType: 'pack',
    threadId: '1',
    by: '海风',
    excerpt: '同感，这张太可爱了',
    title: '爱弥斯动态表情包',
    href: '/packs/aimisi-01#c-42',
  },
}

describe('notice copy', () => {
  test.each(Object.entries(SAMPLES))('%s has its own line and a link', (kind, payload) => {
    const c = noticeCopy({ kind, payload })
    expect(c.title).not.toBe('新通知')
    expect(c.to).toStartWith('/')
    expect(c.action).toBeTruthy()
  })

  test('comment.reply: who replied, the excerpt, and the reply anchor', () => {
    expect(noticeCopy({ kind: 'comment.reply', payload: SAMPLES['comment.reply'] })).toEqual({
      icon: 'chat',
      title: '海风 回复了你',
      detail: '同感，这张太可爱了',
      to: '/packs/aimisi-01#c-42',
      action: '查看',
    })
  })

  test('comment.reply on a page that is gone: no link', () => {
    const c = noticeCopy({ kind: 'comment.reply', payload: { ...SAMPLES['comment.reply'], href: null } })
    expect(c.title).toBe('海风 回复了你')
    expect(c.to).toBeUndefined()
  })

  test('unknown kinds fall back to a generic line', () => {
    expect(noticeCopy({ kind: 'something.new', payload: {} })).toEqual({ icon: 'bell', title: '新通知' })
  })
})
