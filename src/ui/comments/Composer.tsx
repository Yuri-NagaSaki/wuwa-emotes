import { useEffect, useRef, useState } from 'react'
import { HONEYPOT_FIELD, MAX_BODY, MAX_STICKERS, MIN_FILL_MS } from '#/server/comments/constants'
import { commentFormTokenFn, createCommentFn, editCommentFn, previewCommentFn } from '#/server/comments/fns'
import type { CommentItem, CreateResult, PreviewResult, Sticker, ThreadConfig } from '#/server/comments/types'
import { Avatar } from '../Avatar'
import { Button, IconButton } from '../Button'
import { capHeaders } from '../cap/load'
import { useInvisibleCap } from '../cap/useInvisibleCap'
import { cx } from '../cx'
import { Input, Textarea } from '../Field'
import { Icon } from '../Icon'
import { useOptionalSiteConfig } from '../site-config'
import { toast } from '../Toast'
import { StickerPicker } from './StickerPicker'
import { composeBody, errorMessage, guestIdentity, markersIn, rememberGuest, rememberStickers, splitBody, stickersInHtml } from './util'

// The comment form (new comment, reply, or edit). Guests fill in a name (and optionally an email, of
// which only a salted hash is stored) and pass Cap invisibly, the same way as the auth forms
// (src/ui/cap/useInvisibleCap.ts): the proof of work starts when the guest starts writing, nothing is
// shown while it runs; 发布 says 验证中… only if it has not finished yet, and a failed check shows one
// line with 重试. The token goes in the x-cap-token header exactly once. Signed-in users never see Cap.
// The hidden 「网站」 field is the honeypot; the form token proves the minimum fill time.
// Markdown works (B / I / 引用 / 链接 in the toolbar, 预览 renders it on the server); no syntax hint.

export interface ComposerViewer {
  id: string
  name: string
  banned: boolean
}

export interface ComposerProps {
  threadType: 'pack' | 'emoji'
  threadId: string
  viewer: ComposerViewer | null
  config: ThreadConfig
  /** From the thread page; refreshed here when it gets old. */
  formToken: string
  /** Reply target (a root or a reply). */
  replyTo?: { id: number; name: string } | null
  /** Edit an existing comment instead of posting. */
  editing?: CommentItem | null
  packId?: number | null
  packStickers?: readonly Sticker[] | null
  phone: boolean
  compact?: boolean
  onDone: (result: CreateResult) => void
  onCancel?: () => void
}

const TOKEN_REFRESH_MS = 20 * 3600_000
/** capErrorMessage('missing' | 'invalid') in src/server/auth/cap.ts: this token, not this comment. */
const CAP_REJECTED: ReadonlySet<string> = new Set(['请先完成人机验证', '人机验证已过期或无效，请重新验证'])

export function Composer(props: ComposerProps) {
  const { viewer, config, replyTo, editing, phone, compact } = props
  // the thread's viewer has no picture; the site chrome's viewer (same account) does
  const site = useOptionalSiteConfig()
  const initial = editing ? splitBody(editing.bodySrc ?? '', stickersInHtml(editing.html)) : { text: '', stickers: [] }
  const [text, setText] = useState(initial.text)
  const [stickers, setStickers] = useState<Sticker[]>(initial.stickers)
  const [guest, setGuest] = useState({ name: '', email: '' })
  const [picker, setPicker] = useState(false)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [formToken, setFormToken] = useState({ token: props.formToken, at: Date.now() })
  const [now, setNow] = useState(() => Date.now())
  const textRef = useRef<HTMLTextAreaElement>(null)
  const hpRef = useRef<HTMLInputElement>(null)
  const pickerBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => setGuest(guestIdentity()), [])
  useEffect(() => setFormToken({ token: props.formToken, at: Date.now() }), [props.formToken])
  // tick until the minimum fill time has passed (enables 发布)
  const readyAt = formToken.at + MIN_FILL_MS + 300
  useEffect(() => {
    if (now >= readyAt) return
    const t = setTimeout(() => setNow(Date.now()), readyAt - now)
    return () => clearTimeout(t)
  }, [now, readyAt])

  const typed = markersIn(text)
  const remaining = MAX_STICKERS - typed - stickers.length
  const body = composeBody(text, stickers)
  const tooLong = body.length > MAX_BODY
  const guestMode = !viewer && !editing
  const blocked = viewer?.banned || (!viewer && !config.guestsAllowed)
  // solve only once the guest starts writing (most visitors of a pack page never comment)
  const [engaged, setEngaged] = useState(false)
  const cap = useInvisibleCap(guestMode && !blocked && engaged)
  const warm = () => {
    if (!guestMode) return
    if (!engaged) setEngaged(true)
    else cap.warm()
  }
  const canSend = !busy && !blocked && !!body && !tooLong && remaining >= 0 && now >= readyAt && (!guestMode || !!guest.name.trim())

  function pick(s: Sticker) {
    if (remaining <= 0) {
      toast({ message: `每条评论最多 ${MAX_STICKERS} 张贴纸`, icon: 'info' })
      return
    }
    setStickers((list) => [...list, s])
    if (remaining - 1 <= 0) setPicker(false)
  }

  function wrap(before: string, after = before, placeholder = '文字') {
    const el = textRef.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b, value } = el
    const inner = value.slice(a, b) || placeholder
    const next = value.slice(0, a) + before + inner + after + value.slice(b)
    setText(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(a + before.length, a + before.length + inner.length)
    })
  }

  function quote() {
    const el = textRef.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b, value } = el
    const sel = value.slice(a, b) || '引用'
    const quoted = sel
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n')
    const prefix = a > 0 && value[a - 1] !== '\n' ? '\n' : ''
    setText(value.slice(0, a) + prefix + quoted + '\n\n' + value.slice(b))
    requestAnimationFrame(() => el.focus())
  }

  async function togglePreview() {
    if (preview) {
      setPreview(null)
      return
    }
    try {
      setPreview(await previewCommentFn({ data: { body: body || ' ' } }))
    } catch (err) {
      toast({ message: errorMessage(err), icon: 'warn' })
    }
  }

  async function freshToken(): Promise<string> {
    if (Date.now() - formToken.at < TOKEN_REFRESH_MS) return formToken.token
    const { formToken: token } = await commentFormTokenFn()
    setFormToken({ token, at: Date.now() })
    // a brand-new token is younger than the minimum fill time; the draft is long written, so just wait
    await new Promise((r) => setTimeout(r, MIN_FILL_MS + 300))
    return token
  }

  async function submit() {
    if (!canSend) return
    setBusy(true)
    try {
      let result: CreateResult
      if (editing) {
        result = await editCommentFn({ data: { id: editing.id, body } })
      } else {
        const token = await freshToken()
        const data = {
          threadType: props.threadType,
          threadId: props.threadId,
          parentId: replyTo?.id,
          body,
          formToken: token,
          [HONEYPOT_FIELD]: hpRef.current?.value ?? '',
          ...(guestMode ? { guestName: guest.name.trim(), guestEmail: guest.email.trim() } : {}),
        }
        if (guestMode) {
          const sent = await cap.run(async (capToken) => {
            try {
              return { error: null, result: await createCommentFn({ data, headers: capHeaders(capToken) }) }
            } catch (err) {
              // a token the server turned down is solved again and sent once more (CapSession.run)
              if (CAP_REJECTED.has(errorMessage(err, ''))) return { error: { code: 'CAPTCHA_INVALID' }, result: null }
              throw err
            }
          })
          // no token: cap.failed shows the line with 重试
          if (!sent?.result) return
          result = sent.result
          rememberGuest({ name: guest.name.trim(), email: guest.email.trim() })
        } else {
          result = await createCommentFn({ data })
        }
      }
      if (stickers.length) rememberStickers(stickers)
      setText('')
      setStickers([])
      setPreview(null)
      setPicker(false)
      if (result.status === 'pending') toast({ message: '已提交，审核通过后公开', icon: 'clock', duration: 3500 })
      else if (!editing) toast({ message: replyTo ? '回复已发布' : '评论已发布', icon: 'check' })
      props.onDone(result)
    } catch (err) {
      toast({ message: errorMessage(err, '发布失败，请稍后再试'), icon: 'warn', duration: 3500 })
    } finally {
      setBusy(false)
    }
  }

  if (blocked && !editing) {
    return (
      <div className={cx('composer', compact && 'is-compact')}>
        <p className="banned">{viewer?.banned ? '你已被禁止评论。如有疑问请联系管理员。' : '评论区暂时只对登录用户开放。'}</p>
      </div>
    )
  }

  return (
    <form
      className={cx('composer', compact && 'is-compact', 'cmt-composer')}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      {replyTo || editing ? (
        <div className="reply-head">
          <Icon name={editing ? 'edit' : 'reply'} size="sm" />
          {editing ? (
            <span>编辑评论</span>
          ) : (
            <span>
              回复 <b>@{replyTo!.name}</b>
            </span>
          )}
          {props.onCancel ? <IconButton look="plain" icon="close" label="取消" className="x" onClick={props.onCancel} /> : null}
        </div>
      ) : viewer ? (
        <div className="who">
          <Avatar name={viewer.name} src={site?.viewer?.id === viewer.id ? site.viewer.avatarUrl : null} size="sm" />
          <span>
            以 <b>{viewer.name}</b> 的身份评论
          </span>
        </div>
      ) : null}
      {guestMode ? (
        <div className="guest">
          <Input
            size="sm"
            placeholder="昵称（必填）"
            aria-label="昵称"
            maxLength={20}
            value={guest.name}
            onChange={(e) => setGuest({ ...guest, name: e.currentTarget.value })}
            onFocus={warm}
            autoComplete="nickname"
          />
          <Input
            size="sm"
            type="email"
            placeholder="邮箱（选填，不公开）"
            aria-label="邮箱"
            maxLength={254}
            value={guest.email}
            onChange={(e) => setGuest({ ...guest, email: e.currentTarget.value })}
            autoComplete="email"
          />
        </div>
      ) : null}
      <div className="hp" aria-hidden="true">
        <label>
          网站
          <input ref={hpRef} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      {preview ? (
        <div className="preview">
          {/* rendered by the server (src/server/comments/render.ts) */}
          <div className="cmt-b" dangerouslySetInnerHTML={{ __html: preview.html }} />
          {preview.problems.length ? (
            <div className="problems">
              {preview.problems.map((p) => (
                <span key={p}>{p}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <Textarea
          ref={textRef}
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value)
            warm()
          }}
          onFocus={warm}
          placeholder={replyTo ? `回复 ${replyTo.name}` : '说点什么，或者直接甩一张贴纸'}
          aria-label={replyTo ? `回复 ${replyTo.name}` : '评论内容'}
          maxLength={MAX_BODY}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void submit()
            }
          }}
        />
      )}
      {stickers.length ? (
        <div className="pending-stk">
          {stickers.map((s, k) => (
            <span className="bthumb" key={`${s.id}-${k}`}>
              <img src={s.poster} width={s.width} height={s.height} alt="" />
              <button type="button" aria-label="移除贴纸" onClick={() => setStickers((list) => list.filter((_, i) => i !== k))}>
                <Icon name="close" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="tools">
        {config.stickersAllowed ? (
          <button ref={pickerBtn} type="button" className={cx('tbtn', picker && 'is-on')} aria-label="插入贴纸" aria-expanded={picker} onClick={() => setPicker((v) => !v)}>
            <Icon name="smile" />
            贴纸
          </button>
        ) : null}
        <button type="button" className="tbtn" aria-label="加粗" onClick={() => wrap('**')} disabled={!!preview}>
          B
        </button>
        <button type="button" className="tbtn" aria-label="斜体" style={{ fontStyle: 'italic' }} onClick={() => wrap('*')} disabled={!!preview}>
          I
        </button>
        <button type="button" className="tbtn" aria-label="引用" onClick={quote} disabled={!!preview}>
          <Icon name="quote" size="sm" />
        </button>
        <button type="button" className="tbtn" aria-label="链接" onClick={() => wrap('[', '](https://)', '链接文字')} disabled={!!preview}>
          <Icon name="link" size="sm" />
        </button>
        <button type="button" className={cx('tbtn tip', preview && 'is-on')} aria-label="预览" data-tip="预览" aria-pressed={!!preview} onClick={togglePreview}>
          <Icon name="eye" size="sm" />
        </button>
        <div className="send">
          <span className={cx('count', tooLong && 'err')}>
            {body.length} / {MAX_BODY}
          </span>
          {props.onCancel && !compact ? (
            <Button size="sm" variant="ghost" onClick={props.onCancel}>
              取消
            </Button>
          ) : null}
          <Button type="submit" variant="primary" size="sm" icon={editing ? 'check' : 'send'} disabled={!canSend} aria-busy={busy || undefined}>
            {guestMode && cap.waiting ? '验证中…' : editing ? '保存' : replyTo ? '回复' : '发布'}
          </Button>
        </div>
      </div>
      {guestMode && cap.failed ? (
        <div className="cm-capfail" role="alert">
          <Icon name="warn" />
          <span>人机验证没有完成，请检查网络后重试。</span>
          <Button type="submit" size="xs">
            重试
          </Button>
        </div>
      ) : null}
      <StickerPicker
        open={picker}
        onClose={() => setPicker(false)}
        onPick={pick}
        picked={stickers}
        remaining={remaining}
        packId={props.packId}
        packStickers={props.packStickers}
        phone={phone}
        anchorRef={pickerBtn}
      />
    </form>
  )
}
