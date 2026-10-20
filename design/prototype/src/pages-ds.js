// ---------- design system page (first entry in the index) ----------
PAGES.unshift({ id: 'ds', group: 'ds', title: '设计系统', route: '/design', fid: 'hi',
  render(ctx) {
    const swc = (name, v, hex) => '<div class="sw"><i style="background:' + v + '"></i><div><b>' + name + '</b><code>' + hex + '</code></div></div>';
    const surf = [['页面底 sand-50', 'var(--tp-bg)', '#f8f8f0'], ['内容区 sand', 'var(--tp-sand)', '#f7f3df'], ['卡片 card', 'var(--tp-card)', '#fffdf4'], ['输入 input', 'var(--tp-input)', '#fffbe7'], ['标题墨 ink', 'var(--tp-ink)', '#794f27'], ['正文 body', 'var(--tp-body)', '#725d42'], ['次要 muted', 'var(--tp-muted)', '#7b6c56'], ['线 line', 'var(--tp-line-2)', '#d9cdb2']];
    const tide = [['潮汐青 teal', 'var(--tp-teal)', '#19c8b9'], ['青上文字 on-teal', 'var(--tp-on-teal)', '#06403a'], ['深潮 deep', 'var(--tp-deep)', '#134a55'], ['泡沫 foam', 'var(--tp-foam)', '#eafaf6'], ['日光 sun', 'var(--tp-sun)', '#f7cd67'], ['珊瑚 coral', 'var(--tp-coral)', '#f2857a'], ['3D 投影', 'var(--tp-shadow-3d)', '#bdaea0'], ['焦点 focus', 'var(--tp-focus)', '#ffcc00']];
    const isl = PALETTE.map((c) => '<div class="sw"><i style="background:var(--c-' + c + ')"></i><div><b>' + c + '</b><code>--c-' + c + '</code></div></div>').join('');
    const tiers = [[EMO[0].img, '原图 GIF', '690 KB', '300×300 · 28 帧，只在下载时使用'], [EMO[0].img, '海报 p240', '16 KB', '静态 WebP q72，取最清楚的一帧，网格默认显示'], [EMO[0].anim, '预览 a160', '109 KB', '160px · q40 · 抽到 14 帧（上限 24），悬停播放'], [EMO[0].anim, '完整 WebP', '425 KB', '原尺寸 q60 全帧，单张弹窗播放']];
    return shell(ctx, 'home', '<div class="wrap"><div class="page-h"><span class="eyebrow">Design System · v1</span><h1>' + SITE.name + '设计系统</h1><span class="sub" style="max-width:60ch">以 animal-island-ui 的暖沙色、薄荷青、胶囊形和 3D 按钮为底，叠加鸣潮的潮汐意象。表情是唯一的主角，界面只用色块、波点和波浪线，不放插画大图。站名由配置变量 <code class="mono">SITE.name</code> 提供（当前为「' + SITE.name + '」），改一处全站生效。</span></div>' +
      '<section class="sec">' + secHead('色彩', { plain: true, sub: '暖色中性 + 潮汐青；正文对比度均 ≥ 4.5:1' }) + '<div class="ds-sw">' + surf.map((x) => swc.apply(null, x)).join('') + '</div><div class="ds-sw" style="margin-top:12px">' + tide.map((x) => swc.apply(null, x)).join('') + '</div><h3 style="font-size:15px;margin:18px 0 10px">岛屿色板 · 用于角色主题色与标签</h3><div class="ds-sw isl">' + isl + '</div>' +
      '<div class="note-box" style="margin-top:14px">' + ic('info', 'sm') + '<span>组件库原主按钮是白字配 #19c8b9，对比度只有 2.1:1。这里改为深青文字 #06403a（5.9:1），保留按钮颜色和 3D 投影。焦点环用棕色描边加黄色外晕，在米色底上也能看清。</span></div></section>' +
      '<section class="sec">' + secHead('字体', { plain: true, sub: '标题圆体按需切片，正文用系统字体，数字用 Nunito' }) +
      '<div class="card"><div class="type-row"><small>Display · 寒蝉圆黑体 Heavy<br>别名 TP Rounded</small><div style="font-family:var(--tp-font-display);font-weight:900;font-size:44px;color:var(--tp-ink);line-height:1.15">退潮后，捡一枚表情</div></div>' +
      '<div class="type-row"><small>H2 · 圆体 Bold 26/1.25</small><div style="font-family:var(--tp-font-display);font-weight:800;font-size:26px;color:var(--tp-ink)">爱弥斯动态表情包（板牌）</div></div>' +
      '<div class="type-row"><small>正文 · 系统黑体 15/1.6 · 500</small><div>感谢来自群聊的约稿。共 25 张动态表情，许可为 CC BY-NC-SA 4.0，下载的压缩包附带署名文件。</div></div>' +
      '<div class="type-row"><small>数字 · Nunito 900 等宽</small><div class="num" style="font-size:34px;color:var(--tp-ink)">15,272 · 309 · 186 万</div></div>' +
      '<div class="type-row"><small>标签 · 12/16 · 900 字距 0.16em</small><div class="eyebrow">Wuthering Waves Stickers</div></div></div>' +
      '<div class="note-box" style="margin-top:14px">' + ic('info', 'sm') + '<span>animal-island-ui 的样式会注册 Noto Sans SC 三个字重，每个约 1.1 MB，且没有 unicode-range，所以本站不引入它的样式与运行时，只沿用令牌。中文正文用系统字体（苹方、HarmonyOS Sans、MiSans、微软雅黑）。标题圆体用 cn-font-split 切成按 unicode-range 加载的小块，单页通常只取 60–150 KB。寒蝉圆黑体为 OFL 许可，没有保留字体名，子集化后用中性别名 TP Rounded 发布。本设计稿内嵌的是只含本页用字的子集。</span></div></section>' +
      '<section class="sec">' + secHead('组件', { plain: true, sub: '形状和投影沿用 animal-island-ui，颜色走本站令牌' }) + '<div class="ds-grid">' +
      '<div class="card ds-card"><h4>按钮<small>Button</small></h4><div class="ds-row">' + btn('打包下载', { cls: 'primary', icon: 'box', act: 'ripple' }) + btn('加入打包', { cls: 'sun', icon: 'bottle', act: 'ripple' }) + btn('收藏', { icon: 'heart', act: 'ripple' }) + btn('删除', { cls: 'danger sm' }) + btn('取消', { cls: 'ghost sm' }) + '</div><span class="hint">主按钮：5px 实色投影，悬停抬高 1px，按下下沉 4px。只有主按钮和日光按钮用 3D 投影。</span></div>' +
      '<div class="card ds-card"><h4>输入与选择<small>Input · Switch · Segmented</small></h4>' + input('搜索表情包、角色、画师', { icon: 'search', id: 'ds-in-' + ctx.f }) + '<div class="ds-row">' + sw('自动播放', true, 'noop') + sw('减少动效', false, 'noop') + check('附带 CREDITS.txt', true) + '</div>' + seg([['hot', '最热'], ['new', '最新'], ['fav', '收藏最多']], 'hot', 'noop') + '</div>' +
      '<div class="card ds-card"><h4>标签与旗标<small>Chip · Tag · Flag</small></h4><div class="ds-row">' + chip('全部', { on: true, sm: true }) + chip('爱弥斯', { sm: true, av: AV('爱弥斯'), cc: 'var(--c-pink)', n: 40 }) + chip('静态', { sm: true, n: 85 }) + '</div><div class="ds-row">' + tag('角色 · 爱弥斯', 'var(--c-pink)') + tag('画师 · 雾雪', 'var(--c-purple)') + tag('动态表情') + '</div><div class="ds-row"><b class="flag official">官转</b><b class="flag pin">置顶</b><b class="flag memorial">' + ic('star', 'sm') + '纪念</b><b class="flag new">新</b><b class="flag static">静态</b></div></div>' +
      '<div class="card ds-card"><h4>缎带标题<small>Title ribbon</small></h4><div class="ds-row" style="gap:18px">' + ribbon('站长精选', 'sun') + ribbon('新上架', 'pink') + ribbon('潮汐流', 'mint') + ribbon('官方表情', 'deep') + '</div><span class="hint">燕尾裁切 + 3° 透视，只用于首页区块标题，每屏最多两条。</span></div>' +
      '<div class="card ds-card"><h4>表情方块<small>Tile</small></h4><div class="grid-tiles t96">' + EMO.slice(0, 3).map((e, i) => tile(e, i, { favs: ctx.S.favs })).join('') + '</div><span class="hint">悬停：抬起、播放动图、出现复制/下载/加入打包/收藏。按下：捏一捏。</span></div>' +
      '<div class="card ds-card"><h4>角色卡<small>Character</small></h4><div class="cgrid">' + CHARS.slice(0, 2).map(charCard).join('') + '</div></div></div></section>' +
      '<section class="sec">' + secHead('动效', { plain: true, sub: '统一缓动 cubic-bezier(0.4,0,0.2,1)，时长 150–350ms；弹性只用于按压与弹出' }) + '<div class="motion-demo">' +
      '<div class="card"><div class="grid-tiles t110" style="width:120px">' + tile(EMO[7], 7, { act: 'squish-demo' }) + '</div><b>捏一捏</b><small>按下方块：0.48 秒压扁回弹，呼应「捏捏」表情</small></div>' +
      '<div class="card">' + btn('点我', { cls: 'primary', act: 'ripple' }) + '<b>潮汐涟漪</b><small>按钮按下处扩散一圈水纹</small></div>' +
      '<div class="card"><span class="bottle-btn" style="pointer-events:none">' + ic('box') + '<span class="label">打包</span><span class="count num">6</span></span><b>加入打包</b><small>缩略图沿弧线飞到页头的「打包」按钮，数字弹一下</small></div>' +
      '<div class="card"><div class="wave-loader"><i></i><i></i><i></i><i></i><i></i></div><b>声纹加载</b><small>代替转圈，用于无限加载</small></div>' +
      '<div class="card"><div class="tabs" style="border:0"><button aria-selected="true">表情包</button><button aria-selected="false">全部表情</button></div><b>叶片摆动</b><small>标签下划线切换时轻微摆动（组件库 Tabs）</small></div></div>' +
      '<div class="note-box" style="margin-top:14px">' + ic('info', 'sm') + '<span>不引入动画库：全部用 CSS 与 Web Animations API；页面切换用浏览器原生 View Transitions。系统开启「减少动态效果」时一律关闭。</span></div></section>' +
      '<section class="sec">' + secHead('图片分级', { plain: true, sub: '以本页第一张表情为例，数值为实测' }) + '<div class="tier">' + tiers.map((t) => '<div class="card"><img src="' + IMG(t[0]) + '" alt=""><b>' + t[2] + '</b><span style="color:var(--tp-ink);font-weight:800">' + t[1] + '</span><span>' + t[3] + '</span></div>').join('') + '</div>' +
      '<div class="note-box" style="margin-top:14px">' + ic('info', 'sm') + '<span>同一个 25 张的包，源站列表的动图缩略图约 2.5 MB（单张约 100–120 KB，逐张 fetch）；新站首屏只加载海报，25 张合计 360 KB。库里最大的 199 帧 GIF 有 7.0 MB，预览档抽到 23 帧后为 188 KB。</span></div></section>' +
      '<section class="sec">' + secHead('性能预算', { plain: true }) + '<div class="card" style="overflow-x:auto"><table class="ptable"><thead><tr><th>指标</th><th>预算</th><th>手段</th></tr></thead><tbody>' +
      [['首屏 JS（gzip）', '≤ 110 KB', 'React 19 + 路由 + 页面代码；后台、评论、单张弹窗按路由和交互懒加载'], ['首屏 CSS', '≤ 30 KB', '剥离组件库字体，按页拆分'], ['字体', '≤ 150 KB / 页', '标题圆体切片；正文系统字体'], ['LCP', '≤ 2.5 s（4G 手机）', 'SSR + 边缘缓存 HTML（游客）+ 海报预加载'], ['CLS', '≤ 0.02', '所有图片在库里存宽高，瀑布流按比例预排'], ['INP', '≤ 150 ms', '虚拟滚动；同时播放的动图 ≤ 4 张'], ['单页请求', '≤ 40 个', '无第三方脚本；图标内联 SVG']].map((r) => '<tr><td><b>' + r[0] + '</b></td><td class="num">' + r[1] + '</td><td>' + r[2] + '</td></tr>').join('') + '</tbody></table></div></section>' +
      '<section class="sec">' + secHead('图标', { plain: true, sub: '2px 圆角描边。生产环境优先用 naive-icons（163 个），缺的（如退出登录）按同样规格补画' }) + '<div class="card" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:10px">' + Object.keys(ICONS).map((k) => '<div style="display:grid;justify-items:center;gap:4px;color:var(--tp-ink)">' + ic(k, 'lg') + '<small class="mono" style="font-size:10.5px;color:var(--tp-muted)">' + k + '</small></div>').join('') + '</div></section></div>', { noAnn: true });
  },
  notes: {
    goal: '统一的视觉语言与实现约束。所有页面只引用这里的令牌、组件和动效。',
    parts: ['设计来源：animal-island-ui（MIT）的令牌和组件规格', '调整：主按钮文字改深青保证对比度；焦点环改为棕色描边加黄色外晕；去掉组件库自带的中文字体', '组件映射：全部组件基于 Base UI 自建，只沿用 animal-island-ui 的令牌、形状与动效规格，运行时零依赖（它的全局样式会带入 3.4 MB 中文字体，Drawer 服务端渲染报错，Notification 在 React 19 下失效）'],
    motion: ['捏一捏、潮汐涟漪、加入打包（飞入页头按钮）、声纹加载、叶片摆动'],
    data: ['令牌导出为 tokens.css，后台与前台共用'],
    perf: ['图片四档：原图、海报 p240、预览 a160、完整 WebP', '性能预算表见本页'],
    mobile: ['所有组件在 760px 容器宽度以下切换为手机样式']
  },
  demos: [['夜潮主题（深色令牌）', 'night'], ['减少动效', 'still']]
});
