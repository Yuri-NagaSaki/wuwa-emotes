import { type HistoryState, useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback } from 'react'
import './pack-cache'

export { emojiParam } from './search-params'

// The single-emoji dialog on pages that list stickers from many packs (首页潮汐流, 画廊, 角色「全部表情」,
// 探索, 搜索): the open sticker is ?e=<id> on the current route, masked as /e/<id> in the address bar,
// exactly like the pack page. Back closes it; a reload opens the sticker's own /e page.

export interface EmojiParamControls {
  open: number | null
  onOpen: (index: number) => void
  onIndex: (index: number) => void
  onClose: () => void
}

export function useEmojiParam(ids: readonly string[], current: string | undefined): EmojiParamControls {
  const navigate = useNavigate()
  const router = useRouter()
  const found = current ? ids.indexOf(current) : -1

  const show = useCallback(
    (index: number, replace: boolean) => {
      const id = ids[index]
      if (!id) return
      void navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => ({ ...prev, e: id }),
        mask: { to: '/e/$emojiId', params: { emojiId: id }, search: {}, unmaskOnReload: true },
        replace,
        resetScroll: false,
        state: (prev: HistoryState) => ({ tpDialog: replace ? prev.tpDialog : true }),
      } as never)
    },
    [ids, navigate],
  )
  const onClose = useCallback(() => {
    if (router.state.location.state.tpDialog) router.history.back()
    else
      void navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => {
          const { e: _e, ...rest } = prev
          return rest
        },
        resetScroll: false,
      } as never)
  }, [navigate, router])

  return {
    open: found >= 0 ? found : null,
    onOpen: useCallback((i: number) => show(i, false), [show]),
    onIndex: useCallback((i: number) => show(i, true), [show]),
    onClose,
  }
}
