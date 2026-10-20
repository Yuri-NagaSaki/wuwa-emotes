// The legal documents (/legal/:doc). Kept apart from DocPages.tsx: the route's beforeLoad and head use
// this list, and those stay in the entry chunk.

export type LegalDoc = 'privacy' | 'terms' | 'takedown'
export const LEGAL_DOCS: { id: LegalDoc; title: string; description: string }[] = [
  { id: 'privacy', title: '隐私政策', description: '本站收集哪些信息、怎么使用、保存多久。' },
  { id: 'terms', title: '服务条款', description: '使用本站与投稿时需要遵守的约定。' },
  { id: 'takedown', title: '版权与下架申诉', description: '作者与权利人如何申请下架或修改署名。' },
]
