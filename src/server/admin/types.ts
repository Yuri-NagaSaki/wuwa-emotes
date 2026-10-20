// DTOs returned by the admin server functions. Type-only: route and UI modules import these without
// pulling any server code into the client bundle.

import type { Role, SubmitMode } from '#/shared/roles'

export type PackStatus = 'draft' | 'published' | 'hidden'
export type EmojiStatus = 'pending' | 'published' | 'hidden'
export type SourceKind = 'community' | 'official'
export type PackKind = 'animated' | 'static' | 'mixed'
export type TagDimension = 'group' | 'tool' | 'project' | 'origin' | 'custom'

/** JSON as stored in jsonb columns (audit diffs, job payloads). */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export interface Paged<T> {
  rows: T[]
  total: number
  page: number
  pages: number
  pageSize: number
}

// ---------- 仪表盘 ----------

export interface AuditEntry {
  id: number
  at: string
  actorId: string | null
  actorName: string | null
  actorRole: string | null
  impersonatedBy: string | null
  impersonatorName: string | null
  action: string
  targetType: string | null
  targetId: string | null
  diff: Json
}

export interface DashboardData {
  generatedAt: string
  today: string
  /** 原图签发（单张 + 打包清单中的单张），today in Asia/Shanghai, from download_counters / stats */
  originalsToday: number
  zipsToday: number
  /** last 30 days of 原图 + ZIP signings from download_stats_daily (oldest first) */
  downloads30: { day: string; n: number }[]
  pendingSubmissions: { count: number; submitters: number; oldest: string | null }
  pendingComments: { count: number; oldest: string | null }
  openReports: number
  r2Reads: { month: number; threshold: number | null }
  registrations: { today: number; week: number }
  hashSlugs: { characters: number; artists: number }
  topPacks: { id: number; title: string; downloads: number; thumb: string | null }[]
  /** 站长: all recent audit entries; 管理员: only their own (审计日志 is 站长-only) */
  recent: AuditEntry[]
  recentScope: 'all' | 'mine'
}

// ---------- 表情包 ----------

export interface PackListRow {
  id: number
  packKey: string
  slug: string
  title: string
  status: PackStatus
  sourceKind: SourceKind
  kind: PackKind
  downloadable: boolean
  pinLevel: number
  emojiCount: number
  totalEmojis: number
  pendingEmojis: number
  downloadCount: number
  updatedAt: string
  thumb: string | null
  characters: { name: string; color: string | null }[]
}

export interface PackListData extends Paged<PackListRow> {
  counts: Record<PackStatus, number>
}

export interface Option {
  id: number
  name: string
  slug?: string
  color?: string | null
  hint?: string
}

export interface PackEmoji {
  id: string
  status: EmojiStatus
  sortOrder: number
  format: string
  bytes: number
  width: number | null
  height: number | null
  frames: number
  variantRev: number
  derivedReady: boolean
  fullReady: boolean
  p240Bytes: number | null
  a160Bytes: number | null
  thumb: string | null
  storagePackKey: string
}

export interface ZipInfo {
  objectKey: string | null
  bytes: number | null
  builtAt: string | null
  stale: boolean
  queued: boolean
  eligible: boolean
}

export interface PackEditorData {
  pack: {
    id: number
    packKey: string
    slug: string
    title: string
    excerpt: string | null
    descriptionMd: string | null
    status: PackStatus
    sourceKind: SourceKind
    kind: PackKind
    license: string
    downloadable: boolean
    pinLevel: number
    memorial: boolean
    commissioner: string | null
    creditsText: string | null
    sourceUrl: string | null
    coverEmojiId: string | null
    downloadCount: number
    favoriteCount: number
    publishedAt: string | null
    createdAt: string
    updatedAt: string
    ownerName: string | null
    characterIds: number[]
    artistIds: number[]
    commissionerIds: number[]
    tagIds: number[]
  }
  emojis: PackEmoji[]
  zip: ZipInfo
  oldSlugs: string[]
  options: { characters: Option[]; artists: Option[]; tags: Option[] }
}

// ---------- 表情库 ----------

export interface EmojiListRow extends PackEmoji {
  packId: number
  packTitle: string
  packKey: string
  createdAt: string
}

export interface EmojiDetail {
  emoji: EmojiListRow & { sha256: string | null; posterFrame: number; durationMs: number | null; originalKey: string }
  keys: { label: string; key: string }[]
  duplicates: { emojiId: string; status: string; packId: number; packTitle: string; packKey: string }[]
  characters: { id: number; name: string }[]
}

// ---------- 上传中心 ----------

export interface SignedUpload {
  id: string
  filename: string
  url: string
  contentType: string
}

export type UploadStage = 'signed' | 'uploaded' | 'processing' | 'done' | 'duplicate' | 'failed' | 'published'

export interface UploadState {
  id: string
  filename: string
  bytes: number
  stage: UploadStage
  error: string | null
  emojiId: string | null
  thumb: string | null
}

// ---------- 角色 / 画师 / 标签 ----------

export interface CharacterRow {
  id: number
  slug: string
  name: string
  themeColor: string | null
  avatarEmojiId: string | null
  avatar: string | null
  aliases: string[]
  packCount: number
  publishedPackCount: number
  emojiCount: number
  hashSlug: boolean
  suggestedSlug: string | null
}

export interface ArtistRow {
  id: number
  slug: string
  name: string
  links: { label: string; url: string }[]
  aliases: string[]
  packCount: number
  commissionCount: number
  hashSlug: boolean
  suggestedSlug: string | null
  untrimmed: boolean
}

export interface TagRow {
  id: number
  dimension: TagDimension
  slug: string
  name: string
  packCount: number
}

export interface MergeResult {
  from: { id: number; name: string; slug: string }
  to: { id: number; name: string; slug: string }
  packsMoved: number
  emojisMoved: number
  aliasesMoved: number
  redirects: string[]
}

// ---------- 用户与权限 ----------

export interface UserRow {
  id: string
  name: string
  email: string
  role: Role
  submitMode: SubmitMode
  banned: boolean
  banReason: string | null
  banExpires: string | null
  createdAt: string
  lastActive: string | null
  packs: number
  approved: number
  sessions: number
}

export interface UserListData extends Paged<UserRow> {
  counts: Record<Role, number>
}

// ---------- 存储 ----------

export interface StorageGroup {
  key: string
  label: string
  prefix: string
  objects: number
  bytes: number | null
  note: string
}

export interface StorageData {
  bucket: string
  endpointHost: string
  groups: StorageGroup[]
  topPacks: { packKey: string; title: string | null; objects: number; bytes: number }[]
  r2Reads: { month: number; threshold: number | null; byKind: { kind: string; n: number }[] }
}

// ---------- 任务队列 ----------

export interface QueueRow {
  name: string
  policy: string | null
  counts: Record<'created' | 'retry' | 'active' | 'completed' | 'cancelled' | 'failed', number>
}

export interface JobRow {
  id: string
  name: string
  state: string
  data: Json
  output: Json
  retryCount: number
  retryLimit: number
  singletonKey: string | null
  createdOn: string | null
  startedOn: string | null
  completedOn: string | null
}

export interface ScheduleRow {
  name: string
  key: string
  cron: string
  timezone: string
  nextRuns: string[]
  lastJobId: string | null
}

export interface JobsData {
  queues: QueueRow[]
  failed: JobRow[]
  active: JobRow[]
  schedules: ScheduleRow[]
  generatedAt: string
}

// ---------- 系统设置 ----------

export interface SettingsData {
  site: { name: string | null; subtitle: string | null; announcement: string | null }
  effective: { name: string; subtitle: string }
  defaults: { name: string; subtitle: string }
  integrations: {
    cap: { endpoint: string; siteKey: string; secretConfigured: boolean; disabled: boolean }
    smtp: { configured: boolean; from: string | null }
    storage: { endpointHost: string; publicEndpointHost: string | null; bucket: string }
    purge: { configured: boolean }
    siteUrl: string
  }
  updatedAt: string | null
  updatedBy: string | null
}
