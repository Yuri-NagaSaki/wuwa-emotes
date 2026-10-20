import { EmptyState } from '../EmptyState'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { useBatchIds } from '../pages/useBatch'
import { BatchAction, BatchGroups, BatchStyles, BatchSummary, ClearBatch } from './BatchParts'
import { useBatchItems } from './items'

// /batch: the 打包清单 on a page. Left, the list grouped by pack (remove single stickers); right, the
// summary, what the ZIP contains (CREDITS.txt) and the download. The list lives in this browser only, so
// the server renders the empty frame and the browser fills it in.

export function BatchPage() {
  const ids = useBatchIds()
  const { view, error, retry } = useBatchItems(ids)

  return (
    <div className="wrap batch-page">
      <BatchStyles />
      <div className="page-h">
        <h1>打包清单</h1>
        <span className="sub">在任意表情上点「加入打包」，跨包收集后一次下载原图。清单保存在这个浏览器里。</span>
      </div>
      {ids.length ? (
        <div className="pk-layout">
          <div className="card batch-list">
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
            <BatchGroups view={view} divided />
          </div>
          <aside className="card sand pk-side" aria-label="打包下载">
            <BatchSummary view={view} />
            <div className="note-box">
              <Icon name="shield" size="sm" />
              <span>压缩包里是原图（GIF / PNG），附 CREDITS.txt：每个包的画师、约稿人、许可与本站页面。转载请保留署名，不要商用。</span>
            </div>
            <BatchAction view={view} />
            <span className="hint">原图直接从存储读取，不经过网站服务器。只提供预览的包不会放进压缩包。</span>
            <ClearBatch count={ids.length} className="clear" />
          </aside>
        </div>
      ) : (
        <div className="card batch-empty">
          <EmptyState
            icon="box"
            title="还没有选中的表情"
            actions={
              <AppLink to="/packs" className="btn primary">
                去挑表情包
              </AppLink>
            }
          >
            在任意表情上点「加入打包」，可以跨包收集，最后一次下载。
          </EmptyState>
        </div>
      )}
    </div>
  )
}
