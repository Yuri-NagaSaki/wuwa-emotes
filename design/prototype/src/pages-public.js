// ---------- public pages ----------
const PAGES = [];
const byDate = PACKS.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
const officials = PACKS.filter((p) => p.official);
const topChars = CHARS.filter((c) => c.avatar).slice(0, 16);

PAGES.push({ id: 'home', group: 'pub', title: '首页', route: '/', fid: 'hi',
  render(ctx) {
    const feat = [PACKS[0]].concat(PACKS.filter((p) => p.pin > 0 && p !== PACKS[0])).concat(PACKS.slice(1, 6)).filter((p, i, a) => a.indexOf(p) === i).slice(0, 5);
    const offs = officials.concat(PACKS.filter((p) => !p.official)).slice(0, 4);
    const stream = POOL.filter((x, i) => i % 3 === 0).slice(0, 18);
    const hero = '<section class="hero"><div class="wrap"><div>' +
      '<span class="eyebrow">Wuthering Waves Stickers</span>' +
      '<h1 style="margin-top:10px">退潮后，<br>捡一枚<em>表情</em></h1>' +
      '<p class="lede">' + DATA.stats.packs + ' 个表情包、' + fmtN(DATA.stats.emojis) + ' 张表情，覆盖 69 位角色。单张复制、跨包打包、整包下载，都在这里。</p>' +
      '<div class="hero-search"><div class="input" data-act="cmdk">' + ic('search') + '<input id="hero-q-' + ctx.f + '" placeholder="试试「爱弥斯 捏捏」或「板牌」" readonly></div>' + btn('搜索', { cls: 'primary', act: 'cmdk' }) + '</div>' +
      '<div class="hero-hot"><span>大家在搜</span>' + ['爱弥斯', '达妮娅', '菲比', '捏捏', '板牌', '静态'].map((t) => chip(t, { sm: true, act: 'cmdk' })).join('') + '</div>' +
      stats([[fmtN(DATA.stats.emojis), '张表情'], [DATA.stats.packs, '个表情包'], ['69', '位角色'], [fmtW(DATA.stats.downloads), '次下载']]) +
      '</div>' + poolArt([AV('爱弥斯'), AV('达妮娅'), AV('菲比'), AV('心'), AV('卡提希娅'), AV('守岸人')]) + '</div></section>';
    const strip = '<section class="sec"><div class="wrap">' + secHead('角色潮汐', { more: ['全部 69 位', 'characters'], sub: '按表情数量排序' }) + '<div class="cstrip">' + topChars.map(charChip).join('') + '</div></div></section>';
    const featured = '<section class="sec"><div class="wrap">' + secHead('站长精选', { cls: 'sun', more: ['精选合集', 'collections'] }) + '<div class="feat">' + feat.map((p, i) => packCard(p, i, { variant: i === 0 ? 'four' : 'one', noEx: i !== 0 })).join('') + '</div></div></section>';
    const newest = '<section class="sec"><div class="wrap">' + secHead('新上架', { cls: 'pink', more: ['全部表情包', 'packs'], sub: '近 7 天新增 18 个包' }) + '<div class="masonry" data-masonry>' + byDate.slice(0, 8).map((p, i) => packCard(p, i, { isNew: i < 3 })).join('') + '</div></div></section>';
    const flow = '<section class="sec"><div class="wrap">' + secHead('潮汐流', { cls: 'mint', sub: '随机冲上岸的表情，悬停播放' }) + '<div class="grid-tiles t120">' + stream.map((x, i) => tile(x, i, { act: 'lightbox', big: i === 0 || i === 9, favs: ctx.S.favs, alt: x.t })).join('') + '</div><div class="stream-cta">' + btn('进入潮汐画廊', { go: 'gallery', icon: 'wave' }) + '</div></div></section>';
    const off = '<section class="sec"><div class="wrap">' + secHead('官方表情', { cls: 'deep', sub: '转载自鸣潮官方，本站只做整理' }) + '<div class="official-row">' + offs.map((p) => '<a class="ocard" href="#" data-go="pack:' + p.key + '"><img src="' + IMG(p.cover) + '" alt="" loading="lazy"><div><b>' + esc(p.title.replace('【官转】', '')) + '</b><small>' + p.count + ' 张 · ' + fmtW(p.dl) + ' 下载</small></div></a>').join('') + '</div></div></section>';
    return shell(ctx, 'home', hero + strip + featured + newest + flow + off);
  },
  notes: {
    goal: '3 秒内让人找到一张能用的表情：搜索、角色、精选三个入口同屏，取代源站首页的视频墙和欢迎弹窗。',
    parts: ['主视觉「潮池」：表情漂在潮池里，SVG 涟漪 + CSS 漂浮动画，不加载视频', '角色潮汐：横向滚动的角色头像条，头像用该角色最热的表情', '站长精选：首张大卡 + 4 张卡；新上架：卡片瀑布流', '潮汐流：静态海报方格，悬停才换成动图预览'],
    motion: ['涟漪 4.8 秒一圈，三圈错峰；漂浮表情 5 秒上下浮动', '卡片入场只做 14px 上浮，不做透明度渐入，首帧内容完整', '「prefers-reduced-motion」下全部动画停止'],
    data: ['GET /api/home：精选、最新、角色排行合并为一个请求，Cloudflare 边缘缓存 60 秒', '统计数字取自 catalog 汇总表，后台写入时刷新'],
    perf: ['首屏只有静态 WebP 海报，每张 8–16 KB；动图预览在悬停时按需加载', '主视觉为内联 SVG，没有大图和视频', 'LCP 目标：标题文本，2.5 秒以内'],
    mobile: ['主视觉压缩成横条放在标题上方，搜索框全宽', '精选改为横向滑动卡片，底部 5 个标签导航', '打包清单有内容时出现悬浮按钮']
  },
  demos: [['打开搜索面板', 'cmdk'], ['打开打包清单', 'bottle'], ['切换夜潮主题', 'night']]
});

PAGES.push({ id: 'packs', group: 'pub', title: '表情包目录', route: '/packs', fid: 'hi',
  render(ctx) {
    const F = ctx.F; const on = F.fchars || ['爱弥斯'];
    const list = PACKS.slice().sort((a, b) => (F.sort === 'new' ? (a.date < b.date ? 1 : -1) : F.sort === 'fav' ? b.fav - a.fav : b.dl - a.dl));
    const facets = [['char', '角色', on.join('、')], ['artist', '画师', ''], ['type', '类型', ''], ['source', '来源', ''], ['group', '分组', '']];
    const fbtn = (f) => '<button class="fchip' + (f[2] ? ' is-set' : '') + (F.fpop === f[0] ? ' is-open' : '') + '" data-act="fpop" data-v="' + f[0] + '">' + f[1] + (f[2] ? '<b>' + esc(f[2]) + '</b>' : '') + ic('down', 'sm') + '</button>';
    const pops = {
      char: '<div class="fpop-h">' + input('输入角色名或拼音', { icon: 'search', cls: 'sm', id: 'fp-c-' + ctx.f }) + '<div class="alpha">' + 'ABCDFGJKLMQSXYZ'.split('').map((l, i) => '<button class="' + (i === 0 ? 'is-on' : '') + '">' + l + '</button>').join('') + '</div></div>' +
        '<div class="fpop-grid c5">' + CHARS.filter((c) => c.avatar).slice(0, 30).map((c) => chip(c.name, { sm: true, av: c.avatar, cc: c.color, on: on.includes(c.name), n: c.packs, act: 'fchar', attr: ' data-v="' + esc(c.name) + '"' })).join('') + '</div><div class="fpop-f"><span>常用 30 位 · 共 69 位，输入可搜索全部</span><button class="btn xs" data-act="fpop" data-v="">完成</button></div>',
      artist: '<div class="fpop-grid c3">' + DATA.artists.map((a) => chip(a.name.trim(), { sm: true, n: a.packs })).join('') + '</div><div class="fpop-f"><span>27 位画师，按包数排序</span><button class="btn xs" data-act="fpop" data-v="">完成</button></div>',
      type: '<div class="fpop-grid c3">' + chip('全部', { sm: true, on: true }) + chip('动态', { sm: true, n: 225 }) + chip('静态', { sm: true, n: 85 }) + '</div>',
      source: '<div class="fpop-grid c3">' + chip('全部', { sm: true, on: true }) + chip('社区投稿', { sm: true, n: 269 }) + chip('官方转载', { sm: true, n: 40 }) + '</div>',
      group: '<div class="fpop-grid c3">' + chip('站长推荐', { sm: true, n: 103 }) + chip('表情图鉴', { sm: true, n: 15 }) + chip('EmoteLab', { sm: true, n: 40 }) + chip('Solar5', { sm: true, n: 5 }) + '</div>'
    };
    const bar = '<div class="filterbar"><div class="fb-row">' + input('搜索包名、角色或画师', { icon: 'search', cls: 'sm fb-search', id: 'fb-q-' + ctx.f }) +
      '<div class="fb-facets">' + facets.map(fbtn).join('') + '</div><span class="grow"></span>' + seg([['hot', '最热'], ['new', '最新'], ['fav', '收藏最多'], ['rand', '随机']], F.sort || 'hot', 'sort', 'sm') + '</div>' +
      (F.fpop && pops[F.fpop] ? '<div class="fpop fpop-' + F.fpop + '">' + pops[F.fpop] + '</div>' : '') +
      '<div class="active-filters">' + (on.length ? '筛选中：' + on.map((n) => chip(n, { sm: true, on: true, x: true, act: 'fchar', attr: ' data-v="' + esc(n) + '"' })).join('') + '<a href="#" data-act="fclear" style="color:var(--tp-teal-ink)">清除全部</a>' : '<span>全部 309 个表情包</span>') + '</div></div>';
    return shell(ctx, 'packs', '<div class="wrap"><div class="page-h"><div class="crumbs"><a href="#" data-go="home">首页</a>' + ic('right') + '<span>表情包</span></div><h1>表情包</h1><div class="row"><span class="sub">共 309 个 · 官方转载 40 个</span></div></div>' +
      bar + '<div class="masonry" data-masonry>' + list.slice(0, 16).map((p, i) => packCard(p, i)).join('') + '</div>' +
      '<div class="loadmore"><div class="wave-loader"><i></i><i></i><i></i><i></i><i></i></div>继续下滑加载，已显示 16 / 309</div></div>');
  },
  notes: {
    goal: '取代源站 21 页的单列列表：卡片瀑布流浏览，顶部筛选条缩小范围，无限加载不翻页。',
    parts: ['顶部筛选条：搜索 + 角色、画师、类型、来源、分组五个下拉面板 + 排序；不再使用带边框、内部滚动的侧栏', '下拉面板按内容定高，不出现滚动条：角色面板列出常用 30 位，其余靠输入搜索', '已选条件以胶囊展示，可单个移除；瀑布流占满全宽，桌面 4 列'],
    motion: ['面板展开 0.25 秒弹出', '卡片按序 45ms 错峰上浮', '筛选变化时用 View Transitions 交叉过渡'],
    data: ['GET /api/packs?character=&artist=&type=&source=&group=&sort=&cursor=：游标分页，每页 24', '筛选条件写入 URL 查询参数，可分享、可回退'],
    perf: ['瀑布流用 TanStack Virtual 的 lanes 布局，只渲染视口附近的卡片', '卡片封面宽高存在库里，布局零偏移'],
    mobile: ['筛选按钮打开底部面板，筛选胶囊可横滑（隐藏滚动条）', '两列瀑布流，卡片隐藏署名行']
  },
  demos: [['展开角色筛选面板', 'fpop-char'], ['展开画师筛选面板', 'fpop-artist'], ['打开筛选抽屉（手机）', 'filter-sheet']]
});

PAGES.push({ id: 'pack', group: 'pub', title: '表情包详情', route: '/packs/aimisi-01', fid: 'hi',
  render(ctx) {
    const F = ctx.F, d = DETAIL, pv = !!ctx.S.previewOnly;
    const sel = F.sel || new Set();
    const head = '<div class="wrap"><div class="crumbs" style="margin-top:18px"><a href="#" data-go="packs">表情包</a>' + ic('right') + '<a href="#" data-go="char:爱弥斯">爱弥斯</a>' + ic('right') + '<span>' + esc(d.title) + '</span></div>' +
      '<div class="pack-h" style="--acc:var(--c-pink)"><div class="pack-cover"><img src="' + IMG(d.emojis[0].img) + '" data-anim="' + IMG(d.emojis[0].anim) + '" width="240" height="240" alt="封面"><b class="flag pin">表情图鉴</b></div>' +
      '<div class="pack-info"><h1>' + esc(d.title) + '</h1>' +
      '<div class="pack-meta"><span class="pill-stat">' + ic('image', 'sm') + d.count + ' 张动态</span><span class="pill-stat">' + ic('box', 'sm') + fmtB(d.bytesTotal) + '</span><span class="pill-stat">' + ic('cal', 'sm') + d.date + '</span><span class="pill-stat">' + ic('download', 'sm') + fmtN(d.dl) + '</span><span class="pill-stat">' + ic('eye', 'sm') + fmtN(d.reads) + '</span></div>' +
      '<p class="pack-ex">' + esc(d.excerpt) + '</p>' +
      '<div class="chips pack-chips">' + tag('角色 · 爱弥斯', 'var(--c-pink)') + tag('画师 · ' + esc(d.artists[0] || ''), 'var(--c-purple)') + tag('分组 · ' + esc(d.group || '表情图鉴'), 'var(--c-yellow)') + tag('动态表情', 'var(--c-mint)') + '</div>' +
      (pv ? '<div class="note-box warn" style="max-width:640px">' + ic('lock', 'sm') + '<span>这个包<b>只提供预览</b>（例如官方转载，或作者要求不开放下载）：可以浏览、收藏和评论，不提供原图与打包。</span></div>' : '') + '<div class="pack-acts">' + (pv ? btn('只提供预览', { icon: 'lock', attr: ' disabled' }) : btn('打包下载 ZIP', { cls: 'primary', icon: 'box', act: 'zip-pack' }) + btn('全部加入打包', { cls: 'sun hide-sm', icon: 'bottle', act: 'add-all' })) + btn(ctx.S.favs.has('pack') ? '已收藏' : '收藏', { cls: ctx.S.favs.has('pack') ? 'is-fav' : '', icon: 'heart', act: 'fav-pack' }) + btn('', { icon: 'share', act: 'share', attr: ' aria-label="分享"' }) + '</div>' +
      '<dl class="credit-card"><dt>许可</dt><dd class="lic"><span class="cc-badge">CC BY-NC-SA 4.0</span>' + (pv ? '版权方未开放再分发' : '署名 · 非商业 · 相同方式共享') + '</dd><dt>画师</dt><dd>' + esc(d.artists[0] || '') + '</dd><dt>约稿</dt><dd>群聊「爱弥一生一世」</dd><dt>投稿</dt><dd>示例投稿者 · 2026-08-06 审核通过</dd><dt>下载</dt><dd>' + (pv ? '<span class="flag static">仅预览</span> 不提供原图与打包' : '无需登录，单张或整包都可直接下载') + '</dd><dt>下载包含</dt><dd>原图 25 张 + CREDITS.txt（署名与许可原文）</dd></dl></div></div></div>';
    const tools = '<div class="sticky-tools"><div class="wrap"><span class="count">' + d.count + ' 张<small>' + (sel.size ? '已选 ' + sel.size : '点按查看大图') + '</small></span><span style="flex:1"></span>' +
      '<span class="hide-sm">' + seg([['def', '默认'], ['hot', '最热'], ['new', '最新']], 'def', 'noop', 'sm') + '</span>' + sw('自动播放', !!F.autoplay, 'autoplay') + btn(F.selecting ? '完成' : '多选', { cls: 'sm' + (F.selecting ? ' is-on' : ''), icon: F.selecting ? 'check' : 'grid', act: 'selmode' }) + '</div></div>';
    const grid = '<div class="wrap"><div class="grid-tiles' + (F.selecting ? ' is-selecting' : '') + (pv ? ' is-preview' : '') + ' t150">' + d.emojis.map((e, i) => tile(e, i, { act: F.selecting ? 'toggle' : 'lightbox', sel, favs: ctx.S.favs, alt: '爱弥斯表情 ' + (i + 1) })).join('') + '</div></div>';
    const rel = PACKS.filter((p) => p.chars.includes('爱弥斯') && p.key !== 'aimisi-01').concat(PACKS.slice(1)).slice(0, 4);
    const after = '<div class="wrap"><div class="split" style="margin-top:36px"><div>' + commentsSection(ctx) + '</div><aside style="display:grid;gap:22px;margin-top:48px">' +
      '<div class="card"><h3 style="font-size:16px;margin-bottom:10px">众筹名单 <span class="hint">（示例）</span></h3><div class="crowd">' + CROWD.map((n) => '<span>' + n + '</span>').join('') + '</div></div>' +
      '<div class="pn"><a href="#" data-go="pack"><small>' + ic('left', 'sm') + '上一组</small><b>猫耳爱弥斯动态表情包（板牌）</b></a><a href="#" data-go="pack"><small>下一组' + ic('right', 'sm') + '</small><b>儿童节小小爱动态表情包（鸭牌）</b></a></div>' +
      '<div><h3 style="font-size:16px;margin-bottom:12px">同角色的其他包</h3><div style="display:grid;gap:12px">' + rel.slice(0, 3).map((p, i) => packCard(p, i, { variant: 'one', noEx: true })).join('') + '</div></div></aside></div></div>';
    if (F.selecting && sel.size) ctx.layer.push('<div class="sel-bar"><span>已选 <b>' + sel.size + '</b> 张</span>' + btn('加入打包', { cls: 'sun sm', icon: 'bottle', act: 'add-sel' }) + btn('打包所选', { cls: 'sm hide-sm', icon: 'box', act: 'bottle' }) + btn('取消', { cls: 'ghost sm', act: 'selmode', attr: ' style="color:#cfe9e4"' }) + '</div>');
    ctx.layer.push('<div class="mob-actbar">' + (pv ? btn('只提供预览', { cls: 'block', icon: 'lock', attr: ' disabled' }) : btn('打包下载 25 张', { cls: 'primary', icon: 'box', act: 'zip-pack' }) + btn('', { icon: 'bottle', act: 'add-all', attr: ' aria-label="全部加入打包"' })) + btn('', { icon: 'heart', act: 'fav-pack', attr: ' aria-label="收藏"', cls: ctx.S.favs.has('pack') ? 'is-fav' : '' }) + '</div>');
    return shell(ctx, 'packs', head + tools + grid + after);
  },
  notes: {
    goal: '这一页承担下载：看、挑、复制、打包。源站的点赞数、阅读数让位给图片本身；署名和许可放在首屏。',
    parts: ['封面倾斜 2°，下方 8px 实色投影，呼应组件库的 3D 按钮', '署名卡：许可、画师、约稿、ZIP 内容，ZIP 内附 CREDITS.txt', '方格网格：表情 97.6% 为正方形，用等宽方格而不是瀑布流', '多选模式：勾选后底部浮出操作条；单张弹窗支持键盘左右切换', '评论区：Garrul 式楼中楼 + 贴纸 + 表情回应（回应按钮本身就是站内表情）'],
    motion: ['按下方块时「捏一捏」：0.48 秒弹性压缩回弹', '加入打包：缩略图沿弧线飞入右上角「打包」按钮，计数弹跳一下', '单张弹窗用 spring 曲线弹出'],
    data: ['GET /api/packs/:slug：包信息 + 表情列表（宽高、帧数、字节数、衍生图地址）', '下载不设额度、不需登录：/dl/e/:id 与 /dl/p/:slug.zip 直接 302 到 R2 签名地址；ZIP 未生成时排队，前端轮询', '每个包一个「允许下载」开关（packs.downloadable）：社区 CC 授权包默认开，官方转载默认只提供预览', '评论：GET/POST /api/comments?thread=pack:aimisi-01'],
    perf: ['网格只加载静态海报，开启「自动播放」后才把视口内的方块换成动图预览', '下载走 R2 签名直链，大文件不经过应用服务器', '评论区在滚动到附近时才请求（IntersectionObserver）'],
    mobile: ['封面缩小到 112px，与标题并排；操作按钮移到底部固定栏', '方格 3 列；长按方块弹出保存、复制、加入打包菜单', '微信内置浏览器检测：ZIP 改为提示「在浏览器打开」，单张提示长按保存']
  },
  demos: [['打开单张弹窗', 'lightbox'], ['进入多选并选 6 张', 'demo-select'], ['打开贴纸选择器', 'picker'], ['打开打包清单', 'bottle'], ['整包下载弹窗', 'zip-pack'], ['只提供预览的包（官方转载）', 'preview-only']]
});

PAGES.push({ id: 'emoji', group: 'pub', title: '单张表情（弹窗）', route: '/e/r-0a7bf47f0ec26d3843bf', fid: 'hi', autoOv: { ov: 'lightbox', lb: 4 },
  render(ctx) { return pageById('pack').render(ctx); },
  notes: {
    goal: '单张表情不再做整页：表情只有 300 px，整页会留下大片空白。在包详情页上打开一个贴合内容的弹窗，看图、复制、下载都在一屏内完成。',
    parts: ['左侧按原尺寸显示 WebP（不放大，避免发虚），右侧信息与 6 个操作：复制图片、保存原图、查看原图、收藏、加入打包、复制链接；「查看原图」才加载 GIF 原图', '底部同包缩略图条，点选即切换；左右箭头翻页', '首页潮汐流、画廊、搜索、角色页、「随机来一张」都打开同一个弹窗'],
    motion: ['弹窗 spring 弹出；切换表情时图片原地淡入', '键盘：← → 切换，Esc 关闭'],
    data: ['深链 /e/:id：服务端渲染所在包的详情页，并带上打开状态的弹窗（便于分享与收录，og:image 用 p240）', '站内打开时用 pushState 把地址改为 /e/:id；关闭时回到包地址；浏览器「后退」等同关闭'],
    perf: ['弹窗只请求 a160 预览；full 档首次查看时生成，生成前继续显示 a160'],
    mobile: ['底部面板，最高占屏幕 72%，可下滑关闭', '左右滑动切换；操作改为 3×2 图标按钮']
  },
  demos: [['切到下一张', 'lb-next'], ['只提供预览的包', 'preview-only']]
});

PAGES.push({ id: 'gallery', group: 'pub', title: '潮汐画廊', route: '/gallery', fid: 'hi',
  render(ctx) {
    const F = ctx.F, pool = POOL.slice().sort((a, b) => ((a.img.length * 7 + (F.seed || 1) * 13) % 17) - ((b.img.length * 7 + (F.seed || 1) * 13) % 17));
    const items = [];
    pool.slice(0, 44).forEach((x, i) => {
      if (i === 6) items.push(packCard(PACKS[2], 0, { variant: 'four', noEx: true }));
      if (i === 15) items.push('<div class="note-card"><small>潮汐小记</small><b>今天冲上岸 27 张新表情，来自「全角色琵琶曲 v2.0」</b><a href="#" data-go="pack" style="color:#8ee6d7;font-weight:800">去看看 →</a></div>');
      if (i === 26) items.push(packCard(PACKS[5], 1, { variant: 'lead', noEx: true }));
      items.push(tile(x, i, { big: i % 11 === 3, favs: ctx.S.favs, alt: x.t }));
    });
    return shell(ctx, 'gallery', '<div class="wrap"><div class="page-h"><h1>潮汐画廊</h1><span class="sub">无尽滚动的随机表情。悬停播放，点按查看来源。</span></div>' +
      '<div class="gal-tools"><div class="chips">' + chip('全部角色', { sm: true, on: true }) + topChars.slice(0, 7).map((c) => chip(c.name, { sm: true, av: c.avatar, cc: c.color })).join('') + '</div>' + seg([['all', '全部'], ['anim', '动态'], ['still', '静态']], 'all', 'noop', 'sm') + btn('洗牌', { cls: 'sm sun', icon: 'shuffle', act: 'shuffle' }) + '</div>' +
      '<div class="stream">' + items.join('') + '</div><div class="loadmore"><div class="wave-loader"><i></i><i></i><i></i><i></i><i></i></div>潮水正在涌上来…</div></div>', { noFoot: false });
  },
  notes: {
    goal: '源站「无限画廊」的升级版：随机流里混入包卡片和小记，鼓励顺着一张表情找到整个包。',
    parts: ['方格流 + 2×2 聚焦方块（grid-auto-flow: dense）', '每隔约 10 格插入包卡片或「潮汐小记」', '「洗牌」按种子重排，结果可分享（URL 带 seed）'],
    motion: ['洗牌时方块整体下沉再浮起，像一次退潮涨潮', '视口内最多同时播放 4 张动图，其余保持海报'],
    data: ['GET /api/stream?seed=&cursor=&character=&type=：服务端按种子稳定随机'],
    perf: ['虚拟滚动，DOM 中方块数量保持在 120 以内', '动图预览走 IntersectionObserver + 并发上限'],
    mobile: ['3 列方格，聚焦方块占 2×2，包卡片占满整行']
  },
  demos: [['洗牌', 'shuffle'], ['打开单张弹窗', 'lightbox']]
});

PAGES.push({ id: 'characters', group: 'pub', title: '角色图鉴', route: '/characters', fid: 'hi',
  render(ctx) {
    return shell(ctx, 'characters', '<div class="wrap"><div class="page-h"><h1>角色图鉴</h1><div class="row"><span class="sub">69 位角色，按表情数量排序。头像是该角色最热的一张表情。</span></div></div>' +
      '<div class="toolbar" style="margin-top:14px">' + input('找角色：拼音或中文', { icon: 'search', cls: 'sm', id: 'ch-q-' + ctx.f }) + seg([['count', '表情最多'], ['new', '最近更新'], ['az', '拼音']], 'count', 'noop', 'sm') + '<span class="grow"></span><div class="alpha">' + 'ABCDFGJKLMQSXYZ'.split('').map((l, i) => '<button class="' + (i === 0 ? 'is-on' : '') + '">' + l + '</button>').join('') + '</div></div>' +
      '<div class="cgrid">' + CHARS.filter((c) => c.avatar).map(charCard).join('') + CHARS.filter((c) => !c.avatar).slice(0, 6).map(charCard).join('') + '</div></div>');
  },
  notes: {
    goal: '源站角色页用官方立绘外链（库街区），加载 3 MB、阻塞 11.8 秒。新版用站内表情做头像，不依赖外部图片。',
    parts: ['角色卡：圆形「小潮池」+ 角色主题色波点底', '主题色存在 characters.theme_color，后台可改', '拼音首字母快速定位'],
    motion: ['悬停时头像倾斜 4° 并放大，spring 回弹'],
    data: ['GET /api/characters?sort=count|recent|pinyin', 'slug 一律用拼音，旧的 submission-term-… 地址 301 跳转'],
    perf: ['头像 160px 静态 WebP，约 5 KB/张，69 张合计约 350 KB 且懒加载'],
    mobile: ['3 列小卡片，隐藏字母索引']
  },
  demos: []
});

PAGES.push({ id: 'char', group: 'pub', title: '角色详情', route: '/characters/aimisi', fid: 'hi',
  render(ctx) {
    const name = ctx.params && ctx.params.char ? ctx.params.char : '爱弥斯';
    const c = CHAR_BY[name] || CHARS[0];
    const packs = PACKS.filter((p) => p.chars.includes(c.name));
    const list = (packs.length ? packs : []).concat(PACKS.filter((p) => !p.chars.includes(c.name))).slice(0, 9);
    const tab = ctx.F.ctab || 'packs';
    const tabs = '<div class="tabs" role="tablist" style="margin-top:22px">' + [['packs', '表情包', c.packs], ['all', '全部表情', fmtN(c.count)], ['artists', '画过 TA 的画师', 6]].map((t) => '<button role="tab" data-act="ctab" data-v="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + t[1] + '<span class="n">' + t[2] + '</span></button>').join('') + '</div>';
    const body = tab === 'all' ? '<div class="toolbar" style="margin-top:16px">' + seg([['all', '全部'], ['anim', '动态'], ['still', '静态']], 'all', 'noop', 'sm') + '</div><div class="grid-tiles">' + POOL.slice(0, 30).map((x, i) => tile(x, i, { favs: ctx.S.favs })).join('') + '</div>'
      : tab === 'artists' ? '<div class="links-grid" style="margin-top:18px">' + DATA.artists.slice(0, 6).map((a, i) => '<a class="lcard" href="#" data-go="artist" style="--acc:var(--c-' + PALETTE[i % 12] + ')"><span class="ico">' + esc(a.name.slice(0, 1)) + '</span><div><b>' + esc(a.name) + '</b><small>' + a.packs + ' 个包</small></div></a>').join('') + '</div>'
      : '<div class="masonry" data-masonry style="margin-top:18px">' + list.map((p, i) => packCard(p, i)).join('') + '</div>';
    return shell(ctx, 'characters', '<section class="char-hero" style="--cc:' + c.color + '"><div class="wrap"><span class="pool">' + (c.avatar ? '<img src="' + IMG(c.avatar) + '" width="160" height="160" alt="">' : '') + '</span>' +
      '<div><div class="crumbs"><a href="#" data-go="characters">角色图鉴</a>' + ic('right') + '<span>' + esc(c.name) + '</span></div><h1>' + esc(c.name) + '</h1><div class="alias">别名：小爱 · 爱弥一生一世 · <span class="mono">' + c.slug + '</span></div>' +
      stats([[fmtN(c.count), '张表情'], [c.packs, '个表情包'], [fmtW(c.dl), '次下载']]) + '</div>' +
      '<div class="acts">' + btn('随机来一张', { cls: 'sun', icon: 'dice', act: 'random' }) + btn('关注角色', { cls: 'sm', icon: 'bell', act: 'noop' }) + '</div></div></section>' +
      '<div class="wave-edge" aria-hidden="true"><svg viewBox="0 0 1200 26" preserveAspectRatio="none"><path d="M0 14 Q50 0 100 14 T200 14 T300 14 T400 14 T500 14 T600 14 T700 14 T800 14 T900 14 T1000 14 T1100 14 T1200 14 V26 H0z"/></svg></div>' +
      '<div class="wrap">' + tabs + body + '</div>');
  },
  notes: {
    goal: '角色是最主要的找图方式（爱弥斯一人 1,640 张）。页头整块换成角色主题色，进入不同角色有明显的「换场」。',
    parts: ['主题色页头 + 波浪下沿；头像带 3D 投影', '「随机来一张」：从该角色全部表情中抽一张，在单张弹窗里打开', '三个标签页：表情包（瀑布流）、全部表情（虚拟方格）、画师'],
    motion: ['切换角色时主题色 0.35 秒过渡', '标签下划线「叶片摆动」动画来自组件库 Tabs'],
    data: ['GET /api/characters/:slug、/packs、/emojis?type=&cursor=', '别名表 character_aliases 用于搜索与旧链接跳转'],
    perf: ['「全部表情」最多上千张，必须虚拟化，按需拉取'],
    mobile: ['页头头像 96px，统计数字缩小；「随机来一张」保留在页头']
  },
  demos: [['随机来一张', 'random'], ['切到全部表情', 'ctab-all'], ['换成达妮娅', 'char-daniya']]
});

PAGES.push({ id: 'artists', group: 'pub', title: '画师名录', route: '/artists', fid: 'std',
  render(ctx) {
    return shell(ctx, 'explore', '<div class="wrap"><div class="page-h"><h1>画师名录</h1><span class="sub">27 位画师与约稿作者。每个表情包都会署名，并链接到这里。</span></div>' +
      '<div class="links-grid" style="margin-top:18px">' + DATA.artists.map((a, i) => '<a class="lcard" href="#" data-go="artist" style="--acc:var(--c-' + PALETTE[i % 12] + ')"><span class="ico">' + esc(a.name.trim().slice(0, 1)) + '</span><div><b>' + esc(a.name.trim()) + '</b><small>' + a.packs + ' 个表情包</small></div></a>').join('') + '</div>' +
      '<div class="note-box" style="margin-top:20px">' + ic('info', 'sm') + '<span>画师数据由后台合并清洗：例如「春也 Huruya」与「春也 Haruya」合并为同一人，旧名保留为别名。</span></div></div>');
  },
  notes: { goal: '给画师稳定的署名页，回应 CC BY 的署名要求。', parts: ['首字头像卡片，后续可换成画师授权的头像', '画师主页链接（B 站、微博）由后台维护'], motion: ['卡片悬停上浮 2px'], data: ['GET /api/artists；artists.aliases 支持合并'], perf: ['纯文本卡片，无图片请求'], mobile: ['单列卡片'] }, demos: []
});

PAGES.push({ id: 'artist', group: 'pub', title: '画师主页', route: '/artists/wuxue', fid: 'std',
  render(ctx) {
    const a = DATA.artists[0];
    return shell(ctx, 'explore', '<section class="char-hero" style="--cc:var(--c-purple)"><div class="wrap"><span class="pool" style="font-family:var(--tp-font-display);font-size:72px;color:var(--tp-ink)">' + esc(a.name.slice(0, 1)) + '</span><div><div class="crumbs"><a href="#" data-go="artists">画师名录</a>' + ic('right') + '<span>' + esc(a.name) + '</span></div><h1>' + esc(a.name) + '</h1><div class="alias">画师 · 作品按 CC BY-NC-SA 4.0 授权本站发布</div>' + stats([[a.packs, '个表情包'], ['1,104', '张表情']]) + '</div>' +
      '<div class="acts">' + btn('B 站主页', { cls: 'sm', icon: 'external' }) + btn('微博', { cls: 'sm', icon: 'external' }) + '</div></div></section>' +
      '<div class="wave-edge" aria-hidden="true"><svg viewBox="0 0 1200 26" preserveAspectRatio="none"><path d="M0 14 Q50 0 100 14 T200 14 T300 14 T400 14 T500 14 T600 14 T700 14 T800 14 T900 14 T1000 14 T1100 14 T1200 14 V26 H0z"/></svg></div>' +
      '<div class="wrap"><div class="masonry" data-masonry style="margin-top:24px">' + PACKS.slice(3, 11).map((p, i) => packCard(p, i)).join('') + '</div></div>');
  },
  notes: { goal: '与角色页同构，换成画师信息与外链。', parts: ['首字头像 + 紫色主题', '外链按钮由后台维护'], motion: ['同角色页'], data: ['GET /api/artists/:slug/packs'], perf: ['同表情包目录'], mobile: ['同角色页'] }, demos: []
});

PAGES.push({ id: 'explore', group: 'pub', title: '探索', route: '/explore', fid: 'std',
  render(ctx) {
    const cloud = (vals, color) => '<div class="cloud">' + vals.map((v, i) => '<a href="#" data-go="packs" style="--tg:' + (color || 'var(--c-' + PALETTE[i % 12] + ')') + ';font-size:' + Math.min(22, 12 + Math.sqrt(v.n) * 1.4).toFixed(1) + 'px">' + esc(v.v) + '<small>' + v.n + '</small></a>').join('') + '</div>';
    const F = DATA.facets;
    return shell(ctx, 'explore', '<div class="wrap"><div class="page-h"><h1>探索</h1><span class="sub">源站的 115 个标签按 6 个维度重新整理。字号代表包的数量。</span></div>' +
      '<div style="display:grid;gap:18px;margin-top:18px"><div class="facet"><h3>角色 <small>69</small></h3>' + cloud(F['角色'].slice(0, 40)) + '</div>' +
      '<div class="cols-2e" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px"><div class="facet"><h3>画师 <small>27</small></h3>' + cloud(F['画师'], 'var(--c-purple)') + '</div>' +
      '<div class="facet"><h3>分组 · 工具 · 企划 · 原设 <small>6</small></h3>' + cloud(F['分组'].concat(F['工具'], F['企划'], F['原设']), 'var(--c-yellow)') + '<h3 style="margin-top:10px">格式</h3>' + cloud([{ v: '动态表情', n: 225 }, { v: '静态表情', n: 85 }, { v: '官方转载', n: 40 }], 'var(--c-mint)') + '</div></div></div></div>');
  },
  notes: { goal: '替代源站标签云和分类页；所有维度点进去都是带筛选条件的表情包目录。', parts: ['6 个维度：角色、画师、分组、工具、企划、原设，另加格式', '字号按包数量开平方映射，避免头部角色过大'], motion: ['悬停时底色加深'], data: ['GET /api/facets'], perf: ['纯文本'], mobile: ['维度卡片单列'] }, demos: []
});

PAGES.push({ id: 'collections', group: 'pub', title: '精选合集', route: '/collections', fid: 'std',
  render(ctx) {
    return shell(ctx, 'explore', '<div class="wrap"><div class="page-h"><h1>精选合集</h1><span class="sub">站长推荐、官方转载和主题系列。合集由后台编排，可以跨角色、跨画师。</span></div>' +
      '<div class="coll" style="margin-top:18px">' + COLLECTIONS.map((c) => '<a class="coll-card" href="#" data-go="packs" style="--acc:' + c.acc + '"><div class="coll-art">' + c.imgs.map((x) => '<img src="' + IMG(x) + '" alt="" loading="lazy">').join('') + '</div><div class="coll-body"><h3>' + c.t + '</h3><p>' + c.d + '</p><span class="pill-stat">' + ic('grid', 'sm') + c.n + ' 个包</span></div></a>').join('') + '</div></div>');
  },
  notes: { goal: '把源站「站长推荐」104 个包变成可编排的合集，首页「站长精选」从这里取数。', parts: ['合集卡：三张表情错落叠放在主题色波点上'], motion: ['悬停上浮 3px'], data: ['collections、collection_packs 两张表，后台拖拽排序'], perf: ['每卡 3 张海报'], mobile: ['单列'] }, demos: []
});

PAGES.push({ id: 'search', group: 'pub', title: '搜索结果', route: '/search?q=爱弥斯', fid: 'hi',
  render(ctx) {
    const c = CHAR_BY['爱弥斯'];
    const packs = PACKS.filter((p) => p.title.includes('爱弥斯')).concat(PACKS.slice(0, 4)).slice(0, 6);
    return shell(ctx, 'explore', '<div class="wrap"><div class="page-h"><div class="hero-search" style="margin-top:0;max-width:720px"><div class="input">' + ic('search') + '<input id="sr-q-' + ctx.f + '" value="爱弥斯"></div>' + btn('搜索', { cls: 'primary' }) + '</div><span class="sub">找到 1 位角色、40 个表情包、1,640 张表情</span></div>' +
      '<div class="tabs" role="tablist">' + [['全部', ''], ['角色', 1], ['表情包', 40], ['画师', 0], ['标签', 3]].map((t, i) => '<button role="tab" aria-selected="' + (i === 0) + '">' + t[0] + (t[1] !== '' ? '<span class="n">' + t[1] + '</span>' : '') + '</button>').join('') + '</div>' +
      '<div class="top-hit" style="--cc:' + c.color + ';margin-top:20px"><span class="pool"><img src="' + IMG(c.avatar) + '" alt=""></span><div><div class="eyebrow">最佳匹配 · 角色</div><h3>爱弥斯</h3><span class="muted">' + fmtN(c.count) + ' 张表情 · ' + c.packs + ' 个包 · 别名：小爱</span></div>' + btn('进入角色页', { cls: 'primary', go: 'char:爱弥斯' }) + '</div>' +
      '<section class="sec">' + secHead('表情包', { plain: true, more: ['全部 40 个', 'packs'] }) + '<div class="masonry" data-masonry>' + packs.map((p, i) => packCard(p, i)).join('') + '</div></section>' +
      '<section class="sec">' + secHead('表情', { plain: true, sub: '按热度' }) + '<div class="grid-tiles">' + EMO.slice(0, 16).map((x, i) => tile(x, i, { favs: ctx.S.favs })).join('') + '</div></section></div>');
  },
  notes: {
    goal: '源站 /search 直接 404。新站提供完整结果页，并用 Ctrl K 指令面板做即时搜索。',
    parts: ['最佳匹配卡：角色或画师命中时置顶', '分类标签：全部、角色、表情包、画师、标签', '指令面板：输入即出结果，回车打开，含「随机一张」「打开打包清单」等操作'],
    motion: ['面板弹出 spring 缩放，结果高亮用黄色荧光笔'],
    data: ['中文检索：PostgreSQL pg_trgm（3 字以内用前缀与别名表兜底）', '目录只有 309 个包、69 位角色，常用数据也在服务端内存索引里，响应在 50ms 内'],
    perf: ['输入防抖 120ms，结果最多 8 条'],
    mobile: ['指令面板全屏，从顶部滑下']
  },
  demos: [['打开指令面板', 'cmdk']]
});

PAGES.push({ id: 'bottle', group: 'pub', title: '打包清单', route: '/batch', fid: 'hi',
  render(ctx) {
    const items = Array.from(ctx.S.bottle), n = items.length;
    const groups = {};
    items.forEach((img) => { const it = POOL.find((x) => x.img === img) || { t: '其他', img }; (groups[it.t] = groups[it.t] || []).push(img); });
    const prog = ctx.F.zip;
    const action = prog == null
      ? btn('打包下载原图（' + n + ' 张）', { cls: 'primary block', icon: 'download', act: 'zip-page', attr: n ? '' : ' disabled' })
      : prog < 100 ? '<button class="btn primary block is-progress" style="--p:' + prog + '%" disabled>' + ic('box') + '正在打包 ' + prog + '%</button>'
      : '<div class="note-box">' + ic('check', 'sm') + '<span>已生成 ' + SITE.slug + '-' + n + '-stickers.zip（设计稿不会真的下载）。</span></div>';
    return shell(ctx, 'batch', '<div class="wrap"><div class="page-h"><h1>打包清单</h1><span class="sub">在任意表情上点「打包」加入，跨包收集后一次下载原图。清单存在浏览器里，登录后同步到账号。</span></div>' +
      '<div class="pk-layout"><div class="card">' + (n ? Object.keys(groups).map((t) => '<div class="bgroup"><h4>' + esc(t) + '<small>' + groups[t].length + ' 张</small></h4><div class="bthumbs">' + groups[t].map((img) => '<span class="bthumb"><img src="' + IMG(img) + '" alt=""><button data-act="unbottle" data-img="' + img + '" aria-label="移出">' + ic('close') + '</button></span>').join('') + '</div></div>').join('<hr class="pk-hr">') : '<div class="empty"><span class="empty-ico">' + ic('box', 'lg') + '</span><h3>还没有选中的表情</h3></div>') + '</div>' +
      '<aside class="card sand pk-side"><div class="pk-sum"><div><b class="num">' + n + '</b> 张<span>来自 ' + Object.keys(groups).length + ' 个包</span></div><div><b class="num">' + fmtB(n * 0.66 * 1048576) + '</b><span>原图合计</span></div></div>' +
      '<div class="field"><div class="lab">文件命名</div>' + seg([['pack', '包名 / 序号'], ['id', '表情 ID']], 'pack', 'noop', 'sm') + '</div>' +
      check('附带 CREDITS.txt（署名与许可）', true) + action +
      '<span class="hint">压缩包里是原图（GIF / PNG）。每 200 张一个压缩包；默认不需要登录，站长开启下载限额后按设置计数。</span></aside></div></div>');
  },
  notes: {
    goal: '源站只能在单个包里多选。打包清单允许跨包收集，最后一次下载原图，是本站的核心功能。',
    parts: ['左侧按包分组的缩略图，可单张移出；右侧摘要、命名方式与下载按钮', '没有插画装饰：页头只有一个「打包」按钮和数量', '压缩包内是原图，附 CREDITS.txt'],
    motion: ['加入时缩略图飞到页头「打包」按钮，数字弹一下', '打包进度直接显示在按钮上'],
    data: ['清单：未登录存 localStorage，登录后 PUT /api/me/batch 同步', 'POST /api/batch/sign 返回一批签名地址与 CREDITS.txt，浏览器用 client-zip 流式打包；每 200 张一个压缩包', '风控开启时，签发前按设置检查张数限额；只提供预览的包不会出现在签名结果里'],
    perf: ['client-zip 约 2.7 KB（gzip），不压缩、流式写出', '原图从 R2 直接下载，不经过应用服务器'],
    mobile: ['从底部的「打包」小按钮打开抽屉；微信内提示在浏览器打开']
  },
  demos: [['打开打包抽屉', 'bottle'], ['开始打包', 'zip-page']]
});

PAGES.push({ id: 'submit', group: 'pub', title: '投稿表情包', route: '/submit', fid: 'hi',
  render(ctx) {
    const files = EMO.slice(10, 22);
    const stat = (k) => (k === 3 ? '<span class="st warn">重复，已跳过</span>' : k === 7 ? '<span class="st info run">处理中</span>' : '<span class="st ok">完成</span>');
    const form = '<div style="display:grid;gap:18px">' +
      '<section class="card sub-step"><h3><span class="sn">1</span>基本信息</h3><div class="form-grid">' + field('标题', input('例如：爱弥斯 · 新年板牌', { id: 'sb-t-' + ctx.f, v: '爱弥斯 · 新年板牌' }), { cls: 'full' }) +
      field('角色', '<div class="chips">' + chip('爱弥斯', { sm: true, on: true, x: true, av: AV('爱弥斯'), cc: 'var(--c-pink)' }) + chip('添加角色', { sm: true, icon: 'plus' }) + '</div>') + field('类型', seg([['anim', '动态'], ['still', '静态']], 'anim', 'noop', 'sm')) +
      field('简介', '<textarea class="textarea" id="sb-x-' + ctx.f + '" style="min-height:76px">新年限定板牌，共 24 张。</textarea>', { cls: 'full' }) + '</div></section>' +
      '<section class="card sub-step"><h3><span class="sn">2</span>上传表情<small>GIF、PNG、WebP，单个不超过 20 MB</small></h3>' +
      '<div class="drop" style="padding:20px"><span class="drop-ico">' + ic('upload', 'lg') + '</span>' + '<div><b>拖入文件或 ZIP</b><p>文件直接传到存储，不经过网站服务器；重复的图片会自动跳过。</p></div>' + btn('选择文件', { cls: 'primary sm', icon: 'upload' }) + '</div>' +
      '<div class="sub-files">' + files.map((e, k) => '<div class="sub-file' + (k === 0 ? ' is-cover' : '') + '"><img src="' + IMG(e.img) + '" alt="">' + (k === 0 ? '<span class="cv-tag">封面</span>' : '') + stat(k) + '</div>').join('') + '</div></section>' +
      '<section class="card sub-step"><h3><span class="sn">3</span>署名与授权</h3><div class="form-grid">' + field('画师', input('画师名或主页链接', { id: 'sb-a-' + ctx.f, v: '示例画师' })) + field('我的身份', seg([['artist', '画师本人'], ['client', '约稿人'], ['granted', '已获授权']], 'client', 'noop', 'sm')) +
      field('授权说明', '<textarea class="textarea" id="sb-l-' + ctx.f + '" style="min-height:70px">已获画师同意，在本站以 CC BY-NC-SA 4.0 公开分享。</textarea>', { cls: 'full', hint: '写清楚谁画的、谁约的稿、是否同意在本站公开下载' }) +
      field('授权凭证', input('聊天截图或公开声明的链接（选填）', { icon: 'link', id: 'sb-p-' + ctx.f })) + field('许可协议', '<span class="sel" style="width:100%;justify-content:space-between">CC BY-NC-SA 4.0' + ic('down') + '</span>') +
      '<div class="full set-row" style="padding:12px 14px"><div><b>允许下载</b><small>关闭后只提供预览。官方表情请关闭。</small></div>' + sw('', true, 'noop') + '</div></div></section>' +
      '<div class="sub-submit">' + check('我已阅读投稿规范，确认以上信息属实', true) + '<span class="grow"></span>' + btn('保存草稿', { cls: 'sm' }) + btn('提交审核', { cls: 'primary', icon: 'send', act: 'submit-go' }) + '</div></div>';
    const aside = '<aside class="sub-aside"><div class="card"><h3 style="font-size:16px;margin-bottom:10px">投稿须知</h3><ul class="sub-rules"><li>每位注册用户都可以投稿，管理员审核通过后公开。</li><li>同一个包放同一组风格的表情，并写清画师与约稿人。</li><li>官方表情可以投稿整理，但只提供预览。</li><li>已发布的包再次修改会重新审核，审核期间线上显示旧版本。</li><li>审核通常在 1–2 天内完成〔时限待站长确认〕。</li></ul></div>' +
      '<div><div class="eyebrow" style="margin-bottom:10px">发布后的样子</div>' + packCard(Object.assign({}, PACKS[0], { title: '爱弥斯 · 新年板牌', count: 24, cover: files[0].img, minis: files.slice(1, 4).map((e) => e.img), chars: ['爱弥斯'], artists: ['示例画师'], dl: 0, fav: 0, date: '2026-10-20', pin: 0, acc: 'var(--c-pink)', excerpt: '新年限定板牌，共 24 张。' }), 0, { variant: 'four', isNew: true }) + '</div></aside>';
    ctx.layer.push('<div class="mob-actbar">' + btn('保存草稿', { cls: 'sm' }) + btn('提交审核', { cls: 'primary', icon: 'send', act: 'submit-go' }) + '</div>');
    return shell(ctx, 'me', '<div class="wrap"><div class="page-h"><div class="crumbs"><a href="#" data-go="me">个人中心</a>' + ic('right') + '<a href="#" data-go="me">我的投稿</a>' + ic('right') + '<span>新建投稿</span></div><h1>投稿表情包</h1><span class="sub">把你画的、约的或整理的鸣潮表情分享给大家。提交后由管理员审核。</span></div>' +
      '<div class="sub-layout">' + form + aside + '</div></div>');
  },
  notes: {
    goal: '投稿对所有注册用户开放，站长不必一个人上传。用户在前台完成投稿，不进入后台；管理员在后台「投稿审核」处理。',
    parts: ['一页四块：基本信息、上传表情、署名与授权、提交', '上传直传 R2 暂存区，逐张显示处理状态，重复图片自动跳过', '署名与授权必填：画师、我的身份、授权说明；「允许下载」开关决定是否只提供预览', '右侧实时预览发布后的卡片'],
    motion: ['上传完成的缩略图逐个弹入', '提交后跳到「我的投稿」并高亮新条目'],
    data: ['POST /api/submissions 建草稿；POST /api/uploads 申请签名地址前校验「包属于当前用户」，对象键由服务端生成', 'POST /api/submissions/:id/submit 进入审核；状态：草稿 → 待审核 → 已发布或已退回', '已发布包的修改也是一条投稿，payload 记录基准版本，审核通过后替换线上版本', '上传后的预览图在 review/v1/，只有投稿者与审核人能看到'],
    perf: ['大文件不经过应用服务器；缩略图生成在 worker 中排队'],
    mobile: ['单列；提交按钮固定在底部']
  },
  demos: [['提交审核', 'submit-go']]
});

PAGES.push({ id: 'login', group: 'pub', title: '登录', route: '/login', fid: 'hi',
  render(ctx) {
    const st = ctx.F.auth || 'form';
    const form = st === 'reset' ? '<h1>找回密码</h1><p class="muted">输入注册邮箱，我们会发一封重置链接。</p>' + field('邮箱', input('you@example.com', { icon: 'mail', id: 'rs-e-' + ctx.f })) + '<span class="captcha"><span class="ok">' + ic('check', 'sm') + '</span>人机验证已通过</span>' + btn('发送重置邮件', { cls: 'primary block lg', act: 'auth-sent' }) + '<a href="#" data-act="auth-form" class="muted" style="text-align:center;font-weight:700">返回登录</a>'
      : st === 'sent' ? '<div class="sent">' + ic('mail', 'lg') + '<h3>邮件已发出</h3><p class="muted">请在 30 分钟内点击邮件里的链接。没收到可以在 <b class="num">58</b> 秒后重发。</p></div>' + btn('返回登录', { cls: 'block', act: 'auth-form' })
      : '<h1>欢迎回到' + SITE.name + '</h1>' + field('邮箱或用户名', input('you@example.com', { icon: 'user', id: 'lg-u-' + ctx.f, v: 'jinzhou@example.com' })) + field('密码', input('至少 8 位', { icon: 'lock', type: 'password', id: 'lg-p-' + ctx.f, v: 'password1' }), { aside: '<a href="#" data-act="auth-reset" style="color:var(--tp-teal-ink)">忘记密码？</a>' }) +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' + check('30 天内保持登录', true) + '<span class="captcha"><span class="ok">' + ic('check', 'sm') + '</span>人机验证已通过</span></div>' +
        btn('登录', { cls: 'primary block lg', act: 'login' }) + '<div class="or">或者</div><div class="alt">' + btn('通行密钥', { icon: 'fingerprint', act: 'login' }) + btn('GitHub', { icon: 'code', act: 'login' }) + '</div>' +
        '<p class="muted" style="text-align:center;font-size:14px">还没有账号？<a href="#" data-go="register" style="color:var(--tp-teal-ink);font-weight:800">注册</a></p>';
    return '<div class="auth"><div class="auth-art"><div>' + logoMark() + '<h2 style="margin-top:22px">潮水退了，<br>表情都还在。</h2><p>下载不需要账号。登录后可以收藏、评论、同步打包清单，也可以投稿自己的表情包。</p>' +
      '<div class="perks"><div>' + ic('heart') + '收藏夹多端同步</div><div>' + ic('box') + '打包清单跟着账号走</div><div>' + ic('chat') + '评论区发贴纸</div><div>' + ic('upload') + '投稿自己的表情包</div></div></div>' +
      '<div class="bubbles">' + [AV('菲比'), AV('达妮娅'), AV('爱弥斯')].map((x, k) => '<span class="floaty" style="left:' + [8, 46, 26][k] + '%;top:' + [10, 30, 58][k] + '%;--fd:-' + k * 1.3 + 's"><img src="' + IMG(x) + '" alt=""></span>').join('') + '</div>' +
      '<a href="#" data-go="home" style="color:#a9cfc8;font-weight:700;display:inline-flex;gap:6px;align-items:center;position:relative">' + ic('back', 'sm') + '回到首页</a></div>' +
      '<div class="auth-form"><div class="auth-card">' + form + '</div></div></div>';
  },
  notes: {
    goal: '替换 Halo 默认登录页。左侧说明登录的好处，右侧表单；人机验证用自托管的 Cap（工作量证明，不用点选图片），不依赖 Cloudflare。',
    parts: ['邮箱或用户名 + 密码；通行密钥（Passkey）与 GitHub 登录', '找回密码与「邮件已发出」两个状态，演示按钮可切换', '错误提示写清原因和解决办法'],
    motion: ['左侧表情漂浮；表单状态切换用 0.25 秒交叉淡入'],
    data: ['Better Auth：/api/auth/*；注册与登录走 Cap 验证，防止批量注册（不涉及下载）'],
    perf: ['认证页不加载评论、瀑布流等脚本，路由级代码分割'],
    mobile: ['左侧说明压缩为顶部色块，只保留标题和一句话']
  },
  demos: [['找回密码', 'auth-reset'], ['邮件已发出', 'auth-sent'], ['登录成功', 'login']]
});

PAGES.push({ id: 'register', group: 'pub', title: '注册', route: '/register', fid: 'std',
  render(ctx) {
    return '<div class="auth"><div class="auth-art" style="background:color-mix(in srgb,var(--tp-deep) 80%,var(--c-purple))"><div>' + logoMark() + '<h2 style="margin-top:22px">来' + SITE.name + '<br>安个家</h2><p>注册只需要邮箱。我们只用它发验证和回复提醒，不会公开。</p></div><span></span></div>' +
      '<div class="auth-form"><div class="auth-card"><h1>注册</h1>' + field('用户名', input('2–16 个字符', { icon: 'user', id: 'rg-u-' + ctx.f, v: '今州打工人' }), { hint: '可以使用中文' }) + field('邮箱', input('you@example.com', { icon: 'mail', id: 'rg-e-' + ctx.f, v: 'jinzhou@example' , cls: 'is-err' }), { hint: '邮箱格式不完整，缺少域名后缀（例如 .com）', err: true }) +
      field('密码', input('至少 8 位', { icon: 'lock', type: 'password', id: 'rg-p-' + ctx.f, v: 'tidepool2026' }) + '<div class="pw-meter"><i class="on"></i><i class="on"></i><i class="on"></i><i></i></div>', { hint: '强度：较好。加入符号会更安全' }) +
      check('我已阅读并同意 <a href="#" data-go="legal" style="color:var(--tp-teal-ink)">服务条款</a> 与 <a href="#" data-go="legal" style="color:var(--tp-teal-ink)">隐私政策</a>', true) + '<span class="captcha"><span class="ok">' + ic('check', 'sm') + '</span>人机验证已通过</span>' +
      btn('创建账号', { cls: 'primary block lg', act: 'auth-sent2' }) + '<p class="muted" style="text-align:center;font-size:14px">已有账号？<a href="#" data-go="login" style="color:var(--tp-teal-ink);font-weight:800">登录</a></p></div></div></div>';
  },
  notes: { goal: '注册三项字段；错误就地提示，说明原因与修法。', parts: ['密码强度条四格', '邮箱验证：注册后进入「邮件已发出」状态'], motion: ['错误输入框底部出现红色 3D 投影'], data: ['Better Auth emailAndPassword + requireEmailVerification'], perf: ['同登录页'], mobile: ['同登录页'] }, demos: []
});

PAGES.push({ id: 'me', group: 'pub', title: '个人中心', route: '/me', fid: 'hi',
  render(ctx) {
    const tab = ctx.F.mtab || 'fav';
    const T = [['fav', '收藏夹', 4], ['sub', '我的投稿', 3], ['dl', '下载记录', 563], ['cm', '我的评论', 12], ['nt', '通知', 3], ['set', '设置', '']];
    let body = '';
    if (tab === 'fav') body = '<div class="folders">' + [['默认收藏夹', 52], ['聊天常用', 18], ['爱弥斯', 30], ['摸鱼专用', 9]].map((f, k) => '<button class="folder' + (k === 0 ? ' is-on' : '') + '" style="text-align:left"><div class="mini">' + EMO.slice(k * 3, k * 3 + 3).map((e) => '<img src="' + IMG(e.img) + '" alt="">').join('') + '</div><b>' + f[0] + '</b><small>' + f[1] + ' 张</small></button>').join('') + '<button class="folder" style="display:grid;place-items:center;border-style:dashed;color:var(--tp-muted);font-weight:800">' + ic('plus', 'lg') + '新建收藏夹</button></div>' +
      '<div class="toolbar" style="margin-top:20px"><b style="color:var(--tp-ink)">默认收藏夹</b><span class="muted num">52 张</span><span class="grow"></span>' + btn('全部加入打包', { cls: 'sm sun', icon: 'bottle', act: 'add-all' }) + '</div><div class="grid-tiles">' + EMO.slice(0, 18).map((e, i) => tile(e, i, { favs: new Set(EMO.map((x) => x.img)) })).join('') + '</div>';
    else if (tab === 'dl') body = '<div class="list">' + [['爱弥斯动态表情包（板牌）', '整包 ZIP · 25 张 · 16.5 MB', '今天 04:21'], ['打包清单打包', '6 个包 · 32 张 · WebP 9.8 MB', '昨天 22:10'], ['达妮娅捏捏表情包', '单张 GIF · 1.2 MB', '10-18'], ['菲比 · 微信精选 · 静态表情包', '整包 ZIP · 220 张 · 24.6 MB', '10-12']].map((r, k) => '<div class="li"><span class="th"><img src="' + IMG(PACKS[k].cover) + '" alt=""></span><div><b>' + r[0] + '</b><small>' + r[1] + ' · ' + r[2] + '</small></div><span class="r">' + btn('再次下载', { cls: 'xs', icon: 'download' }) + '</span></div>').join('') + '</div>';
    else if (tab === 'sub') body = '<div class="toolbar"><b style="color:var(--tp-ink)">我的投稿</b><span class="muted">提交后由管理员审核，通过即公开</span><span class="grow"></span>' + btn('新建投稿', { cls: 'primary sm', icon: 'plus', go: 'submit' }) + '</div><div class="list">' +
      SUBMISSIONS.filter((x) => x.mine).map((x) => '<div class="li"><span class="th"><img src="' + IMG(x.img) + '" alt=""></span><div><b>' + esc(x.t) + '</b><small>' + x.n + ' 张 · ' + x.time + (x.note ? ' · ' + esc(x.note) : '') + '</small></div><span class="r">' + '<span class="st ' + x.cls + '">' + x.st + '</span>' + btn(x.st === '已退回' ? '修改后重新提交' : x.st === '已发布' ? '查看' : '撤回', { cls: 'xs', go: x.st === '已发布' ? 'pack' : 'submit' }) + '</span></div>').join('') + '</div>' +
      '<div class="note-box">' + ic('info', 'sm') + '<span>已发布的包再次修改会生成一个待审核版本，审核通过前线上仍显示旧版本。</span></div>';
    else if (tab === 'set') body = '<div class="settings-grid">' + [['悬停播放动图', '关闭后只在单张弹窗里播放，省流量', true], ['手机流量下显示静态图', '检测到 Save-Data 或 2G/3G 时启用', true], ['减少动效', '跟随系统设置，也可在这里强制开启', false], ['评论回复提醒', '站内通知；邮件摘要在后续版本提供', true], ['夜潮主题', '深色界面，跟随系统或手动切换', false]].map((r) => '<div class="set-row"><div><b>' + r[0] + '</b><small>' + r[1] + '</small></div>' + sw('', r[2], 'noop') + '</div>').join('') +
      '<div class="set-row"><div><b>通行密钥</b><small>已绑定 2 个设备：iPhone、Windows Hello</small></div>' + btn('管理', { cls: 'sm' }) + '</div><div class="set-row"><div><b>注销账号</b><small>删除账号、收藏与评论，30 天内可撤销</small></div>' + btn('注销', { cls: 'sm', attr: ' style="color:var(--tp-err)"' }) + '</div></div>';
    else body = '<div class="list">' + COMMENTS.slice(1, 4).map((c) => '<div class="li"><span class="th"><img src="' + IMG(EMO[c.id].img) + '" alt=""></span><div><b>' + (tab === 'nt' ? esc(c.u) + ' 回复了你' : '在「' + esc(DETAIL.title) + '」') + '</b><small>' + c.body.replace(/<[^>]+>/g, '').slice(0, 40) + ' · ' + c.time + '</small></div><span class="r">' + btn('查看', { cls: 'xs', go: 'pack' }) + '</span></div>').join('') + '</div>';
    return shell(ctx, 'me', '<div class="wrap"><div class="me-h"><span class="avatar"><img src="' + IMG(AV('爱弥斯')) + '" alt=""></span><div><h1>今州打工人</h1><span class="muted">2026-09-03 加入 · 评论 12 条 · 投稿 3 个包</span></div>' +
      '<div class="quota"><div class="row">我的投稿<small>已发布 1 · 审核中 1 · 已退回 1</small></div>' + btn('新建投稿', { cls: 'sm block', icon: 'upload', go: 'submit' }) + '</div></div>' +
      '<div class="tabs" role="tablist">' + T.map((t) => '<button role="tab" data-act="mtab" data-v="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + t[1] + (t[2] !== '' ? '<span class="n">' + t[2] + '</span>' : '') + '</button>').join('') + '</div><div style="margin-top:20px;display:grid;gap:16px">' + body + '</div></div>');
  },
  notes: {
    goal: '对应源站「账户」页：收藏、下载记录、评论与通知，并加入「我的投稿」。',
    parts: ['收藏夹：多个文件夹，每个显示三张缩略图', '我的投稿：审核中、已发布、已退回三种状态，退回会附上原因', '下载记录可再次下载；打包清单打包也会记录', '设置：悬停播放、省流量、减少动效、夜潮主题'],
    motion: ['标签切换下划线摆动'],
    data: ['GET /api/me、/api/me/favorites、/api/me/downloads、/api/me/submissions'],
    perf: ['标签页按需请求'],
    mobile: ['投稿入口移到头像下方；收藏夹两列']
  },
  demos: [['我的投稿', 'mtab-sub'], ['下载记录', 'mtab-dl'], ['设置', 'mtab-set']]
});

PAGES.push({ id: 'about', group: 'pub', title: '关于', route: '/about', fid: 'std',
  render(ctx) {
    return shell(ctx, 'home', '<div class="wrap"><div class="page-h"><h1>关于' + SITE.name + '</h1><span class="sub">一个由潮友维护的鸣潮表情仓库</span></div><div class="doc"><nav class="toc"><a class="is-on" href="#">本站是什么</a><a href="#">内容从哪里来</a><a href="#">署名与授权</a><a href="#">下架申诉</a><a href="#">数字</a><a href="#">贡献者</a></nav>' +
      '<div class="prose"><h2>本站是什么</h2><p>' + SITE.name + '整理鸣潮相关的表情包，让大家在聊天时能快速找到、复制、打包。内容免费下载，不做商用。</p>' +
      '<h2>署名与授权</h2><p>每个表情包都标明画师、约稿人和许可协议。社区作品多数采用 CC BY-NC-SA 4.0；官方表情标注「官转」，版权归库洛游戏所有。下载的压缩包会附带 CREDITS.txt。</p>' +
      '<h2>下架申诉</h2><p>如果你是作者并希望下架或修改署名，请在页面底部提交申诉，我们会在 3 个工作日内处理〔时限待站长确认〕。</p>' +
      '<h2>数字</h2>' + stats([[fmtN(DATA.stats.emojis), '张表情'], [DATA.stats.packs, '个表情包'], ['69', '位角色'], [fmtW(DATA.stats.downloads), '次下载']]) +
      '<h2>贡献者</h2><div class="contrib">' + EX_USERS.slice(0, 6).map((u) => '<div><span class="avatar sm" style="border-color:var(--c-' + u.c + ')">' + u.n.slice(0, 1) + '</span><span><b>' + u.n + '</b><small>示例 · 整理与纠错</small></span></div>').join('') + '</div></div></div></div>');
  },
  notes: { goal: '源站「穗穗念」的结构保留，文字由站长重写；重点交代来源、授权和下架流程。', parts: ['左侧目录 + 正文，正文宽度 70 字以内', '数字区复用首页统计组件'], motion: ['无'], data: ['单页内容存 pages 表，后台 Markdown 编辑'], perf: ['纯文本 SSR，可整页缓存'], mobile: ['目录变为横向滚动标签'] }, demos: []
});

PAGES.push({ id: 'links', group: 'pub', title: '友情链接', route: '/links', fid: 'std',
  render(ctx) {
    const L = [['资料与检索', [['鸣潮百科 · 灰机 Wiki', '玩家共建的鸣潮百科'], ['库街区鸣潮 Wiki', '图鉴、攻略与任务'], ['encore.moe', 'Wuthering Waves Database']]], ['工具', [['配队与排轴工具', '伤害计算与配队'], ['鸣潮文本检索', '多语言全文本检索']]], ['角色主题站', [['弗洛洛主题站', '角色主题站'], ['菲比主题站', '角色主题站'], ['椿主题站', '角色主题站']]], ['同人游戏', [['菲比啾比大冒险', '生存与升级小游戏'], ['弗洛洛猜谜', '主题猜谜']]]];
    return shell(ctx, 'home', '<div class="wrap"><div class="page-h"><h1>友情链接</h1><span class="sub">海内存知己。以下为示例分组，链接由后台维护。</span><div class="row">' + btn('随机访问一个', { cls: 'sm sun', icon: 'dice' }) + btn('申请友链', { cls: 'sm', icon: 'plus' }) + '</div></div>' +
      L.map((g, k) => '<section class="sec" style="margin-top:28px"><h2 class="h-plain" style="font-size:20px;margin-bottom:12px">' + g[0] + ' <span class="muted num" style="font-size:14px">' + g[1].length + '</span></h2><div class="links-grid">' + g[1].map((x, i) => '<a class="lcard" href="#" style="--acc:var(--c-' + PALETTE[(k * 3 + i) % 12] + ')"><span class="ico">' + x[0].slice(0, 1) + '</span><div><b>' + x[0] + '</b><small>' + x[1] + '</small></div>' + ic('external', 'sm') + '</a>').join('') + '</div></section>').join('') + '</div>');
  },
  notes: { goal: '保留源站 29 个友链与分组，去掉外链图标的批量请求。', parts: ['首字图标代替外站 favicon，避免几十个第三方请求', '外链统一 rel="noopener nofollow"'], motion: ['悬停上浮'], data: ['links 表：分组、排序、可见性'], perf: ['零图片'], mobile: ['单列'] }, demos: []
});

PAGES.push({ id: 'api', group: 'pub', title: 'API 接入', route: '/api', fid: 'std',
  render(ctx) {
    const ep = (m, path, desc, params, ex) => '<div class="endpoint"><div class="endpoint-h"><span class="method">' + m + '</span><code>' + path + '</code><span class="muted" style="margin-left:auto;font-size:13px">' + desc + '</span></div><div class="endpoint-b">' +
      (params ? '<div style="overflow-x:auto"><table class="ptable"><thead><tr><th>参数</th><th>类型</th><th>说明</th></tr></thead><tbody>' + params.map((p) => '<tr><td><code>' + p[0] + '</code></td><td>' + p[1] + '</td><td>' + p[2] + '</td></tr>').join('') + '</tbody></table></div>' : '') + '<div class="codeblock">' + ex + '</div></div></div>';
    return shell(ctx, 'home', '<div class="wrap"><div class="page-h"><h1>API 接入</h1><span class="sub">给机器人和小工具用的只读接口，直接调用，不需要 Token。</span></div><div class="doc"><nav class="toc"><a class="is-on" href="#">快速开始</a><a href="#">随机表情</a><a href="#">表情包</a><a href="#">角色</a><a href="#">错误码</a></nav><div class="prose" style="max-width:none">' +
      '<div class="note-box">' + ic('info', 'sm') + '<span>只读、无需鉴权。返回体带署名字段，转发表情时请一并保留。只提供预览的包只返回预览图。</span></div>' +
      '<h2>随机表情</h2>' + ep('GET', '/api/v1/random', '随机返回一张', [['character', 'string', '角色名或拼音 slug，如 aimisi'], ['type', 'anim | still', '动态或静态'], ['format', 'json | redirect', 'redirect 时直接 302 到图片']], '<span class="c"># 随机一张爱弥斯</span>\ncurl <span class="s">"https://' + SITE.domain + '/api/v1/random?character=aimisi"</span>\n\n{ <span class="k">"id"</span>: <span class="s">"r-0a7bf47f0ec26d3843bf"</span>, <span class="k">"pack"</span>: <span class="s">"aimisi-01"</span>,\n  <span class="k">"preview"</span>: <span class="s">"https://' + SITE.domain + '/img/v1/p240/aimisi-01/r-0a7b….webp"</span>,\n  <span class="k">"credit"</span>: { <span class="k">"artist"</span>: <span class="s">"猫屋敷梨梨&amp;春也Haruya"</span>, <span class="k">"license"</span>: <span class="s">"CC BY-NC-SA 4.0"</span> } }') +
      '<h2>表情包</h2>' + ep('GET', '/api/v1/packs', '分页列出表情包', [['character', 'string', '角色筛选'], ['sort', 'newest | popular', '排序'], ['cursor', 'string', '上一页返回的游标']], '{ <span class="k">"items"</span>: [ … ], <span class="k">"next"</span>: <span class="s">"eyJwIjoyNH0"</span> }') +
      '<h2>错误码</h2><div style="overflow-x:auto"><table class="ptable"><thead><tr><th>状态</th><th>code</th><th>含义与处理</th></tr></thead><tbody><tr><td>404</td><td><code>NOT_FOUND</code></td><td>表情或表情包不存在，或已被下架</td></tr></tbody></table></div></div></div></div>');
  },
  notes: { goal: '保留源站的随机表情 API：只读、无需 Token，返回体带署名。', parts: ['接口卡：方法、路径、参数表、示例', '返回体里带署名字段，方便机器人遵守 BY 条款'], motion: ['无'], data: ['/api/v1/* 只读，复用前台查询；不需要密钥', '按 IP 限速，与「下载与风控」共用设置；限额留空即不限制'], perf: ['API 走同一个应用进程，边缘缓存 30 秒（随机接口除外）'], mobile: ['代码块横向滚动'] }, demos: []
});

PAGES.push({ id: 'notfound', group: 'pub', title: '404', route: '/404', fid: 'std',
  render(ctx) {
    return shell(ctx, 'home', '<div class="wrap"><div class="nf"><div class="code">404</div>' + emptyArt() + '<h1>这里没有这张表情</h1><p class="muted">链接可能已失效，或者表情已经被作者下架。可以搜一下，或者随便看看。</p><div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">' + btn('搜索表情', { cls: 'primary', icon: 'search', act: 'cmdk' }) + btn('回到首页', { go: 'home', icon: 'home' }) + '</div></div>' +
      '<section class="sec">' + secHead('也许你想看', { plain: true }) + '<div class="grid-tiles">' + EMO.slice(0, 8).map((x, i) => tile(x, i, { favs: ctx.S.favs })).join('') + '</div></section></div>');
  },
  notes: { goal: '失效链接不留死胡同：给搜索、首页和推荐三条出路。', parts: ['大号 404 数字带 3D 投影；空潮池插画'], motion: ['无'], data: ['旧站路径 /archives/:slug、/tags/:slug 在服务端 301 到新路径，尽量不落到这里'], perf: ['静态页'], mobile: ['同上'] }, demos: []
});

PAGES.push({ id: 'legal', group: 'pub', title: '文档页（隐私与条款）', route: '/legal/privacy', fid: 'std',
  render(ctx) {
    return shell(ctx, 'home', '<div class="wrap"><div class="page-h"><div class="crumbs"><a href="#" data-go="home">首页</a>' + ic('right') + '<span>隐私政策</span></div><h1>隐私政策</h1><span class="sub">更新于 2026-10-20 · 示例文本，正式内容待站长确认</span></div><div class="doc"><nav class="toc"><a class="is-on" href="#">我们收集什么</a><a href="#">怎么使用</a><a href="#">Cookie</a><a href="#">你的权利</a></nav><div class="prose">' +
      '<h2>我们收集什么</h2><ul><li>注册时的用户名、邮箱和密码哈希。</li><li>评论与投稿记录，用于展示和审核。</li><li>IP 地址只以加盐哈希的形式保存，用于评论反垃圾。</li></ul><h2>Cookie</h2><p>只使用登录会话所需的 Cookie，不接入第三方广告或追踪。</p><h2>你的权利</h2><p>可以在个人中心导出或删除自己的数据。</p></div></div></div>');
  },
  notes: { goal: '隐私政策、服务条款、版权申诉共用的长文模板。', parts: ['目录 + 正文'], motion: ['无'], data: ['pages 表'], perf: ['静态'], mobile: ['目录横向滚动'] }, demos: []
});
