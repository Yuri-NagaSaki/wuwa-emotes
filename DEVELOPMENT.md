# WuWa 表情数据集 · 开发者文档（Cloudflare R2）

> 文档版本：v1  
> 对照快照：本地 `/workspace/wuwa-emoji/`（Asia/Shanghai，采集/构建日 2026-10-20）  
> R2 桶：`wuwa`  
> Account S3 兼容端点：`https://038d174b73fa2299587548b93b5775b4.r2.cloudflarestorage.com`  
> **本文不含任何 Access Key / Secret Key / API Token。**

---

## 1. 概述与目标

本仓库是 [emoji.wuwa.games](https://emoji.wuwa.games)（呜哇小站）公开表情元数据与官方自助下载 API 的一次**个人 / 本地开发**镜像，并按可 CRUD 的层级布局上传到 Cloudflare R2 桶 `wuwa`。

**目标：**

1. 把「包列表 / 角色 / 标签 / 分面」等元数据固定为稳定 JSON，避免依赖站点临时图床 URL。
2. 把每张表情二进制落到可寻址的对象键：`assets/v1/packs/<packKey>/emojis/<emojiId>.<ext>`。
3. 提供按包 / 角色 / 标签的二级索引，方便应用层列表、筛选与增量同步。
4. 在此对象布局之上，约定一套**建议**的应用层 HTTP API（预览、单文件下载、整包 ZIP），由你自行实现；**不声称该 API 已在线上运行**。

**非目标：**

- 不替代站点官方下载与授权流程。
- 不把源站 `media.wuwa.games` 临时 URL 当作永久 CDN。
- 不公开分发本镜像；商用或对外产品需自行联系站方获授权。

布局版本号固定为 **`v1`**（见 `upload_report.json` 的 `layoutVersion` 与 `sync/v1/state.json`）。

---

## 2. 数据来源与许可注意

### 2.1 来源

| 阶段 | 说明 |
|------|------|
| 元数据快照 | Halo Content API + 自定义插件 `api.emoji.jaspin.top` 的公开 GET（只读、限速）；见本地 `README.md`、`endpoints.json` |
| 图片二进制 | 站点官方自助 API（个人开发用途）；见 `IMAGES_README.md`、`download_emojis.py` |
| R2 暂存 | `r2_stage/`（硬链接图片 + 生成 meta/index/sync，**不含密钥**） |
| R2 上传 | `upload_r2.py` → 桶 `wuwa`；结果见 `upload_report.json` |

公开探活过的接口清单见 `meta/v1/endpoints.json`（与根目录 `endpoints.json` 同源）。需登录的接口（characters / artists / gallery / media 等）本次**未**绕过，角色与画师目录由 packs 字段推导。

### 2.2 许可与合规

- 表情包许可多为 **CC BY-NC-SA** 或个人非商用约定；请遵守站点公示条款与画师署名要求。
- 源站 API 返回的图片 URL 为**临时地址**（约 15 分钟），**禁止**当作永久外链或二次 CDN。
- 本镜像仅供个人 / 本地开发；**未经站方许可请勿公开再分发**整库或对外提供无限制下载。
- 本地 `.api_token`、`.secrets/` **从未**上传到 R2（见 `upload_report.json` notes）。

### 2.3 下载覆盖与「跳过的 16 个 API 坏槽」

来自 `IMAGES_README.md` / `r2_stage/build_summary.json` / `download_skipped_slots.jsonl`：

| 指标 | 数值 |
|------|------|
| API 宣称总数 | 15288 |
| 下载成功 | **15272** |
| 下载失败（可重试类） | 0 |
| 跳过的毒化 offset（单条 HTTP 500） | **16** |
| 覆盖 | 15272 + 16 = 15288 / 15288 |
| 本地 `images/` 体积 | 约 15 GiB（字节合计见下文） |

跳过记录格式（`download_skipped_slots.jsonl`，每行一条）：

```json
{"offset0": 1183, "page_size1": 1184, "reason": "api_500_single_item", "at": "2026-10-20T08:44:30+08:00"}
```

下载器对返回 500 的分页用二分定位「单条毒槽」后跳过，因此这些槽位在 R2 中**没有**对应对象；业务侧应按「成功入库 15272」建模，而不是 15288。

### 2.4 目录数量差异（务必知晓）

| 集合 | 数量 | 说明 |
|------|------|------|
| `packs.json` → `items` | **310** | 源站公开 packs / archive-index 列表 |
| `assets/v1/packs/*` / `index/by-pack/*` | **309** | 实际有本地文件并完成索引的包 |
| 仅元数据、无本地资源的包 | 1 | `linglanhuajiang-charging-20261009`（在 packs.json 中，无 asset 目录） |

应用层列表「可下载包」应以 **309** 或 `index/by-pack` 为准；完整站点目录仍可读 310。

---

## 3. R2 桶与对象层级

### 3.1 连接信息（无密钥）

| 项 | 值 |
|----|-----|
| Bucket | `wuwa` |
| S3 API Endpoint | `https://038d174b73fa2299587548b93b5775b4.r2.cloudflarestorage.com` |
| 布局前缀 | `meta/v1/`、`assets/v1/packs/`、`sync/v1/` |

凭证通过环境变量或密钥管理注入（见第 8 节），**不要**写进仓库或本文档。

### 3.2 对象树（与 `r2_stage/` / `upload_report.json` 一致）

```text
wuwa/                                    # R2 bucket
├── meta/v1/
│   ├── README.md                        # 布局说明与构建计数
│   ├── packs.json                       # 包目录（310 items）
│   ├── tags.json                        # Halo 标签（115）
│   ├── characters.json                  # 从 packs 推导的角色（70）
│   ├── artists.json                     # 从 packs 推导的画师（12）
│   ├── facets.json                      # archive-index 分面汇总
│   ├── endpoints.json                   # 源站公开/需登录接口清单
│   ├── manifests/
│   │   └── emojis.jsonl                 # 每行一张表情（15272 行）
│   └── index/
│       ├── by-pack/<packKey>.json       # 309 个
│       ├── by-character/<slug>.json     # 69 个
│       └── by-tag/<slug>.json           # 96 个（标签样索引，见下）
├── assets/v1/packs/<packKey>/
│   ├── pack.json                        # 包元数据 + 本包 emoji 清单
│   └── emojis/<emojiId>.<ext>           # gif / png 等二进制
└── sync/v1/
    └── state.json                       # 同步书签 / 构建摘要
```

本地对照：完整树在 `/workspace/wuwa-emoji/r2_stage/`。  
根目录**没有**独立的 `/workspace/wuwa-emoji/sync/`；`state.json` 位于 `r2_stage/sync/v1/state.json`，上传后键为 `sync/v1/state.json`。

### 3.3 各路径用途

| 对象键 / 前缀 | 用途 |
|---------------|------|
| `meta/v1/packs.json` | 应用启动时拉取的包目录；含封面元数据、互动计数、facets |
| `meta/v1/tags.json` | Halo 标签字典（slug / displayName / postCount） |
| `meta/v1/characters.json` | 角色字典（slug / displayName / packCount）；非源站 characters API |
| `meta/v1/artists.json` | 画师字典；同上，推导集 |
| `meta/v1/facets.json` | 分面维度：角色 / 画师 / 分组 / 工具 / 企划 / 原设 |
| `meta/v1/endpoints.json` | 源站接口探活结果，便于刷新元数据 |
| `meta/v1/manifests/emojis.jsonl` | 全量表情清单；流式扫描 / 重建索引的权威源之一 |
| `meta/v1/index/by-pack/<packKey>.json` | O(1) 取某包全部 emoji 轻量条目 |
| `meta/v1/index/by-character/<slug>.json` | 跨包按角色筛表情 |
| `meta/v1/index/by-tag/<slug>.json` | 按构建时写入的 tag 键筛表情（多为角色 slug / 画师名等，**不等于** Halo 115 标签全集） |
| `assets/v1/packs/<packKey>/pack.json` | 包级权威文件列表（含 `objectKey`、字节数） |
| `assets/v1/packs/<packKey>/emojis/*` | 图片字节；`Content-Type` 按扩展名 |
| `sync/v1/state.json` | 上次构建/同步水位；客户端增量同步入口 |

上传统计（`upload_report.json`，`finishedAt`: 2026-10-20T10:45:39+08:00）：

- 硬链接上传图片：15272  
- 图片字节合计：15028946607（≈14.0 GiB）  
- 本地 asset 文件数（含各包 `pack.json` 等）：15581  
- meta 对象约：488  

---

## 4. 核心对象 Schema

字段均以 `r2_stage/` 内实际文件为准。

### 4.1 `meta/v1/packs.json`

顶层：

```json
{
  "source": "...",
  "fetchedAt": "2026-10-20T...+08:00",
  "total": 310,
  "sumImageCount": 15288,
  "sumImageCountPacksApi": 15288,
  "sumImageCountArchiveIndex": 15288,
  "note": "...",
  "sources": { },
  "items": [ /* Pack */ ]
}
```

`items[]` 常见字段（完整键集见最丰富条目）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 包键，即 `packKey`（URL slug） |
| `postName` | string | Halo 帖内部名 |
| `title` | string | 展示标题 |
| `excerpt` | string | 摘要 |
| `permalink` / `url` | string | 站点路径 / 绝对 URL |
| `publishTime` / `lastModifyTime` | string (RFC3339) | 发布时间 |
| `imageCount` | number | 源站宣称张数 |
| `hasArchive` | boolean | 是否有归档 |
| `featured` / `pinLevel` / `memorial` | bool / number / bool | 运营标记 |
| `characters[]` | object | `{ name, kind, slug, displayName }` |
| `characterNames[]` | string[] | 角色展示名 |
| `artists[]` / `artistNames[]` | object[] / string[] | 画师 |
| `facets` | object | 如 `{ "角色": [...], "分组": [...] }` |
| `favoriteCount` / `downloadCount` / `readCount` | number | 来自 archive-index |
| `cover` | object | 见下；URL **临时** |
| `previewAssets[]` | object[] | 预览子集，通常远少于 `imageCount` |
| `previewAssetCount` | number | 预览数量 |
| `originalFormat` | string | 可选 |
| `listingChannel` | string | 可选 |
| `archiveIndexCoverUrl` / `archiveIndexImageCount` | 可选 | 索引侧冗余 |

`cover` 形状示例：

```json
{
  "resourceId": "r-...",
  "originalFilename": "...",
  "displayName": "...",
  "bytes": 123,
  "mediaType": "image/gif",
  "previewUrl": "https://media.wuwa.games/...",
  "originalUrl": "https://media.wuwa.games/...",
  "downloadUrl": "https://media.wuwa.games/...",
  "webpBytes": 123
}
```

> 应用预览应优先使用 R2 上的 `objectKey` / 建议 API 的预览 URL，而不是 `cover.previewUrl`。

### 4.2 `assets/v1/packs/<packKey>/pack.json`

```json
{
  "packKey": "aimisi-01",
  "name": "aimisi-01",
  "title": "爱弥斯动态表情包（板牌）",
  "excerpt": "...",
  "url": "https://emoji.wuwa.games/archives/aimisi-01",
  "publishTime": "2026-08-06T16:12:47.699334566Z",
  "imageCountDeclared": 25,
  "imageCountLocal": 25,
  "characters": [ { "name": "...", "kind": "CHARACTER", "slug": "aimisi", "displayName": "爱弥斯" } ],
  "artists": [],
  "tags": [],
  "assetPrefix": "assets/v1/packs/aimisi-01/",
  "emojis": [
    {
      "id": "r-0a7bf47f0ec26d3843bf",
      "objectKey": "assets/v1/packs/aimisi-01/emojis/r-0a7bf47f0ec26d3843bf.gif",
      "format": "gif",
      "bytes": 706938,
      "animated": true,
      "characters": ["aimisi"],
      "artists": ["猫屋敷梨梨_春也Haruya"]
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `imageCountDeclared` | 源站 `imageCount` |
| `imageCountLocal` | 本包实际入库文件数 |
| `emojis[].objectKey` | R2 对象键（权威） |
| `emojis[].characters` / `artists` | **字符串 slug/名**（与 packs.json 内嵌对象不同） |

### 4.3 `meta/v1/manifests/emojis.jsonl`（每行一条）

```json
{
  "id": "r-001024013a5ef1e35646",
  "packKey": "backlog-20260927-yangyang-aieinstein-static",
  "pack": {
    "id": "backlog-20260927-yangyang-aieinstein-static",
    "slug": "backlog-20260927-yangyang-aieinstein-static",
    "title": "秧秧 静态合集（爱秧斯坦）",
    "sourceUrl": "https://emoji.wuwa.games/archives/...",
    "postName": "emoji-post-...",
    "count": 68,
    "publishTime": "2026-09-26T19:32:56.981658814Z"
  },
  "characters": [{ "slug": "yangyang", "name": "秧秧" }],
  "artists": [{ "slug": "爱秧斯坦", "name": "爱秧斯坦" }],
  "tags": ["yangyang", "爱秧斯坦"],
  "format": "png",
  "animated": false,
  "contentType": "image/png",
  "bytes": 50822,
  "localPath": "images/.../r-001024013a5ef1e35646.png",
  "objectKey": "assets/v1/packs/.../emojis/r-001024013a5ef1e35646.png",
  "downloadedAt": "2026-10-20T08:32:32+08:00"
}
```

根目录 `images_manifest.jsonl` 为下载阶段清单（含 `httpStatus` / `error` / `localPath`）；R2 侧 `emojis.jsonl` 增加了 `packKey`、`objectKey`、`contentType`、`tags` 等，更适合线上索引。

### 4.4 二级索引

**`meta/v1/index/by-pack/<packKey>.json`**

```json
{
  "packKey": "aimisi-01",
  "title": "爱弥斯动态表情包（板牌）",
  "count": 25,
  "emojis": [
    {
      "id": "r-0a7bf47f0ec26d3843bf",
      "objectKey": "assets/v1/packs/aimisi-01/emojis/r-0a7bf47f0ec26d3843bf.gif",
      "format": "gif",
      "bytes": 706938,
      "animated": true,
      "characters": ["aimisi"],
      "artists": ["猫屋敷梨梨_春也Haruya"]
    }
  ]
}
```

**`meta/v1/index/by-character/<slug>.json`**

```json
{
  "character": "aimisi",
  "count": 1640,
  "emojis": [
    {
      "id": "r-004f6e026159c811fb50",
      "objectKey": "assets/v1/packs/aimisi-xinjilemu-outfit-1/emojis/r-004f6e026159c811fb50.gif",
      "format": "gif",
      "bytes": 352695,
      "animated": true,
      "packKey": "aimisi-xinjilemu-outfit-1"
    }
  ]
}
```

**`meta/v1/index/by-tag/<slug>.json`**

```json
{
  "tag": "0糖红茶",
  "count": 40,
  "emojis": [
    {
      "id": "r-01525005546a280bbb76",
      "objectKey": "assets/v1/packs/changli-cats-png/emojis/r-01525005546a280bbb76.png",
      "format": "png",
      "bytes": 128160,
      "animated": false,
      "packKey": "changli-cats-png"
    }
  ]
}
```

索引规模：by-pack **309**，by-character **69**，by-tag **96**。

### 4.5 `tags.json` / `characters.json` / `artists.json` / `facets.json`

**tags.json**

```json
{
  "source": "https://emoji.wuwa.games/apis/api.content.halo.run/v1alpha1/tags",
  "fetchedAt": "2026-10-20T08:21:18.180120+08:00",
  "total": 115,
  "items": [
    {
      "name": "tag-0vsino9n",
      "displayName": "企划/Solar5",
      "slug": "qi-hua-solar5",
      "permalink": "/tags/qi-hua-solar5",
      "url": "https://emoji.wuwa.games/tags/qi-hua-solar5",
      "cover": null,
      "postCount": 5,
      "statusPostCount": 6,
      "visiblePostCount": 5,
      "creationTimestamp": "2026-09-01T15:25:44.187961811Z",
      "annotations": {}
    }
  ]
}
```

**characters.json / artists.json**（推导集）

```json
{
  "source": "derived from public packs.characters",
  "note": "GET .../characters -> 302 login. This file is derived only.",
  "total": 70,
  "items": [
    {
      "name": "character-1e2ca573335a00cc88b0a81f",
      "kind": "CHARACTER",
      "slug": "aimisi",
      "displayName": "爱弥斯",
      "packCount": 39
    }
  ]
}
```

画师条目 `kind` 为 `"ARTIST"`，`total` 为 **12**。注意：`facets.json` 中画师分面有 **27** 个值，与结构化 `artists`（12）不完全一致——开发时应两套都保留。

**facets.json**

```json
{
  "source": "archive-index.facets",
  "fetchedAt": "2026-10-20T08:20:59.379165+08:00",
  "dimensions": {
    "角色": [{ "value": "爱弥斯", "packCount": 40 }],
    "画师": [{ "value": "...", "packCount": 1 }],
    "分组": [{ "value": "站长推荐", "packCount": 103 }],
    "工具": [],
    "企划": [],
    "原设": []
  },
  "dimensionCounts": {
    "角色": 69,
    "画师": 27,
    "分组": 2,
    "工具": 1,
    "企划": 1,
    "原设": 2
  }
}
```

### 4.6 `sync/v1/state.json`

与 `r2_stage/build_summary.json` 同形（构建水位）：

```json
{
  "version": "v1",
  "builtAt": "2026-10-20T10:33:57+08:00",
  "source": "emoji.wuwa.games official API",
  "download": {
    "total": 15288,
    "downloaded": 15272,
    "failed": 0,
    "skipped_slots": 16,
    "status": "complete",
    "updatedAt": "2026-10-20T10:33:36+08:00"
  },
  "catalog": {
    "emojiCount": 15272,
    "packCount": 309,
    "characterIndexCount": 69,
    "tagIndexCount": 96,
    "bytesTotal": 15028946607,
    "missingLocalFiles": 0
  },
  "layout": {
    "metaPrefix": "meta/v1/",
    "assetsPrefix": "assets/v1/packs/",
    "syncKey": "sync/v1/state.json"
  }
}
```

客户端可用 `builtAt` / `catalog.emojiCount` 判断是否需要全量重拉索引。

---

## 5. 建议应用层 HTTP API

> **【建议接口】** 以下为在 R2 对象布局之上自行实现的后端契约草案，**不是**声称已部署的服务。  
> 建议前缀：`/api/v1`。鉴权、限流、CORS 由实现方决定。  
> 资源读取：元数据可用 Worker / 源站代理读 R2；二进制可用**短期签名 URL**或经同源代理流式转发（公私读策略见第 8 节）。

### 5.1 总览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/sync/state` | 增量水位 |
| GET | `/api/v1/packs` | 包列表（可筛选） |
| GET | `/api/v1/packs/{packKey}` | 包详情 + 表情清单 |
| GET | `/api/v1/packs/{packKey}/zip` | 整包 ZIP |
| GET | `/api/v1/emojis/{emojiId}` | 表情详情 |
| GET | `/api/v1/emojis/{emojiId}/preview` | 预览（重定向或代理） |
| GET | `/api/v1/emojis/{emojiId}/download` | 单文件下载 |
| GET | `/api/v1/characters` | 角色列表 |
| GET | `/api/v1/characters/{slug}/emojis` | 按角色筛表情 |
| GET | `/api/v1/tags` | Halo 标签字典 |
| GET | `/api/v1/index/tags/{slug}/emojis` | 按构建 tag 索引筛表情 |
| GET | `/api/v1/facets` | 分面 |

### 5.2 `GET /api/v1/sync/state`

**响应 200**

```json
{
  "version": "v1",
  "builtAt": "2026-10-20T10:33:57+08:00",
  "catalog": {
    "emojiCount": 15272,
    "packCount": 309,
    "characterIndexCount": 69,
    "tagIndexCount": 96,
    "bytesTotal": 15028946607
  }
}
```

实现：直接返回 `sync/v1/state.json`（可裁剪 `download` 字段）。

### 5.3 `GET /api/v1/packs`

**查询参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| `q` | string | 标题 / name 子串（可选） |
| `character` | string | 角色 slug，过滤 `characters[].slug` |
| `tag` | string | Halo tag slug，或 facets 值（实现自定） |
| `facet` | string | 如 `分组:站长推荐` |
| `animated` | bool | 仅保留声明含动态图的包（可选启发式） |
| `page` | int | 默认 1 |
| `pageSize` | int | 默认 50，建议 ≤ 100 |

**响应 200**

```json
{
  "total": 309,
  "page": 1,
  "pageSize": 50,
  "items": [
    {
      "packKey": "aimisi-01",
      "title": "爱弥斯动态表情包（板牌）",
      "imageCountLocal": 25,
      "imageCountDeclared": 25,
      "characters": [{ "slug": "aimisi", "displayName": "爱弥斯" }],
      "artists": [],
      "facets": { "角色": ["爱弥斯"] },
      "coverObjectKey": "assets/v1/packs/aimisi-01/emojis/r-0a7bf47f0ec26d3843bf.gif",
      "previewUrl": "/api/v1/emojis/r-0a7bf47f0ec26d3843bf/preview"
    }
  ]
}
```

数据源建议：`packs.json` ∩ 存在 `index/by-pack/{packKey}.json` 的集合；封面用本包第一张本地 emoji，避免临时 `media.wuwa.games` URL。

### 5.4 `GET /api/v1/packs/{packKey}`

**响应 200** — 可直接映射 `assets/.../pack.json`，并附加建议字段：

```json
{
  "packKey": "aimisi-01",
  "title": "爱弥斯动态表情包（板牌）",
  "url": "https://emoji.wuwa.games/archives/aimisi-01",
  "imageCountDeclared": 25,
  "imageCountLocal": 25,
  "characters": [{ "slug": "aimisi", "displayName": "爱弥斯" }],
  "emojis": [
    {
      "id": "r-0a7bf47f0ec26d3843bf",
      "format": "gif",
      "bytes": 706938,
      "animated": true,
      "objectKey": "assets/v1/packs/aimisi-01/emojis/r-0a7bf47f0ec26d3843bf.gif",
      "previewUrl": "/api/v1/emojis/r-0a7bf47f0ec26d3843bf/preview",
      "downloadUrl": "/api/v1/emojis/r-0a7bf47f0ec26d3843bf/download"
    }
  ],
  "zipUrl": "/api/v1/packs/aimisi-01/zip"
}
```

**404**：无此 `packKey` 的 index / pack.json。

### 5.5 `GET /api/v1/characters/{slug}/emojis` 与 tag 筛选

**查询参数**：`page`、`pageSize`、`animated`（bool）、`packKey`（可选二次过滤）。

**响应 200**

```json
{
  "character": "aimisi",
  "total": 1640,
  "page": 1,
  "pageSize": 100,
  "items": [
    {
      "id": "r-004f6e026159c811fb50",
      "packKey": "aimisi-xinjilemu-outfit-1",
      "format": "gif",
      "bytes": 352695,
      "animated": true,
      "previewUrl": "/api/v1/emojis/r-004f6e026159c811fb50/preview",
      "downloadUrl": "/api/v1/emojis/r-004f6e026159c811fb50/download"
    }
  ]
}
```

实现：读 `meta/v1/index/by-character/{slug}.json` 后内存分页。  
按构建 tag：`GET /api/v1/index/tags/{slug}/emojis` → `index/by-tag/{slug}.json`。  
Halo 标签字典：`GET /api/v1/tags` → `tags.json`（注意与 by-tag 索引键空间不同）。

### 5.6 `GET /api/v1/emojis/{emojiId}`

从 `emojis.jsonl` 或运行时 KV/DB（由 jsonl 导入）查找。

**响应 200**

```json
{
  "id": "r-00084805ad87aaf5db16",
  "packKey": "jinhsi-taoyao-zhuozhuo",
  "format": "gif",
  "animated": true,
  "contentType": "image/gif",
  "bytes": 1013387,
  "objectKey": "assets/v1/packs/jinhsi-taoyao-zhuozhuo/emojis/r-00084805ad87aaf5db16.gif",
  "characters": [{ "slug": "jinhsi", "name": "今汐" }],
  "artists": [{ "slug": "wuxue", "name": "雾雪" }],
  "tags": ["jinhsi", "wuxue"],
  "previewUrl": "/api/v1/emojis/r-00084805ad87aaf5db16/preview",
  "downloadUrl": "/api/v1/emojis/r-00084805ad87aaf5db16/download"
}
```

### 5.7 预览与单文件下载

**`GET /api/v1/emojis/{emojiId}/preview`**

- 建议：`302` 到短期 R2 签名 URL，或 `200` 流式代理并设 `Cache-Control: public, max-age=86400`。  
- `Content-Type` 取自清单 `contentType` / 扩展名。  
- 可选查询：`w`（宽）、`format=webp`（若你接了图片变换；**当前 R2 布局未内置缩略图对象**）。

**`GET /api/v1/emojis/{emojiId}/download`**

- `Content-Disposition: attachment; filename="{emojiId}.{ext}"`  
- 同样走签名 URL 或代理。  
- 建议记录审计日志（个人站可省略）。

**响应示例（签名重定向）**

```http
HTTP/1.1 302 Found
Location: https://<your-r2-public-or-signed-host>/assets/v1/packs/jinhsi-taoyao-zhuozhuo/emojis/r-00084805ad87aaf5db16.gif?<signature>
Cache-Control: private, max-age=300
```

### 5.8 `GET /api/v1/packs/{packKey}/zip`

- 服务端按 `pack.json` 的 `emojis[].objectKey` 打包流式 ZIP（或返回预生成对象键，若你另存了 `assets/v1/packs/<packKey>/pack.zip`——**当前快照未预生成 ZIP**）。  
- 响应：`Content-Type: application/zip`，`Content-Disposition: attachment; filename="{packKey}.zip"`。  
- 大包注意超时与内存；优先流式 / 后台任务 + 轮询。

**建议 JSON 错误体（统一）**

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "pack not found: linglanhuajiang-charging-20261009"
  }
}
```

### 5.9 增量同步（客户端约定）

1. `GET /api/v1/sync/state`，比较本地缓存的 `builtAt`。  
2. 若变化：拉取 `packs.json` + 需要的 `index/*`；或只拉变更包（见第 6 节写入约定）。  
3. 资源 URL 始终经应用层签发，避免把桶永久公网 URL 写死在客户端。

---

## 6. CRUD / 增量更新约定

R2 本身是对象存储；「CRUD」指维护元数据与索引文件的写入约定。推荐用脚本（参考 `build_r2_indexes.py` / `upload_r2.py`）批处理，而不是逐对象手改。

### 6.1 新增表情（单张）

1. 写入对象：`assets/v1/packs/<packKey>/emojis/<emojiId>.<ext>`。  
2. 追加一行到 `meta/v1/manifests/emojis.jsonl`（字段对齐第 4.3 节）。  
3. 更新 `assets/v1/packs/<packKey>/pack.json`：`emojis` 追加，`imageCountLocal += 1`。  
4. 更新索引：  
   - `index/by-pack/<packKey>.json`  
   - 每个角色 slug → `index/by-character/<slug>.json`  
   - 每个 tag 键 → `index/by-tag/<slug>.json`（若无则创建）  
5. 若新包：在 `packs.json` 的 `items` 增加条目，并确保 `total` / 可选 `sumImageCount*` 语义清晰（建议区分「源站宣称」与「本地入库」）。  
6. 更新 `sync/v1/state.json`：`builtAt`、 `catalog.emojiCount`、`catalog.bytesTotal` 等。

### 6.2 新增整包

1. 创建 `assets/v1/packs/<packKey>/`，上传全部 `emojis/*` + `pack.json`。  
2. 批量追加 jsonl；写 `index/by-pack/<packKey>.json`。  
3. 合并角色 / tag 索引（注意大文件读写：先读改再整体 put）。  
4. 更新 `packs.json`、`characters.json` / `artists.json` 的 `packCount`（若维护）。  
5.  bump `sync/v1/state.json`。

### 6.3 修改元数据（标题、角色、标签）

1. 改 `packs.json` 对应 item 与 `pack.json` 头字段。  
2. 若角色 / tags 变更：从旧索引数组移除 emoji 条目，写入新索引；同步改 jsonl 中该 `id` 行（jsonl 无原地改 → 需重写文件或维护旁路 DB）。  
3.  bump sync state。

### 6.4 删除表情 / 整包

1. Delete R2 对象 `assets/.../emojis/<id>.<ext>`（整包则删前缀）。  
2. 从 `pack.json`、`by-pack`、相关 `by-character` / `by-tag` 移除。  
3. 重写或压缩 `emojis.jsonl`（删除对应行）。  
4. 整包删除时：删 `index/by-pack/<packKey>.json`，并从 `packs.json` 移除；asset 前缀生命周期清理。  
5. 更新 `catalog.*` 与 `builtAt`。

### 6.5 并发与一致性

- 把 `emojis.jsonl` + 全量 index 视为**同一世代**：用 `sync/v1/state.json` 的 `builtAt` 做世代号。  
- 写入顺序建议：assets → pack.json → indexes → packs.json → manifests → **最后** state.json。  
- 客户端若发现 index 与 state 世代不一致，应重拉。  
- 大 index（如 `aimisi` 角色 1640 条）避免频繁局部 patch；可本地合并后一次性 `PutObject`。

### 6.6 从源站刷新

1. 复用公开 GET（`endpoints.json` → `public_ok`），限速约 1 req/s。  
2. 图片仅通过官方自助通道补洞；毒槽记入 skipped 列表，勿死循环重试。  
3. 重新跑 index 构建与上传；保留密钥于环境变量。

---

## 7. 本地对照路径与统计数字

### 7.1 本地路径地图

| 路径 | 含义 |
|------|------|
| `/workspace/wuwa-emoji/README.md` | 元数据快照说明 |
| `/workspace/wuwa-emoji/IMAGES_README.md` | 下载结果与许可 |
| `/workspace/wuwa-emoji/endpoints.json` | 源站接口探活 |
| `/workspace/wuwa-emoji/packs.json` 等 | 原始元数据 |
| `/workspace/wuwa-emoji/images/<packKey>/<emojiId>.<ext>` | 本地下载原图 |
| `/workspace/wuwa-emoji/images_manifest.jsonl` | 下载清单 |
| `/workspace/wuwa-emoji/download_skipped_slots.jsonl` | 16 个坏槽 |
| `/workspace/wuwa-emoji/r2_stage/` | R2 上传暂存（权威布局） |
| `/workspace/wuwa-emoji/r2_stage/meta/v1/` | 将上传的 meta |
| `/workspace/wuwa-emoji/r2_stage/assets/v1/packs/` | 将上传的资源（309 包） |
| `/workspace/wuwa-emoji/r2_stage/sync/v1/state.json` | 同步状态（本地无顶层 `sync/`） |
| `/workspace/wuwa-emoji/upload_report.json` | 上传报告 |
| `/workspace/wuwa-emoji/docs/DEVELOPMENT.md` | 本文 |

### 7.2 关键数字一览（Asia/Shanghai）

| 项 | 值 |
|----|-----|
| 元数据采集 | 2026-10-20 |
| 下载开始 | 2026-10-20T08:44:06+08:00 |
| 下载完成更新 | 2026-10-20T10:33:36+08:00 |
| index 构建 | 2026-10-20T10:33:57+08:00 |
| R2 上传完成 | 2026-10-20T10:45:39+08:00 |
| packs（源站） | 310 |
| packs（有资源/索引） | 309 |
| tags（Halo） | 115 |
| characters（推导） | 70（index 角色键 69） |
| artists（推导） | 12 |
| facets 画师维 | 27 |
| 表情成功入库 | **15272** |
| API 坏槽跳过 | **16** |
| 图片字节合计 | 15028946607 |
| by-tag 索引文件 | 96 |
| 无资源的 packs 条目 | `linglanhuajiang-charging-20261009` |

---

## 8. 安全：密钥不进仓库、R2 公私读建议

### 8.1 密钥管理

- **禁止**将 Access Key、Secret Key、API Token、`.api_token`、`.secrets/**` 提交到 Git 或写入文档 / Issue。  
- 本地已存在的密钥文件仅供本机脚本使用；`upload_report.json` 明确排除密钥上传。  
- CI / 服务器使用环境变量或 Secret Store，例如：  
  - `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`（S3 兼容）  
  - `R2_ACCOUNT_ID`、`R2_BUCKET=wuwa`  
  - 源站下载 token 单独变量，与 R2 凭证分离  
- 轮换密钥后旧密钥立即作废；日志中勿打印 Authorization 头。

### 8.2 R2 读权限建议

| 方案 | 适用 | 说明 |
|------|------|------|
| 桶保持**私有** + 应用签发短时 URL | **推荐**（默认） | Worker / 后端用 API Token 签 GET；预览 URL TTL 建议 5–15 分钟 |
| 仅 `meta/v1/**` 经 CDN 只读公开 | 可选 | 元数据可公开时降低源站压力；**assets 仍建议私有** |
| 整桶公开读 | **不推荐** | 便于盗链与违规再分发；与非商用许可冲突风险高 |

### 8.3 应用层加固

- 下载 / ZIP 接口做鉴权、配额与速率限制（对齐源站「额度」思路）。  
- 校验 `packKey` / `emojiId` 字符集（建议 `^[a-zA-Z0-9._-]+$`），防止路径穿越。  
- 不要把账户级 S3 端点与密钥下发给浏览器；浏览器只拿你的 `/api/v1/...` 或短时签名 URL。  
- 对外产品上线前完成版权与站方授权评估。

---

## 附录 A · 建议接口速查（OpenAPI 风草图）

```yaml
# 建议契约草稿 —— 非线上规范
openapi: 3.0.3
info:
  title: WuWa Emoji App API (Proposed)
  version: 0.1.0
  description: |
    基于 R2 桶 wuwa 布局 v1 的应用层建议接口。
    不表示该服务已部署。
servers:
  - url: https://{your-host}/api/v1
paths:
  /sync/state:
    get:
      summary: 同步水位
      responses:
        "200":
          description: state.json 子集
  /packs:
    get:
      summary: 包列表
      parameters:
        - in: query
          name: character
          schema: { type: string }
        - in: query
          name: tag
          schema: { type: string }
        - in: query
          name: page
          schema: { type: integer, default: 1 }
        - in: query
          name: pageSize
          schema: { type: integer, default: 50 }
      responses:
        "200": { description: 分页包列表 }
  /packs/{packKey}:
    get:
      summary: 包详情
      parameters:
        - in: path
          name: packKey
          required: true
          schema: { type: string }
      responses:
        "200": { description: pack.json 映射 }
        "404": { description: 不存在 }
  /packs/{packKey}/zip:
    get:
      summary: 整包 ZIP（建议）
      responses:
        "200":
          description: application/zip
          content:
            application/zip:
              schema: { type: string, format: binary }
  /emojis/{emojiId}:
    get:
      summary: 表情详情
      parameters:
        - in: path
          name: emojiId
          required: true
          schema: { type: string }
      responses:
        "200": { description: 清单行映射 }
  /emojis/{emojiId}/preview:
    get:
      summary: 预览（302 签名或 200 代理）
      responses:
        "302": { description: 短时 URL }
        "200": { description: 图像字节 }
  /emojis/{emojiId}/download:
    get:
      summary: 单文件附件下载
      responses:
        "200": { description: 图像字节 attachment }
  /characters/{slug}/emojis:
    get:
      summary: 按角色筛表情
      parameters:
        - in: path
          name: slug
          required: true
          schema: { type: string }
      responses:
        "200": { description: index/by-character }
  /index/tags/{slug}/emojis:
    get:
      summary: 按构建 tag 索引筛表情
      responses:
        "200": { description: index/by-tag }
  /tags:
    get:
      summary: Halo 标签字典
      responses:
        "200": { description: tags.json }
  /facets:
    get:
      summary: 分面
      responses:
        "200": { description: facets.json }
```

---

## 附录 B · 对象键速记

```text
meta/v1/packs.json
meta/v1/tags.json
meta/v1/characters.json
meta/v1/artists.json
meta/v1/facets.json
meta/v1/endpoints.json
meta/v1/README.md
meta/v1/manifests/emojis.jsonl
meta/v1/index/by-pack/<packKey>.json
meta/v1/index/by-character/<slug>.json
meta/v1/index/by-tag/<slug>.json
assets/v1/packs/<packKey>/pack.json
assets/v1/packs/<packKey>/emojis/<emojiId>.<ext>
sync/v1/state.json
```

---

*文档根据本地快照与 `r2_stage/` 实文件生成；若重建索引，请以新的 `sync/v1/state.json` 与 `upload_report.json` 为准更新第 7 节数字。*
