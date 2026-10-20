import { useSyncExternalStore } from 'react'
import { EmptyState } from '../EmptyState'
import { AppLink } from '../link'
import { useBatchIds } from '../pages/useBatch'
import { Sheet } from '../Sheet'
import { BatchAction, BatchGroups, BatchStyles, BatchSummary, ClearBatch } from './BatchParts'
import { useBatchItems } from './items'
import { tray, trayServerSnapshot } from './tray'

// 打包清单 tray: opened from the header 打包 button (and the phone button). A plain list grouped by pack
// with remove, clear and the download itself; /batch shows the same list on a page. Loaded on first open.

export default function BatchTray() {
  const { open } = useSyncExternalStore(tray.subscribe, tray.get, trayServerSnapshot)
  const ids = useBatchIds()
  const { view, error, retry } = useBatchItems(ids)
  const close = () => tray.close()

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? tray.open() : tray.close())}
      title="打包清单"
      subtitle="跨包挑选，一次下载原图"
      icon="box"
      className="tray-drawer"
      footer={
        ids.length ? (
          <>
            <BatchAction view={view} />
            <div className="tray-links">
              <AppLink to="/batch" className="bg-link" onClick={close} style={{ marginLeft: 0 }}>
                在打包页查看全部
              </AppLink>
              <ClearBatch count={ids.length} />
            </div>
          </>
        ) : undefined
      }
    >
      <BatchStyles />
      {ids.length ? (
        <>
          <BatchSummary view={view} />
          {error ? (
            <div className="note-box warn">
              <span>
                {error}
                <button type="button" className="bg-link" onClick={retry}>
                  重试
                </button>
              </span>
            </div>
          ) : null}
          <BatchGroups view={view} onLinkClick={close} />
        </>
      ) : (
        <EmptyState icon="box" title="还没有选中的表情">
          在任意表情上点「加入打包」，可以跨包收集，最后一次下载。
        </EmptyState>
      )}
    </Sheet>
  )
}
