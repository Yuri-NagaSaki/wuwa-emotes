import { useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { SubmissionDeclaration, SubmissionKind } from '#/server/db/schema/submissions'
import type { SubmitContext } from '#/server/submissions/context'
import type { SubmissionDetail, UploadView } from '#/server/submissions/service'
import {
  completeUploadsFn,
  createSubmissionFn,
  listUploadsFn,
  presignUploadsFn,
  removeUploadFn,
  reorderEmojisFn,
  submitSubmissionFn,
  updateSubmissionFn,
  withdrawSubmissionFn,
} from '#/server/submissions/fn'
import {
  IDENTITIES,
  isEditable,
  KIND_LABELS,
  LICENSE_OPTIONS,
  STATUS_LABELS,
  STATUS_TONE,
  submitProblems,
  TEXT_LIMITS,
  UPLOAD_LIMITS,
  type Identity,
  type ProposedPayload,
} from '#/server/submissions/rules'
import { Button } from '../Button'
import { cx } from '../cx'
import { Check, Field, Input, Textarea } from '../Field'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { Modal, ModalClose } from '../Modal'
import { PackCard } from '../PackCard'
import { Seg } from '../Seg'
import { Select } from '../Select'
import { Switch } from '../Switch'
import { toast } from '../Toast'
import { errorText } from '../account/text'
import { FileGrid, type LocalState, type Tile } from './FileGrid'
import { ArtistTokens, CharacterPicker, type ArtistValue } from './pickers'
import { chunk, PARALLEL_PUTS, putFile, rejectReason, runLimited } from './uploader'

// 投稿 form (prototype id "submit"): 基本信息, 上传表情, 署名与授权, then the submit bar (a fixed action
// bar on phones). Used by /submit (new) and /me/submissions/$id (edit, revise, or read-only view).
// The draft is created on the first save or upload; uploads go straight to storage and the grid polls
// their processing status.

export interface SubmitFormProps {
  ctx: SubmitContext
  detail: SubmissionDetail | null
  kind: SubmissionKind
  /** add_emojis / edit_pack before the draft exists */
  packSlug?: string
  /** called once the draft exists (the page keeps its id in the URL) */
  onCreated?: (id: string) => void
}

interface FormState {
  title: string
  excerpt: string
  descriptionMd: string
  commissioner: string
  characterIds: number[]
  artists: ArtistValue
  official: boolean
  removeEmojiIds: string[]
  coverEmojiId: string | null
}

interface DeclState {
  identity: Identity
  license: string
  proofUrl: string
  note: string
  downloadable: boolean
}

function initialForm(d: SubmissionDetail | null): FormState {
  const p: ProposedPayload = d?.payload ?? {}
  return {
    title: p.title ?? '',
    excerpt: p.excerpt ?? '',
    descriptionMd: p.descriptionMd ?? '',
    commissioner: p.commissioner ?? '',
    characterIds: p.characterIds ?? [],
    artists: { ids: p.artistIds ?? [], names: p.artistNames ?? [] },
    official: Boolean(p.official),
    removeEmojiIds: p.removeEmojiIds ?? [],
    coverEmojiId: p.coverEmojiId ?? null,
  }
}

/**
 * New packs default to 允许下载 on; changes to an existing pack start from its current setting (most
 * imported packs are preview-only, §6.4), and 补充表情 cannot change it at all.
 */
function initialDecl(d: SubmissionDetail | null, kind: SubmissionKind, ctx: SubmitContext): DeclState {
  const x = d?.declaration
  const current = d && d.kind !== 'new_pack' ? d.pack.downloadable : kind !== 'new_pack' ? (ctx.pack?.downloadable ?? false) : true
  return {
    identity: x?.identity ?? 'artist',
    license: x?.license ?? d?.pack.license ?? 'cc-by-nc-sa-4.0',
    proofUrl: x?.proofUrl ?? '',
    note: x?.note ?? '',
    downloadable: kind === 'add_emojis' ? current : (x?.downloadable ?? current),
  }
}

const ACCEPT = UPLOAD_LIMITS.mimes.join(',')

export function SubmitForm({ ctx, detail, kind: kindProp, packSlug, onCreated }: SubmitFormProps) {
  const router = useRouter()
  const navigate = useNavigate()
  const kind = detail?.kind ?? kindProp
  const [id, setId] = useState<string | null>(detail?.id ?? null)
  const [form, setForm] = useState<FormState>(() => initialForm(detail))
  const [decl, setDecl] = useState<DeclState>(() => initialDecl(detail, kind, ctx))
  const [uploads, setUploads] = useState<UploadView[]>(detail?.uploads ?? [])
  const [local, setLocal] = useState<Record<string, LocalState>>({})
  const [rejected, setRejected] = useState<{ key: string; name: string; reason: string }[]>([])
  const [order, setOrder] = useState<string[]>(() => detail?.emojis.map((e) => e.id) ?? [])
  const [agree, setAgree] = useState(detail?.status === 'returned' || detail?.status === 'pending')
  const [busy, setBusy] = useState<null | 'save' | 'submit' | 'withdraw'>(null)
  const [over, setOver] = useState(false)
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const creating = useRef<Promise<string> | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const status = detail?.status ?? 'draft'
  const editable = isEditable(status) && ctx.submitMode !== 'blocked'
  const pack = detail?.pack ?? null
  const official = kind === 'new_pack' ? form.official : (pack?.sourceKind ?? ctx.pack?.sourceKind) === 'official'

  // ---- tiles: finished emojis in their order, then the rest in upload order, then refused files ----
  const tiles: Tile[] = useMemo(() => {
    const pos = new Map(order.map((e, i) => [e, i]))
    const done = uploads.filter((u) => u.emoji).sort((a, b) => (pos.get(a.emoji!.id) ?? 1e9) - (pos.get(b.emoji!.id) ?? 1e9))
    const rest = uploads.filter((u) => !u.emoji && !(u.status === 'done'))
    return [
      ...done.map((u) => ({ key: u.id, upload: u, local: local[u.id] })),
      ...rest.map((u) => ({ key: u.id, upload: u, local: local[u.id] })),
      ...rejected.map((r) => ({ key: r.key, rejected: { name: r.name, reason: r.reason } })),
    ]
  }, [uploads, local, rejected, order])
  const emojiIds = tiles.flatMap((t) => (t.upload?.emoji ? [t.upload.emoji.id] : []))
  const coverId = form.coverEmojiId && emojiIds.includes(form.coverEmojiId) ? form.coverEmojiId : kind === 'new_pack' ? (emojiIds[0] ?? null) : form.coverEmojiId
  const activeUploads = uploads.filter((u) => u.status === 'signed' || u.status === 'uploaded' || u.status === 'processing').length

  // ---- poll processing status ----
  const needsPoll = Boolean(id) && uploads.some((u) => u.status === 'uploaded' || u.status === 'processing' || (u.status === 'done' && u.emoji && !u.emoji.poster))
  useEffect(() => {
    if (!needsPoll || !id) return
    const t = setInterval(async () => {
      try {
        const list = await listUploadsFn({ data: { id } })
        setUploads((prev) => mergeUploads(prev, list))
        setOrder((o) => [...o, ...list.flatMap((u) => (u.emoji && !o.includes(u.emoji.id) ? [u.emoji.id] : []))])
      } catch {
        // keep polling; a transient failure should not stop the grid
      }
    }, 1500)
    return () => clearInterval(t)
  }, [needsPoll, id])

  // release object URLs on unmount
  const localRef = useRef(local)
  localRef.current = local
  useEffect(() => () => Object.values(localRef.current).forEach((l) => l.localUrl && URL.revokeObjectURL(l.localUrl)), [])

  // ---- payload ----
  function payloadOf(f: FormState): Partial<ProposedPayload> & { artistNames?: string[] } {
    if (kind === 'add_emojis') return {}
    return {
      title: f.title,
      excerpt: f.excerpt || null,
      descriptionMd: f.descriptionMd || null,
      commissioner: f.commissioner || null,
      characterIds: f.characterIds,
      artistIds: f.artists.ids,
      artistNames: f.artists.names,
      ...(kind === 'new_pack' ? { official: f.official } : { removeEmojiIds: f.removeEmojiIds }),
      ...(f.coverEmojiId ? { coverEmojiId: f.coverEmojiId } : {}),
    }
  }

  function declOf(d: DeclState): SubmissionDeclaration {
    return { identity: d.identity, license: d.license, proofUrl: d.proofUrl.trim() || null, note: d.note.trim() || null, downloadable: official ? false : d.downloadable }
  }

  async function ensureDraft(): Promise<string> {
    if (id) return id
    creating.current ??= (async () => {
      const r = await createSubmissionFn({
        data: { kind, packSlug: kind === 'new_pack' ? undefined : (packSlug ?? ctx.pack?.slug), payload: payloadOf(form), declaration: declOf(decl) },
      })
      setId(r.id)
      onCreated?.(r.id)
      return r.id
    })()
    try {
      return await creating.current
    } catch (err) {
      creating.current = null
      throw err
    }
  }

  async function save(quiet = false): Promise<string | null> {
    setBusy('save')
    try {
      const created = !id
      const sid = await ensureDraft()
      if (!created) await updateSubmissionFn({ data: { id: sid, payload: payloadOf(form), declaration: declOf(decl) } })
      if (!quiet) toast('草稿已保存')
      return sid
    } catch (err) {
      toast({ message: errorText(err, '保存失败，请稍后再试'), icon: 'warn' })
      return null
    } finally {
      setBusy(null)
    }
  }

  // ---- uploads ----
  async function addFiles(files: File[]) {
    if (!editable || !files.length) return
    const ok: File[] = []
    const bad: { key: string; name: string; reason: string }[] = []
    for (const f of files) {
      const reason = rejectReason(f)
      if (reason) bad.push({ key: crypto.randomUUID(), name: f.name, reason })
      else ok.push(f)
    }
    if (bad.length) setRejected((r) => [...r, ...bad])
    if (!ok.length) return
    let sid: string
    try {
      sid = await ensureDraft()
    } catch (err) {
      toast({ message: errorText(err, '创建草稿失败，请稍后再试'), icon: 'warn' })
      return
    }
    for (const group of chunk(ok, UPLOAD_LIMITS.maxPerRequest)) {
      let signed: Awaited<ReturnType<typeof presignUploadsFn>>
      try {
        signed = await presignUploadsFn({ data: { id: sid, files: group.map((f) => ({ name: f.name, size: f.size, type: f.type })) } })
      } catch (err) {
        toast({ message: errorText(err, '申请上传失败，请稍后再试'), icon: 'warn' })
        return
      }
      const pairs = signed.map((s, i) => ({ s, f: group[i]! }))
      setUploads((u) => [...u, ...pairs.map(({ s, f }): UploadView => ({ id: s.id, filename: s.name, bytes: f.size, status: 'signed', error: null, emoji: null }))])
      setLocal((l) => ({ ...l, ...Object.fromEntries(pairs.map(({ s, f }) => [s.id, { progress: 0, localUrl: URL.createObjectURL(f) }])) }))
      await runLimited(pairs, PARALLEL_PUTS, async ({ s, f }) => {
        try {
          await putFile(s.url, f, s.contentType, (p) => setLocal((l) => ({ ...l, [s.id]: { ...l[s.id], progress: p } })))
          await completeUploadsFn({ data: { id: sid, uploadIds: [s.id] } })
          setUploads((u) => u.map((x) => (x.id === s.id ? { ...x, status: 'uploaded' } : x)))
          setLocal((l) => ({ ...l, [s.id]: { ...l[s.id], progress: undefined } }))
        } catch (err) {
          setLocal((l) => ({ ...l, [s.id]: { ...l[s.id], progress: undefined, failed: errorText(err, (err as Error).message || '上传失败') } }))
        }
      })
    }
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.currentTarget.files ?? [])]
    e.currentTarget.value = ''
    void addFiles(files)
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setOver(false)
    void addFiles([...e.dataTransfer.files])
  }

  async function removeTile(t: Tile) {
    if (t.rejected) return setRejected((r) => r.filter((x) => x.key !== t.key))
    if (!id || !t.upload) return
    try {
      await removeUploadFn({ data: { id, uploadId: t.upload.id } })
      const url = local[t.upload.id]?.localUrl
      if (url) URL.revokeObjectURL(url)
      setUploads((u) => u.filter((x) => x.id !== t.upload!.id))
      if (t.upload.emoji) {
        const gone = t.upload.emoji.id
        setOrder((o) => o.filter((x) => x !== gone))
        setForm((f) => (f.coverEmojiId === gone ? { ...f, coverEmojiId: null } : f))
      }
    } catch (err) {
      toast({ message: errorText(err), icon: 'warn' })
    }
  }

  async function setCover(emojiId: string) {
    if (!id) return
    setForm((f) => ({ ...f, coverEmojiId: emojiId }))
    try {
      await updateSubmissionFn({ data: { id, payload: { coverEmojiId: emojiId } } })
    } catch (err) {
      toast({ message: errorText(err), icon: 'warn' })
    }
  }

  async function move(emojiId: string, delta: -1 | 1) {
    if (!id) return
    const cur = emojiIds
    const i = cur.indexOf(emojiId)
    const j = i + delta
    if (i < 0 || j < 0 || j >= cur.length) return
    const next = [...cur]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    setOrder(next)
    try {
      setOrder(await reorderEmojisFn({ data: { id, emojiIds: next } }))
    } catch (err) {
      toast({ message: errorText(err), icon: 'warn' })
    }
  }

  // ---- submit / withdraw ----
  const problems = submitProblems({
    kind,
    payload: { ...payloadOf(form), artistIds: form.artists.ids, artistNames: form.artists.names },
    declaration: declOf(decl),
    emojiCount: emojiIds.length,
    activeUploads,
  })

  async function submit() {
    if (!agree) return toast({ message: '请先勾选「我已阅读投稿规范」', icon: 'info' })
    if (problems.length) return toast({ message: problems[0]!, icon: 'info' })
    const sid = await save(true)
    if (!sid) return
    setBusy('submit')
    try {
      const r = await submitSubmissionFn({ data: { id: sid } })
      toast(r.status === 'approved' ? '已发布（免审投稿）' : '已提交审核，结果会通知你')
      await router.invalidate()
      await navigate({ to: '/me/submissions', search: { new: sid } })
    } catch (err) {
      toast({ message: errorText(err, '提交失败，请稍后再试'), icon: 'warn' })
    } finally {
      setBusy(null)
    }
  }

  async function withdraw() {
    if (!id) return
    setBusy('withdraw')
    try {
      await withdrawSubmissionFn({ data: { id } })
      toast('已撤回')
      setConfirmWithdraw(false)
      await router.invalidate()
      await navigate({ to: '/me/submissions' })
    } catch (err) {
      toast({ message: errorText(err), icon: 'warn' })
    } finally {
      setBusy(null)
    }
  }

  // ---- preview card ----
  const posters = tiles.flatMap((t) => (t.upload?.emoji?.poster ? [t.upload.emoji.poster] : t.local?.localUrl && !t.local.failed ? [t.local.localUrl] : []))
  const coverPoster = tiles.find((t) => t.upload?.emoji?.id === coverId)?.upload?.emoji?.poster
  const previewImages = coverPoster ? [coverPoster, ...posters.filter((p) => p !== coverPoster)] : posters
  const charOpts = new Map(ctx.characters.map((c) => [c.id, c]))
  const artistNames = [...form.artists.ids.map((a) => ctx.artists.find((x) => x.id === a)?.name ?? ''), ...form.artists.names].filter(Boolean)
  const titleShown = kind === 'add_emojis' ? (pack?.title ?? ctx.pack?.title ?? '') : form.title

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))
  const setD = <K extends keyof DeclState>(k: K, v: DeclState[K]) => setDecl((d) => ({ ...d, [k]: v }))

  const heading = !detail ? (kind === 'new_pack' ? '投稿表情包' : kind === 'add_emojis' ? '补充表情' : '修改表情包') : status === 'returned' ? '修改后重新提交' : status === 'draft' ? '编辑投稿' : '投稿详情'

  return (
    <div className={cx('wrap', 'sub-page', editable && 'has-actbar')}>
      <div className="page-h">
        <nav className="crumbs" aria-label="位置">
          <AppLink to="/me">个人中心</AppLink>
          <Icon name="right" />
          <AppLink to="/me/submissions">我的投稿</AppLink>
          <Icon name="right" />
          <span>{detail ? '投稿详情' : '新建投稿'}</span>
        </nav>
        <h1>{heading}</h1>
        <span className="sub">
          {kind === 'new_pack'
            ? '把你画的、约的或整理的鸣潮表情分享给大家。提交后由管理员审核。'
            : kind === 'add_emojis'
              ? '给已发布的表情包补充表情。审核通过前，线上仍显示原来的内容。'
              : '修改已发布的表情包。审核通过前，线上仍显示旧版本。'}
        </span>
      </div>

      <StatusBanner detail={detail} onWithdraw={() => setConfirmWithdraw(true)} blocked={ctx.submitMode === 'blocked'} />

      <div className="sub-layout">
        <div style={{ display: 'grid', gap: 18 }}>
          <section className="card sub-step">
            <h3>
              <span className="sn">1</span>基本信息
              {detail ? <span className={cx('st', STATUS_TONE[status])}>{STATUS_LABELS[status]}</span> : null}
              <span className="st mute">{KIND_LABELS[kind]}</span>
            </h3>
            {kind === 'add_emojis' ? (
              <div className="target-pack">
                {ctx.pack?.cover ? <img src={ctx.pack.cover} alt="" width={64} height={64} /> : <Icon name="grid" size="lg" />}
                <div>
                  <b className="dyn">{titleShown || '（未找到这个包）'}</b>
                  <small>
                    现有 {pack?.emojiCount ?? ctx.pack?.emojiCount ?? 0} 张 · 新上传的表情审核通过后加到包的末尾
                  </small>
                </div>
              </div>
            ) : (
              <div className="form-grid">
                <Field label="标题" className="full" aside={`${[...form.title].length}/${TEXT_LIMITS.title}`}>
                  <Input placeholder="例如：爱弥斯 · 新年板牌" value={form.title} maxLength={TEXT_LIMITS.title} disabled={!editable} onChange={(e) => set('title', e.currentTarget.value)} />
                </Field>
                <Field label="角色" className="full">
                  <CharacterPicker options={ctx.characters} value={form.characterIds} onChange={(v) => set('characterIds', v)} disabled={!editable} />
                </Field>
                <Field label="简介" className="full" aside="选填">
                  <Textarea
                    style={{ minHeight: 76 }}
                    placeholder="一句话介绍这个包，例如：新年限定板牌，共 24 张。"
                    value={form.excerpt}
                    maxLength={TEXT_LIMITS.excerpt}
                    disabled={!editable}
                    onChange={(e) => set('excerpt', e.currentTarget.value)}
                  />
                </Field>
                {kind === 'new_pack' ? (
                  <div className="full">
                    <Check checked={form.official} disabled={!editable} onChange={(v) => set('official', v)}>
                      这是官方表情（官转）：只提供预览，不开放下载
                    </Check>
                  </div>
                ) : null}
              </div>
            )}
          </section>

          <section className="card sub-step">
            <h3>
              <span className="sn">2</span>上传表情<small>GIF、PNG、WebP、JPEG，单个不超过 20 MB，最多 {UPLOAD_LIMITS.maxFiles} 张</small>
            </h3>
            {editable ? (
              <div
                className={cx('drop', over && 'is-over')}
                style={{ padding: 20 }}
                onDragOver={(e) => {
                  e.preventDefault()
                  setOver(true)
                }}
                onDragLeave={() => setOver(false)}
                onDrop={onDrop}
              >
                <span className="drop-ico">
                  <Icon name="upload" size="lg" />
                </span>
                <div>
                  <b>拖入图片文件</b>
                  <p>文件直接传到存储，不经过网站服务器；同一个包里重复的图片会自动跳过。</p>
                </div>
                <Button variant="primary" size="sm" icon="upload" onClick={() => fileInput.current?.click()}>
                  选择文件
                </Button>
                <input ref={fileInput} type="file" multiple accept={ACCEPT} className="sr" tabIndex={-1} aria-hidden="true" onChange={onPick} />
              </div>
            ) : null}
            {tiles.length ? (
              <FileGrid tiles={tiles} coverId={coverId} editable={editable} onCover={setCover} onMove={move} onRemove={removeTile} />
            ) : !editable ? (
              <p className="hint">没有上传新表情。</p>
            ) : null}
            {kind === 'edit_pack' && detail?.packEmojis.length ? (
              <ExistingEmojis
                emojis={detail.packEmojis}
                removed={form.removeEmojiIds}
                coverId={form.coverEmojiId}
                editable={editable}
                onToggle={(eid) => set('removeEmojiIds', form.removeEmojiIds.includes(eid) ? form.removeEmojiIds.filter((x) => x !== eid) : [...form.removeEmojiIds, eid])}
                onCover={(eid) => set('coverEmojiId', eid)}
              />
            ) : null}
          </section>

          <section className="card sub-step">
            <h3>
              <span className="sn">3</span>署名与授权
            </h3>
            <div className="form-grid">
              {kind !== 'add_emojis' ? (
                <Field label="画师" hint="不在画师名录里的名字，审核通过时会新建">
                  <ArtistTokens options={ctx.artists} value={form.artists} onChange={(v) => set('artists', v)} disabled={!editable} />
                </Field>
              ) : null}
              <Field label="我的身份">
                <Seg
                  size="form"
                  className={editable ? undefined : 'is-disabled'}
                  label="我的身份"
                  options={IDENTITIES.map((i) => ({ value: i.value, label: i.label }))}
                  value={decl.identity}
                  onChange={(v) => editable && setD('identity', v)}
                />
              </Field>
              {kind !== 'add_emojis' ? (
                <Field label="约稿人" aside="选填">
                  <Input placeholder="约稿人的名字" value={form.commissioner} maxLength={TEXT_LIMITS.commissioner} disabled={!editable} onChange={(e) => set('commissioner', e.currentTarget.value)} />
                </Field>
              ) : null}
              <Field label="授权说明" className="full" hint="写清楚谁画的、谁约的稿、是否同意在本站公开下载">
                <Textarea
                  style={{ minHeight: 70 }}
                  placeholder="例如：已获画师同意，在本站以 CC BY-NC-SA 4.0 公开分享。"
                  value={decl.note}
                  maxLength={TEXT_LIMITS.note}
                  disabled={!editable}
                  onChange={(e) => setD('note', e.currentTarget.value)}
                />
              </Field>
              <Field label="授权凭证" aside="选填">
                <Input icon="link" type="url" placeholder="聊天截图或公开声明的链接" value={decl.proofUrl} disabled={!editable} onChange={(e) => setD('proofUrl', e.currentTarget.value)} />
              </Field>
              <Field label="许可协议" id="sub-license">
                <Select id="sub-license" label="许可协议" value={decl.license} options={LICENSE_OPTIONS} disabled={!editable || kind === 'add_emojis'} onChange={(v) => setD('license', v)} />
              </Field>
              <div className="full set-row" style={{ padding: '12px 14px' }}>
                <div>
                  <b>允许下载</b>
                  <small>
                    {official
                      ? '官方表情只提供预览，不能开启下载。'
                      : kind === 'add_emojis'
                        ? '补充表情沿用这个包现在的下载设置。'
                        : '关闭后只提供预览。最终由审核人确认。'}
                  </small>
                </div>
                <Switch checked={official ? false : decl.downloadable} disabled={!editable || official || kind === 'add_emojis'} onCheckedChange={(v) => setD('downloadable', v)}>
                  <span className="sr">允许下载</span>
                </Switch>
              </div>
            </div>
          </section>

          {editable ? (
            <div className="sub-submit">
              <Check checked={agree} onChange={setAgree}>
                我已阅读投稿规范，确认以上信息属实
              </Check>
              <span className="grow" />
              {problems.length ? <span className="hint">{problems[0]}</span> : null}
              <Button size="sm" onClick={() => save()} disabled={busy != null}>
                保存草稿
              </Button>
              <Button variant="primary" icon="send" onClick={submit} disabled={busy != null}>
                {busy === 'submit' ? '正在提交…' : status === 'returned' ? '重新提交' : '提交审核'}
              </Button>
            </div>
          ) : null}
        </div>

        <aside className="sub-aside">
          <div className="card">
            <h3 style={{ fontSize: 16, marginBottom: 10 }}>投稿须知</h3>
            <ul className="sub-rules">
              <li>每位注册用户都可以投稿，管理员审核通过后公开。</li>
              <li>同一个包放同一组风格的表情，并写清画师与约稿人。</li>
              <li>官方表情可以投稿整理，但只提供预览。</li>
              <li>已发布的包再次修改会重新审核，审核期间线上显示旧版本。</li>
              <li>审核结果会出现在「个人中心 › 通知」。</li>
            </ul>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              发布后的样子
            </div>
            <PackCard
              href={detail ? `/me/submissions/${detail.id}` : '/submit'}
              title={titleShown || '未命名的表情包'}
              excerpt={kind === 'add_emojis' ? null : form.excerpt || null}
              count={(kind === 'new_pack' ? 0 : (pack?.emojiCount ?? ctx.pack?.emojiCount ?? 0)) + emojiIds.length - form.removeEmojiIds.length}
              images={previewImages.slice(0, 4)}
              variant="four"
              flags={official ? ['official', 'new'] : ['new']}
              characters={form.characterIds.flatMap((c) => (charOpts.get(c) ? [{ name: charOpts.get(c)!.name, color: charOpts.get(c)!.color ?? undefined }] : []))}
              artists={artistNames}
              official={official}
              downloads={0}
              favorites={0}
            />
          </div>
        </aside>
      </div>

      {editable && mounted
        ? // portalled: main.page keeps a transform from its entrance animation, which would pin a
          // fixed bar to the page instead of the screen
          createPortal(
            <div className="mob-actbar">
              <Button size="sm" onClick={() => save()} disabled={busy != null}>
                保存草稿
              </Button>
              <Button variant="primary" icon="send" onClick={submit} disabled={busy != null}>
                {status === 'returned' ? '重新提交' : '提交审核'}
              </Button>
            </div>,
            document.body,
          )
        : null}

      <Modal
        open={confirmWithdraw}
        onOpenChange={setConfirmWithdraw}
        icon="back"
        title="撤回这条投稿？"
        actions={
          <>
            <ModalClose render={<Button>先不撤回</Button>} />
            <Button variant="danger" onClick={withdraw} disabled={busy != null}>
              撤回
            </Button>
          </>
        }
      >
        撤回后投稿结束，不能再提交；上传的图片会在 30 天后清理。
      </Modal>
    </div>
  )
}

/** Server state wins, except for rows the browser is still uploading. */
function mergeUploads(prev: UploadView[], next: UploadView[]): UploadView[] {
  const byId = new Map(next.map((u) => [u.id, u]))
  const merged = prev.map((p) => byId.get(p.id) ?? p)
  for (const n of next) if (!prev.some((p) => p.id === n.id)) merged.push(n)
  return merged
}

function StatusBanner({ detail, onWithdraw, blocked }: { detail: SubmissionDetail | null; onWithdraw: () => void; blocked: boolean }) {
  if (blocked) {
    return (
      <div className="note-box warn sub-banner">
        <Icon name="ban" size="sm" />
        <span>你的账号暂时不能投稿，如有疑问请联系站长。</span>
      </div>
    )
  }
  if (!detail) return null
  const notes: ReactElement[] = []
  if (detail.conflict) {
    notes.push(
      <div key="c" className="note-box warn sub-banner">
        <Icon name="warn" size="sm" />
        <span>这个包在你创建投稿后被修改过。{detail.status === 'returned' ? '重新提交时会以最新版本为基准，请确认你的修改仍然合适。' : '审核时可能需要重新提交。'}</span>
      </div>,
    )
  }
  switch (detail.status) {
    case 'returned':
      notes.push(
        <div key="r" className="note-box warn sub-banner">
          <Icon name="reply" size="sm" />
          <span className="dyn">退回原因：{detail.reviewNote ?? '（未填写）'}。修改后可以重新提交。</span>
        </div>,
      )
      break
    case 'pending':
      notes.push(
        <div key="p" className="note-box sub-banner">
          <Icon name="clock" size="sm" />
          <span>正在审核中，结果会通知你。需要修改的话，可以先撤回。</span>
          <Button size="xs" onClick={onWithdraw}>
            撤回
          </Button>
        </div>,
      )
      break
    case 'approved':
      notes.push(
        <div key="a" className="note-box sub-banner">
          <Icon name="check" size="sm" />
          <span>已通过审核并发布。</span>
          <AppLink to={`/packs/${detail.pack.slug}`} className="btn xs">
            查看表情包
          </AppLink>
        </div>,
      )
      break
    case 'withdrawn':
      notes.push(
        <div key="w" className="note-box sub-banner">
          <Icon name="info" size="sm" />
          <span>这条投稿已撤回。</span>
        </div>,
      )
      break
  }
  return <>{notes}</>
}

function ExistingEmojis({
  emojis,
  removed,
  coverId,
  editable,
  onToggle,
  onCover,
}: {
  emojis: SubmissionDetail['packEmojis']
  removed: string[]
  coverId: string | null
  editable: boolean
  onToggle: (id: string) => void
  onCover: (id: string) => void
}) {
  return (
    <div className="existing">
      <div className="lab">
        现有表情 <small>点「移除」把表情从包里拿掉（审核通过后生效）</small>
      </div>
      <div className="sub-files">
        {emojis.map((e) => {
          const gone = removed.includes(e.id)
          return (
            <div key={e.id} className={cx('sub-file', e.id === coverId && 'is-cover', gone && 'is-gone')}>
              {e.poster ? <img src={e.poster} alt="" width={96} height={96} loading="lazy" /> : <span className="ph" />}
              {e.id === coverId ? <span className="cv-tag">封面</span> : null}
              <span className={cx('st', gone ? 'err' : 'mute')}>{gone ? '将移除' : '现有'}</span>
              {editable ? (
                <span className="sf-acts">
                  {!gone && e.id !== coverId ? (
                    <button type="button" className="tip" data-tip="设为封面" aria-label="设为封面" onClick={() => onCover(e.id)}>
                      <Icon name="star" size="sm" />
                    </button>
                  ) : null}
                  <button type="button" className="tip" data-tip={gone ? '保留' : '移除'} aria-label={gone ? '保留' : '移除'} onClick={() => onToggle(e.id)}>
                    <Icon name={gone ? 'refresh' : 'trash'} size="sm" />
                  </button>
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
