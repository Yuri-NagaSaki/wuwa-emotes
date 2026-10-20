import { useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { FavoriteItem, FolderView } from '#/server/favorites/service'
import { createFolderFn, deleteFolderFn, listFavoritesFn, moveFavoriteFn, removeFavoriteFn, renameFolderFn } from '#/server/favorites/fn'
import { Button } from '../Button'
import { cx } from '../cx'
import { EmptyState } from '../EmptyState'
import { Field, Input } from '../Field'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { Menu } from '../Menu'
import { Modal, ModalClose } from '../Modal'
import { Sheet } from '../Sheet'
import { toast } from '../Toast'
import { useAnimatedPreview } from '../usePreview'
import { errorText } from './text'

// 收藏夹 tab: folders (three posters each), the selected folder's favorites, and folder management.

export interface FavoritesData {
  folders: FolderView[]
  current: number | null
  items: FavoriteItem[]
  more: boolean
}

type Dialog = { kind: 'create' } | { kind: 'rename'; folder: FolderView } | { kind: 'delete'; folder: FolderView } | { kind: 'move'; item: FavoriteItem } | null

export function FavoritesPanel({ data }: { data: FavoritesData }) {
  const router = useRouter()
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [extra, setExtra] = useState<FavoriteItem[]>([])
  const [more, setMore] = useState(data.more)
  const folder = data.folders.find((f) => f.id === data.current) ?? null
  const items = [...data.items, ...extra]

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true)
    try {
      await fn()
      if (done) toast(done)
      setDialog(null)
      setExtra([])
      await router.invalidate()
    } catch (err) {
      toast({ message: errorText(err), icon: 'warn' })
    } finally {
      setBusy(false)
    }
  }

  async function loadMore() {
    if (!folder || !items.length) return
    const r = await listFavoritesFn({ data: { folderId: folder.id, before: items[items.length - 1]!.id } })
    setExtra((x) => [...x, ...r.items])
    setMore(r.more)
  }

  const open = (d: Dialog) => {
    setName(d?.kind === 'rename' ? d.folder.name : '')
    setDialog(d)
  }

  return (
    <>
      <div className="folders">
        {data.folders.map((f) => (
          <button
            key={f.id}
            type="button"
            className={cx('folder', f.id === data.current && 'is-on')}
            aria-pressed={f.id === data.current}
            onClick={() => navigate({ to: '/me', search: { folder: f.id } })}
          >
            <div className="mini">
              {[0, 1, 2].map((i) => (f.previews[i] ? <img key={i} src={f.previews[i]} alt="" width={60} height={60} loading="lazy" /> : <span key={i} />))}
            </div>
            <b>{f.name}</b>
            <small>{f.count} 个</small>
          </button>
        ))}
        <button type="button" className="folder add" onClick={() => open({ kind: 'create' })}>
          <Icon name="plus" size="lg" />
          新建收藏夹
        </button>
      </div>

      {folder ? (
        <div className="toolbar">
          <b className="dyn">{folder.name}</b>
          <span className="muted num">{folder.count} 个</span>
          <span className="grow" />
          {!folder.isDefault ? (
            <Menu
              trigger={
                <Button size="sm" icon="more">
                  管理
                </Button>
              }
              items={[
                { label: '重命名', icon: 'edit', onSelect: () => open({ kind: 'rename', folder }) },
                { label: '删除收藏夹', icon: 'trash', danger: true, onSelect: () => open({ kind: 'delete', folder }) },
              ]}
            />
          ) : null}
        </div>
      ) : null}

      {items.length ? (
        <div className="fav-grid">
          {items.map((it) => (
            <FavoriteCard key={it.id} item={it} onMove={() => open({ kind: 'move', item: it })} onRemove={() => run(() => removeFavoriteFn({ data: { favoriteId: it.id } }), '已取消收藏')} />
          ))}
        </div>
      ) : (
        <EmptyState icon="heart" title="这里还没有收藏" actions={<AppLink to="/packs" className="btn sm primary">去逛逛表情包</AppLink>}>
          在表情包或单张表情上点「收藏」，就会出现在这里。
        </EmptyState>
      )}
      {more ? (
        <Button dashed block onClick={loadMore}>
          加载更多
        </Button>
      ) : null}

      <Sheet
        open={dialog?.kind === 'create' || dialog?.kind === 'rename'}
        onOpenChange={(v) => !v && setDialog(null)}
        title={dialog?.kind === 'rename' ? '重命名收藏夹' : '新建收藏夹'}
        icon="folder"
        footer={
          <Button
            variant="primary"
            block
            disabled={busy || !name.trim()}
            onClick={() =>
              run(
                () =>
                  dialog?.kind === 'rename' ? renameFolderFn({ data: { folderId: dialog.folder.id, name } }) : createFolderFn({ data: { name } }),
                dialog?.kind === 'rename' ? '已重命名' : '已新建收藏夹',
              )
            }
          >
            保存
          </Button>
        }
      >
        <Field label="名称" hint="最多 20 个字">
          <Input value={name} maxLength={20} placeholder="例如：聊天常用" onChange={(e) => setName(e.currentTarget.value)} />
        </Field>
      </Sheet>

      <Modal
        open={dialog?.kind === 'delete'}
        onOpenChange={(v) => !v && setDialog(null)}
        icon="trash"
        title="删除这个收藏夹？"
        actions={
          <>
            <ModalClose render={<Button>取消</Button>} />
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                dialog?.kind === 'delete' &&
                run(async () => {
                  await deleteFolderFn({ data: { folderId: dialog.folder.id } })
                  await navigate({ to: '/me', search: {} })
                }, '已删除，收藏移到了默认收藏夹')
              }
            >
              删除
            </Button>
          </>
        }
      >
        里面的收藏不会丢失，会移到「默认收藏夹」。
      </Modal>

      <Sheet open={dialog?.kind === 'move'} onOpenChange={(v) => !v && setDialog(null)} title="移动到" icon="folder">
        <div className="list">
          {data.folders.map((f) => (
            <button
              key={f.id}
              type="button"
              className="li"
              style={{ textAlign: 'left', background: 'none', border: 0, borderBottom: '1.5px solid var(--tp-line)', width: '100%' }}
              disabled={busy || (dialog?.kind === 'move' && dialog.item.folderId === f.id)}
              onClick={() => dialog?.kind === 'move' && run(() => moveFavoriteFn({ data: { favoriteId: dialog.item.id, folderId: f.id } }), `已移到「${f.name}」`)}
            >
              <span className="th">
                <Icon name="folder" />
              </span>
              <div>
                <b className="dyn">{f.name}</b>
                <small>{f.count} 个</small>
              </div>
              {dialog?.kind === 'move' && dialog.item.folderId === f.id ? <span className="st mute">当前</span> : <span />}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  )
}

function FavoriteCard({ item, onMove, onRemove }: { item: FavoriteItem; onMove: () => void; onRemove: () => void }) {
  const pv = useAnimatedPreview<HTMLDivElement>(item.poster ?? '', item.preview)
  return (
    <div className="fav-it" ref={pv.ref} {...pv.handlers}>
      <AppLink to={item.href} className="pic" aria-label={item.title}>
        {pv.src ? <img src={pv.src} alt="" width={240} height={240} loading="lazy" decoding="async" /> : null}
      </AppLink>
      {item.type === 'pack' ? <span className="kind">包</span> : null}
      <div className="t dyn">
        {item.title}
        {item.type === 'pack' && item.emojiCount != null ? <small>{item.emojiCount} 张</small> : item.format ? <small>{item.format.toUpperCase()}</small> : null}
      </div>
      <Menu
        trigger={
          <button type="button" className="more" aria-label="更多操作">
            <Icon name="more" size="sm" />
          </button>
        }
        items={[
          { label: '移动到…', icon: 'folder', onSelect: onMove },
          { label: '取消收藏', icon: 'heart', danger: true, onSelect: onRemove },
        ]}
      />
    </div>
  )
}
