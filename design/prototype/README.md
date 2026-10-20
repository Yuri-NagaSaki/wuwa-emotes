# 潮池 UI 设计稿 · 源码

交互式设计稿的源码：设计系统、22 个公开页、16 个后台页，桌面与手机两种尺寸。发布版本：

- Artifact：<https://claude.ai/artifact/HPYzpgN3CHCHeBTjDCietY>
- R2 归档：`design/v1/tidepool-ui/index.html`（含 `img/`）

## 目录

| 文件 | 内容 |
|---|---|
| `src/config.js` | 站点名称与三种角色。改名只改这里（生产环境对应 `SITE_NAME` 环境变量与系统设置） |
| `src/tp-*.css` | 产品样式：令牌、组件、页面、后台；`tp-v3.css` 是本轮新增（筛选条、单张弹窗、打包清单、投稿、审核、滚动条） |
| `src/board.css`、`src/board.js`、`src/body.html` | 设计稿画板（页面索引、设备框、设计说明、演示状态） |
| `src/ui.js` | 组件渲染函数 |
| `src/pages-*.js` | 各页面与设计说明 |
| `src/mock.js` | 示例数据（评论、用户、投稿、任务等均为示例） |
| `data.js` | 从 R2 `meta/v1` 生成的真实目录子集 |
| `../tokens.css` | 导出的设计令牌 |

## 构建

1. 从 R2 下载 `design/v1/tidepool-ui/img/` 到 `design/prototype/img/`。
2. 可选：生成标题字体子集 `src/font.css`。缺少时标题回退到 Nunito 与系统字体。
3. 运行 `node build.js`，输出 `tidepool-ui.html`（Artifact 页面）与 `_preview.html`（本地预览）。

### 标题字体子集

标题字体是寒蝉圆黑体（ChillRoundGothic，OFL-1.1），按 OFL 要求以别名 `TP Rounded` 发布。子集化时必须去掉 `locl`：上游字体的 `locl` 对所有语言都生效，会把「户」「令」和数字换成日文字形。

```sh
pyftsubset ChillRoundGothic_Heavy.otf --text-file=display-subset.txt --flavor=woff2 \
  --output-file=tp-rounded-Heavy.woff2 --no-hinting --desubroutinize --name-IDs='*' \
  --layout-features='ccmp,liga,frac,sups,ordn,palt,halt,vert,vhal,vpal,fwid,hwid,pwid'
```

`display-subset.txt` 是所有页面、弹层和演示状态里用标题字体渲染的字符，加上 ASCII 与常用中文标点。新增标题文字后要重新收集，否则缺字会回退到系统字体，同一行标题出现两种字形。

### 动图预览

`img/*.anim.webp` 是动画 WebP。用 sharp 抽帧时，`webp()` 没有 `pageHeight` 参数，传了也会被忽略，输出变成一张竖长的静态图。正确做法：先把抽出的帧拼成长条并缩放，再用 `raw: { width, height, channels, pageHeight }` 重新包装后编码。

示例表情图片版权归原画师与官方所有，仅用于设计评审，不要提交到仓库或公开分发。
