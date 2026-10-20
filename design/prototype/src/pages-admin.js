// ---------- admin pages ----------
const R = rng(20261020);
const dl30 = Array.from({ length: 30 }, (_, i) => Math.round(5200 + Math.sin(i / 3.2) * 1300 + R() * 1600 + i * 60));
const vis30 = dl30.map((v) => Math.round(v * (0.42 + R() * 0.08)));
const days = Array.from({ length: 30 }, (_, i) => { const d = new Date(Date.UTC(2026, 8, 21 + i)); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); });
const ahead = (t, p, acts) => '<div class="adm-h"><div><h1>' + t + '</h1>' + (p ? '<p>' + p + '</p>' : '') + '</div>' + (acts ? '<div class="acts">' + acts + '</div>' : '') + '</div>';
const panel = (t, inner, acts, cls) => '<section class="panel' + (cls ? ' ' + cls : '') + '"><div class="panel-h"><h3>' + t + '</h3>' + (acts ? '<div class="acts">' + acts + '</div>' : '') + '</div><div class="panel-b' + (/flush/.test(cls || '') ? ' flush' : '') + '">' + inner + '</div></section>';
const st = (cls, t) => '<span class="st ' + cls + '">' + t + '</span>';
const sel = (t) => '<span class="sel">' + t + ic('down') + '</span>';

PAGES.push({ id: 'a-dash', group: 'adm', title: '仪表盘', route: '/admin', fid: 'hi',
  render(ctx) {
    const top = PACKS.slice(0, 6), max = top[0].dl, role = ctx.S.role || 'admin';
    const todo = [['inbox', '待审投稿', PENDING_SUBS, 'a-review', '最早一条 14 小时前'], ['chat', '待审评论', 12, 'a-comments', '最早一条 3 小时前'], ['flag', '被举报的评论', 3, 'a-comments', '需要处理']];
    return adminShell(ctx, 'a-dash', ['管理台', '仪表盘'],
      ahead('早上好，' + (role === 'admin' ? '站长' : '海风'), '数据截至 2026-10-20 04:45（示例数据，图表为演示）', btn('处理投稿', { cls: 'primary sm', icon: 'inbox', go: 'a-review' }) + btn('上传表情包', { cls: 'sm', icon: 'upload', go: 'a-upload' })) +
      '<div class="kpis">' + kpi('今日下载', '8,432', '12.4%', { icon: 'download', spark: dl30.slice(-12) }) + kpi('今日访客', '3,904', '6.1%', { icon: 'users', spark: vis30.slice(-12) }) + kpi('待审投稿', String(PENDING_SUBS), null, { icon: 'inbox', note: '来自 4 位投稿者', alert: true }) +
      kpi('待审评论', '12', null, { icon: 'chat', note: '最早一条 3 小时前' }) + kpi('R2 读操作', '41.2<small>万</small>', null, { icon: 'cloud', note: '本月 1,108 万 · 免费额度 1,000 万' }) + kpi('新注册', '57', '3.2%', { icon: 'user', down: true }) + '</div>' +
      '<div class="alert-box">' + ic('warn') + '<div><b>分类数据还有 41 个角色和 8 个画师使用哈希 slug</b><span class="muted">例如 submission-term-51a9fdce…，影响公开链接与搜索。建议先合并「男漂泊者 / 女漂泊者 / 漂泊者」。</span></div>' + btn('去清洗', { cls: 'sm', go: 'a-chars' }) + '</div>' +
      '<div class="cols-2">' + panel('近 30 天下载与访客', '<div class="legend"><span><i style="background:var(--tp-teal-press)"></i>下载</span><span><i style="background:var(--c-orange)"></i>访客</span></div>' + areaChart(dl30, { series2: vis30, labels: days, label: '近 30 天下载量，最近一天 ' + dl30[29] }), seg([['30', '30 天'], ['7', '7 天'], ['1', '今天']], '30', 'noop', 'sm')) +
      panel('待处理', '<div class="feed">' + todo.map((t) => '<a class="it" href="#" data-go="' + t[3] + '"><span class="dot">' + ic(t[0]) + '</span><div><b>' + t[1] + '</b><div class="muted">' + t[4] + '</div></div><span class="badge-dot" style="position:static">' + t[2] + '</span></a>').join('') + '</div>') + '</div>' +
      '<div class="cols-2e">' + panel('今日最热的包', '<div class="barlist">' + top.map((p) => '<div class="row"><img src="' + IMG(p.cover) + '" alt=""><div><div class="t">' + esc(p.title) + '</div><div class="b"><i style="width:' + (p.dl / max * 100).toFixed(0) + '%"></i></div></div><span class="v">' + fmtW(Math.round(p.dl / 36)) + '</span></div>').join('') + '</div>') +
      panel('最近动态', '<div class="feed">' + AUDIT.slice(0, 5).map((a) => '<div class="it"><span class="dot">' + ic(a.act.startsWith('comment') ? 'chat' : a.act.startsWith('user') ? 'ban' : a.act.startsWith('backup') ? 'db' : a.act.startsWith('character') ? 'merge' : 'edit') + '</span><div><b>' + a.who + '</b> ' + a.act + ' <span class="muted">' + esc(a.obj) + '</span></div><time>' + a.t + '</time></div>').join('') + '</div>') + '</div>');
  },
  notes: { goal: '一屏看清今天的下载与访客、待处理的投稿和评论，以及从哪里继续工作。站长与管理员共用，系统类入口只对站长显示。', parts: ['6 张 KPI：下载、访客、待审投稿、待审评论、R2 读操作（按次计费）、新注册', '「待处理」面板直达投稿审核与评论审核', '数据清洗告警直接链到角色合并工具'], motion: ['KPI 数字不做滚动动画'], data: ['GET /api/admin/overview：聚合自 downloads_daily、visits_daily', 'R2 读操作来自风控统计（每签发一次原图链接计 1 次）'], perf: ['后台路由独立代码分割；图表是手写 SVG'], mobile: ['KPI 两列，图表全宽，侧栏收进菜单'] },
  demos: [['切换为管理员视角', 'role-manager'], ['夜潮主题', 'night']]
});

PAGES.push({ id: 'a-review', group: 'adm', title: '投稿审核', route: '/admin/review', fid: 'hi',
  render(ctx) {
    const tab = ctx.F.rtab || 'pending';
    const list = tab === 'pending' ? SUBMISSIONS.filter((x) => x.st === '审核中') : SUBMISSIONS.filter((x) => (tab === 'back' ? x.st === '已退回' : x.st === '已发布'));
    const kindCls = { '新包': 'info', '补充表情': 'ok', '修改已发布': 'warn' };
    const checks = (x) => [['无重复图片（SHA-256）', 1], ['画师与授权已填写', x.who ? 1 : 0], ['授权凭证', x.proof ? 1 : 0], [x.lic === '官方版权' ? '官方表情已设为只提供预览' : '许可：' + (x.lic || '—'), x.lic === '官方版权' ? (x.dl ? 0 : 1) : 1]];
    const card = (x) => '<div class="rv"><div class="rv-media">' + (x.imgs || [x.img]).slice(0, 4).map((img) => '<img src="' + IMG(img) + '" width="240" height="240" alt="" loading="lazy">').join('') + '</div>' +
      '<div class="rv-main"><div class="rv-h"><b>' + esc(x.t) + '</b><span class="st ' + (kindCls[x.kind] || 'mute') + '">' + x.kind + '</span>' + (x.n ? '<span class="pill-stat">' + x.n + ' 张</span>' : '') + '</div>' +
      '<div class="hint">投稿者 <b style="color:var(--tp-ink)">' + esc(x.by) + '</b> · 已通过 ' + (x.past || 0) + ' 次 · ' + x.time + '</div>' +
      (x.diff ? '<div class="diff">' + x.diff[0] + '：<span class="del">' + esc(x.diff[1]) + '</span> → <span class="add">' + esc(x.diff[2]) + '</span><div class="hint">审核通过前，线上仍显示旧版本</div></div>' : '') +
      '<dl class="rv-lic"><dt>身份</dt><dd>' + (x.who || '—') + '</dd><dt>许可</dt><dd>' + (x.lic || '—') + '</dd><dt>凭证</dt><dd>' + (x.proof ? '<a href="#" style="color:var(--tp-teal-ink);font-weight:800">查看截图</a>' : '<span class="hint err">未提供</span>') + '</dd><dt>下载</dt><dd>' + (x.dl === false ? '只提供预览' : '允许') + '</dd></dl>' +
      '<div class="rv-checks">' + checks(x).map((c) => '<span class="' + (c[1] ? 'ok' : 'no') + '">' + ic(c[1] ? 'check' : 'warn', 'sm') + c[0] + '</span>').join('') + '</div>' +
      (x.note ? '<div class="note-box warn">' + ic('info', 'sm') + '<span>退回原因：' + esc(x.note) + '</span></div>' : '') + '</div>' +
      '<div class="rv-acts">' + (tab === 'pending' ? btn('通过并发布', { cls: 'primary sm', icon: 'check', act: 'approve' }) + btn('退回修改', { cls: 'sm', icon: 'reply', act: 'reject' }) : '') + btn('预览', { cls: 'ghost sm', icon: 'eye', go: 'pack' }) + '</div></div>';
    return adminShell(ctx, 'a-review', ['管理台', '内容', '投稿审核'],
      ahead('投稿审核', '所有注册用户都能投稿；站长与管理员在这里审核。通过后立即发布，退回时附上原因。') +
      '<div class="tabs" role="tablist">' + [['pending', '待审核', PENDING_SUBS], ['ok', '已通过', 128], ['back', '已退回', 9]].map((t) => '<button role="tab" data-act="rtab" data-v="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + t[1] + '<span class="n">' + t[2] + '</span></button>').join('') + '</div>' +
      '<div class="cols-2"><section class="panel"><div class="panel-b flush">' + (list.length ? list.map(card).join('') : '<div class="empty"><h3>没有待处理的投稿</h3></div>') + '</div></section>' +
      panel('审核要点', '<ul class="rules"><li>画师、约稿人与授权说明写清楚；没有凭证时可以退回补充。</li><li>同一组风格的表情放在同一个包里。</li><li>官方表情可以收录，但「允许下载」必须关闭。</li><li>修改已发布的包会生成新版本，通过后替换线上内容。</li></ul>' +
        '<div class="field" style="margin-top:12px"><div class="lab">退回原因模板</div><div class="chips">' + ['缺少画师授权说明', '与已有包重复', '与鸣潮无关', '标题或角色不规范'].map((t) => chip(t, { sm: true })).join('') + '</div></div>' +
        '<div class="rule-row" style="margin-top:6px"><div><b>可信投稿者免审</b><small>在「用户与权限」里对单个用户开启</small></div>' + btn('去设置', { cls: 'xs', go: 'a-users' }) + '</div>') + '</div>');
  },
  notes: { goal: '投稿对所有用户开放后，审核是管理员的主要工作：一条投稿一张卡，信息够做决定，操作在右侧。', parts: ['三类投稿：新包、补充表情、修改已发布（附改动对比）', '每条显示投稿者历史、授权声明与自动检查结果', '通过并发布 / 退回修改（附原因模板）/ 预览'], motion: ['处理完的卡片向上收起'], data: ['submissions（kind: new_pack | add_emojis | edit_pack；status: draft | pending | approved | returned | withdrawn），payload 保存提议的修改', '通过时在一个事务里应用 payload 并写审计日志，预览图从 review/v1/ 复制到 derived/v1/', '修改已发布的包时校验基准版本 base_updated_at，期间被改过则需重新提交', '通过时由审核人确认「允许下载」开关'], perm: ['站长、管理员可审核；免审只能由站长在「用户与权限」里设置'], perf: ['列表按提交时间分页'], mobile: ['卡片纵向排列，操作按钮在卡片底部'] },
  demos: [['已退回', 'rtab-back'], ['切换为管理员视角', 'role-manager']]
});

PAGES.push({ id: 'a-packs', group: 'adm', title: '表情包管理', route: '/admin/packs', fid: 'hi',
  render(ctx) {
    const rows = PACKS.slice(0, 10);
    const status = (i) => (i === 2 ? st('warn', '定时 10-21 12:00') : i === 5 ? st('mute', '草稿') : i === 7 ? st('err', '已隐藏') : st('ok', '已发布'));
    const selected = new Set([1, 3]);
    return adminShell(ctx, 'a-packs', ['管理台', '内容', '表情包'],
      ahead('表情包', '309 个已发布 · 1 个只有元数据 · 4 个草稿', btn('导入 ZIP', { cls: 'sm', icon: 'upload', go: 'a-upload' }) + btn('新建表情包', { cls: 'primary sm', icon: 'plus', go: 'a-pack-edit' })) +
      '<div class="filters">' + input('标题、packKey、角色', { icon: 'search', cls: 'sm', id: 'ap-q-' + ctx.f }) + sel('状态：全部') + sel('类型：全部') + sel('角色：全部') + sel('分组：全部') + sel('排序：更新时间') + '</div>' +
      '<div class="bulk"><b>2</b> 个已选' + btn('发布', { cls: 'sm' }) + btn('隐藏', { cls: 'sm' }) + btn('设置分组', { cls: 'sm' }) + btn('重建 ZIP', { cls: 'sm' }) + btn('删除', { cls: 'sm', attr: ' style="color:var(--tp-err)"' }) + '</div>' +
      panel('列表', '<div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:36px"></th><th>表情包</th><th class="col-opt">角色</th><th class="n">张数</th><th>状态</th><th class="n col-opt">下载</th><th class="col-opt">更新</th><th></th></tr></thead><tbody>' +
        rows.map((p, i) => '<tr class="' + (selected.has(i) ? 'is-sel' : '') + '"><td>' + check('', selected.has(i)) + '</td><td><div class="cell"><img class="th-img" src="' + IMG(p.cover) + '" alt=""><div style="min-width:0"><b>' + esc(p.title) + '</b><small>' + p.key + '</small></div></div></td><td class="col-opt">' + p.chars.slice(0, 2).map((n) => tag(esc(n), (CHAR_BY[n] || charOf(n)).color)).join(' ') + '</td><td class="n">' + p.count + '</td><td>' + status(i) + '</td><td class="n col-opt">' + fmtW(p.dl) + '</td><td class="col-opt muted">' + p.date.slice(5) + '</td><td><div class="row-acts"><button class="ibtn" data-go="a-pack-edit" aria-label="编辑">' + ic('edit') + '</button><button class="ibtn" data-go="pack" aria-label="预览">' + ic('eye') + '</button><button class="ibtn" aria-label="更多">' + ic('more') + '</button></div></td></tr>').join('') +
        '</tbody></table></div><div class="pager"><span>第 1–10 条，共 314 条</span><button class="is-on">1</button><button>2</button><button>3</button><span>…</span><button>32</button></div>', null, 'flush'));
  },
  notes: { goal: '日常维护入口：找包、批量改状态、预约发布、重建 ZIP。', parts: ['状态：已发布、草稿、定时、已隐藏', '批量操作条在选中后出现', 'packKey 显示在标题下，作为不可变的存储键'], motion: ['行悬停底色'], data: ['GET /api/admin/packs?status=&q=&page=', 'PATCH /api/admin/packs/bulk'], perf: ['服务端分页'], mobile: ['只保留标题、张数、状态三列'] },
  demos: []
});

PAGES.push({ id: 'a-pack-edit', group: 'adm', title: '表情包编辑', route: '/admin/packs/aimisi-01', fid: 'hi',
  render(ctx) {
    const d = DETAIL;
    return adminShell(ctx, 'a-packs', ['管理台', '表情包', d.title],
      ahead('编辑表情包', null, btn('预览', { cls: 'sm', icon: 'eye', go: 'pack' }) + btn('保存并发布', { cls: 'primary sm', icon: 'check' })) +
      '<div class="cols-2"><div style="display:grid;gap:18px">' +
      panel('基本信息', '<div class="form-grid">' + field('标题', input('', { v: d.title, id: 'pe-t-' + ctx.f }), { cls: 'full' }) + field('packKey', input('', { v: 'aimisi-01', id: 'pe-k-' + ctx.f, tail: '<span class="locked">' + ic('lock', 'sm') + '存储键，不可改</span>' })) + field('URL slug', input('', { v: 'aimisi-ban-pai', id: 'pe-s-' + ctx.f }), { hint: '修改后旧地址自动 301' }) +
        field('简介', '<textarea class="textarea" id="pe-x-' + ctx.f + '" style="min-height:80px">' + esc(d.excerpt) + '</textarea>', { cls: 'full' }) + field('发布状态', seg([['pub', '已发布'], ['draft', '草稿'], ['sched', '定时']], 'pub', 'noop', 'sm')) + field('置顶级别', seg([['0', '无'], ['1', '1'], ['2', '2'], ['3', '3']], '0', 'noop', 'sm')) + '</div>') +
      panel('分类', '<div class="form-grid">' + field('角色', '<div class="chips">' + chip('爱弥斯', { sm: true, on: true, x: true, av: AV('爱弥斯'), cc: 'var(--c-pink)' }) + chip('添加角色', { sm: true, icon: 'plus' }) + '</div>', { cls: 'full' }) +
        field('画师', '<div class="chips">' + chip(d.artists[0] || '', { sm: true, on: true, x: true }) + chip('添加', { sm: true, icon: 'plus' }) + '</div>') + field('分组 · 工具 · 企划', '<div class="chips">' + chip('表情图鉴', { sm: true, on: true, x: true }) + chip('添加', { sm: true, icon: 'plus' }) + '</div>') + '</div>') +
      panel('署名与许可', '<div class="form-grid">' + '<div class="full set-row" style="padding:12px 14px"><div><b>允许下载</b><small>关闭后只提供预览（官方转载默认关闭）。投稿者：今州打工人 · 2026-08-06 审核通过</small></div>' + sw('', true, 'noop') + '</div>' + field('许可协议', '<span class="sel" style="width:100%;justify-content:space-between">CC BY-NC-SA 4.0' + ic('down') + '</span>') + field('约稿人', input('', { v: '群聊「爱弥一生一世」', id: 'pe-c-' + ctx.f })) + field('众筹名单', '<textarea class="textarea" id="pe-l-' + ctx.f + '" style="min-height:70px">' + CROWD.join('、') + '</textarea>', { cls: 'full', hint: '每行或用顿号分隔；会写入 CREDITS.txt' }) + '</div>') +
      panel('表情排序 · 25 张', '<div class="sort-grid">' + d.emojis.slice(0, 14).map((e, i) => '<div class="sort-it' + (i === 0 ? ' is-cover' : '') + (i === 5 ? ' is-drag' : '') + (i === 6 ? ' ghost' : '') + '">' + (i === 6 ? '' : '<span class="h">' + ic('drag') + '</span>' + (i === 0 ? '<span class="star">' + ic('star') + '</span>' : '') + '<img src="' + IMG(e.img) + '" alt=""><span class="ix">' + (i + 1) + '</span>') + '</div>').join('') + '<div class="sort-it ghost" style="color:var(--tp-muted);font-weight:800;font-size:12px;text-align:center">' + ic('plus') + '上传</div></div>', '<span class="hint">拖动排序 · 星标为封面</span>') +
      '<div class="savebar"><span class="grow">有 3 处未保存的修改：标题、众筹名单、排序</span>' + btn('放弃', { cls: 'ghost sm', attr: ' style="color:#cfe9e4"' }) + btn('保存', { cls: 'primary sm', icon: 'check' }) + '</div></div>' +
      '<aside style="display:grid;gap:18px">' + panel('前台预览', packCard(Object.assign({}, PACKS[0], { pin: 0, title: d.title, key: 'aimisi-01', count: 25, cover: d.emojis[0].img, minis: d.emojis.slice(1, 4).map((e) => e.img), chars: ['爱弥斯'], artists: d.artists, dl: d.dl, fav: d.fav, date: d.date, acc: 'var(--c-pink)' }), 0, { variant: 'four' })) +
      panel('下载包', '<dl class="kv"><dt>ZIP</dt><dd>' + st('ok', '已生成') + '</dd><dt>大小</dt><dd class="num">' + fmtB(d.bytesTotal) + '</dd><dt>生成于</dt><dd class="num">10-20 10:45</dd><dt>对象键</dt><dd class="mono" style="font-size:11px">zips/v1/packs/aimisi-01/aimisi-01.3f9a1c.zip</dd></dl><div style="margin-top:12px">' + btn('重新生成', { cls: 'sm block', icon: 'refresh' }) + '</div>') +
      panel('衍生图（网页显示用 WebP）', '<dl class="kv"><dt>静态海报 p240</dt><dd>' + st('ok', '25 / 25') + '</dd><dt>动图预览 a160</dt><dd>' + st('ok', '25 / 25') + '</dd><dt>弹窗动图 full</dt><dd>' + st('mute', '首次查看时生成') + '</dd></dl>') +
      panel('危险操作', '<div style="display:grid;gap:8px">' + btn('隐藏此包', { cls: 'sm block', icon: 'eye' }) + btn('删除此包', { cls: 'sm block', icon: 'trash', attr: ' style="color:var(--tp-err)"', act: 'confirm-del' }) + '<span class="hint">删除后 R2 对象进入 7 天回收期</span></div>') + '</aside></div>');
  },
  notes: { goal: '一个页面完成包的全部编辑：元数据、分类、署名、排序、封面、ZIP 与衍生图状态。', parts: ['packKey 只读（R2 存储键），URL slug 可改并自动 301', '署名与许可单独成块，写入 CREDITS.txt', '拖拽排序网格：星标封面、拖动中卡片倾斜', '右侧实时预览前台卡片；底部未保存提示条'], motion: ['拖动中卡片 -4° 倾斜并抬起'], data: ['PATCH /api/admin/packs/:id；排序 PUT /api/admin/packs/:id/order', '保存后入队 zip.build（单例键 = packId）'], perf: ['排序网格只渲染海报'], mobile: ['右侧栏移到表单下方；保存条固定在底部'] },
  demos: [['删除确认', 'confirm-del']]
});

PAGES.push({ id: 'a-upload', group: 'adm', title: '上传中心', route: '/admin/upload', fid: 'hi',
  render(ctx) {
    const pipe = (ss) => '<div class="pipe">' + ['直传 R2', '校验', '去重', '读尺寸', '海报', '预览', '入库'].map((t, k) => '<span class="' + (ss[k] || '') + '">' + t + '</span>').join('') + '</div>';
    const files = [
      ['爱弥斯_新年_01.gif', '1.4 MB', 'ok,ok,ok,ok,ok,ok,ok', st('ok', '完成'), 100],
      ['爱弥斯_新年_02.gif', '2.1 MB', 'ok,ok,ok,ok,ok,run', st('info run', '生成预览'), 82],
      ['爱弥斯_新年_03.gif', '0.9 MB', 'ok,ok,skip', st('warn', '重复，已跳过'), 100],
      ['爱弥斯_新年_04.png', '146 KB', 'ok,err', st('err', '格式错误'), 30],
      ['爱弥斯_新年_05.gif', '3.8 MB', 'run', st('info run', '上传中'), 46]
    ];
    return adminShell(ctx, 'a-upload', ['管理台', '内容', '上传中心'],
      ahead('上传中心', '管理员直接上传到任意包；普通用户在前台「投稿」上传到自己的包，签发上传地址前校验归属') +
      '<div class="drop is-over"><span class="drop-ico">' + ic('upload', 'lg') + '</span>' + '<div><b>把 GIF、PNG、WebP 或 ZIP 拖到这里</b><p>单个文件不超过 20 MB；ZIP 会自动解开。上传目标：<b style="font-size:14px">爱弥斯 · 新年板牌（草稿）</b></p></div>' + btn('选择文件', { cls: 'primary', icon: 'upload' }) + '</div>' +
      '<div class="kpis">' + kpi('本批文件', '48', null, { note: '来自 2 个 ZIP' }) + kpi('已完成', '31', null, { note: '已生成三种衍生图' }) + kpi('重复', '3', null, { note: 'SHA-256 命中已有表情' }) + kpi('失败', '1', null, { note: '可重试或移除', alert: true }) + '</div>' +
      panel('处理队列', '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>文件</th><th class="n col-opt">大小</th><th>流水线</th><th>状态</th><th class="col-opt">进度</th><th></th></tr></thead><tbody>' +
        files.map((f, k) => '<tr><td><div class="cell"><img class="th-img" src="' + IMG(EMO[k + 10].img) + '" alt=""><b>' + f[0] + '</b></div></td><td class="n col-opt">' + f[1] + '</td><td>' + pipe(f[2].split(',')) + '</td><td>' + f[3] + '</td><td class="col-opt"><div class="mini-prog" style="--p:' + f[4] + '%"><i></i></div></td><td><div class="row-acts"><button class="ibtn" aria-label="重试">' + ic('refresh') + '</button><button class="ibtn" aria-label="移除">' + ic('close') + '</button></div></td></tr>').join('') +
        '</tbody></table></div>', btn('全部发布到包', { cls: 'sm primary', icon: 'check' }), 'flush') +
      '<div class="note-box">' + ic('info', 'sm') + '<span>流程：浏览器向 /api/admin/uploads 申请预签名 PUT → 直传 <span class="mono">uploads/tmp/2026/10/20/&lt;uploadId&gt;/</span> → pg-boss 任务校验 MIME 与尺寸、计算 SHA-256 去重、选海报帧、生成 p240 与 a160 预览（≤24 帧，写入 <span class="mono">review/v1/</span>，发布时复制到 <span class="mono">derived/v1/</span>）→ 原图写到 assets/v1/packs/&lt;packKey&gt;/emojis/ 并写库；full 档在首次查看时生成。worker 图片并发为 1。暂存区 7 天后由生命周期规则清理。</span></div>');
  },
  notes: { goal: '让后续的增删改查不再依赖脚本：拖进来就能入库，过程可见，失败可重试。', parts: ['拖放区（拖入时变青色）', '每个文件一条 7 步流水线：直传、校验、去重、读尺寸、海报、预览、入库', '重复文件用 SHA-256 识别并跳过'], motion: ['运行中的状态点闪烁'], data: ['POST /api/admin/uploads 返回预签名 URL；完成后 POST /api/admin/uploads/:id/complete 入队', '任务结果写 upload_items 表，前端轮询或 SSE'], perf: ['大文件不经过应用服务器；sharp 在 worker 容器里运行'], mobile: ['拖放区改为「选择文件」按钮，表格隐藏大小与进度列'] },
  demos: []
});

PAGES.push({ id: 'a-emojis', group: 'adm', title: '表情库', route: '/admin/emojis', fid: 'hi',
  render(ctx) {
    const e = EMO[5];
    if (!ctx.F.noDrawer) ctx.layer.push('<aside class="drawer" style="width:min(400px,92%)" aria-label="表情详情"><span class="grab"></span><div class="drawer-h"><h3>表情详情</h3><button class="icon-btn x" data-act="close-drawer" aria-label="关闭">' + ic('close') + '</button></div><div class="drawer-b">' +
      '<div class="card sand" style="display:grid;place-items:center"><img src="' + IMG(e.anim || e.img) + '" width="200" height="200" alt=""></div>' +
      '<dl class="kv"><dt>ID</dt><dd class="mono">' + e.id + '</dd><dt>所属包</dt><dd>aimisi-01</dd><dt>原图</dt><dd>GIF · ' + e.w + '×' + e.h + ' · ' + e.frames + ' 帧 · ' + fmtB(e.bytes) + '</dd><dt>SHA-256</dt><dd class="mono" style="font-size:11px">3f9a1c…e81d</dd><dt>对象键</dt><dd class="mono" style="font-size:11px">assets/v1/packs/aimisi-01/emojis/' + e.id + '.gif</dd><dt>存储包</dt><dd class="mono" style="font-size:11px">aimisi-01（不可变，改归属不搬文件）</dd></dl>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>衍生图（derived/v1/）</th><th class="n">大小</th><th>状态</th></tr></thead><tbody><tr><td>海报 p240</td><td class="n">16 KB</td><td>' + st('ok', '最新') + '</td></tr><tr><td>预览 a160</td><td class="n">109 KB</td><td>' + st('ok', '最新') + '</td></tr><tr><td>完整 full</td><td class="n">—</td><td>' + st('mute', '首次查看时生成') + '</td></tr></tbody></table></div>' +
      field('角色', '<div class="chips">' + chip('爱弥斯', { sm: true, on: true, x: true }) + chip('添加', { sm: true, icon: 'plus' }) + '</div>') + field('海报帧', '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="st info">第 14 / 28 帧 · 自动（熵最高）</span>' + btn('改用其他帧', { cls: 'xs' }) + '</div>', { hint: '在第 0、¼、½、¾ 帧中自动挑选，可手动指定；修改后 variant_rev 加 1，URL 随之变化' }) +
      '</div><div class="drawer-f" style="grid-template-columns:1fr 1fr 1fr">' + btn('重新生成', { cls: 'sm', icon: 'refresh' }) + btn('替换文件', { cls: 'sm', icon: 'upload' }) + btn('删除', { cls: 'sm', icon: 'trash', attr: ' style="color:var(--tp-err)"' }) + '</div></aside>');
    return adminShell(ctx, 'a-emojis', ['管理台', '内容', '表情库'],
      ahead('表情库', '15,272 张 · GIF 12,276 · PNG 2,996', btn('批量重新生成衍生图', { cls: 'sm', icon: 'refresh' })) +
      '<div class="filters">' + input('表情 ID、包、OCR 文字', { icon: 'search', cls: 'sm', id: 'ae-q-' + ctx.f }) + sel('包：aimisi-01') + sel('角色：全部') + sel('格式：全部') + sel('衍生图：需更新') + sel('形状：全部') + seg([['g', '', 'grid'], ['l', '', 'list']], 'g', 'noop', 'sm') + '</div>' +
      '<div class="bulk"><b>3</b> 张已选' + btn('移动到包', { cls: 'sm' }) + btn('设置角色', { cls: 'sm' }) + btn('重新生成', { cls: 'sm' }) + btn('删除', { cls: 'sm', attr: ' style="color:var(--tp-err)"' }) + '</div>' +
      '<div class="grid-tiles is-selecting t110">' + EMO.map((x, i) => tile(x, i, { sel: new Set([2, 5, 9]), act: 'noop' })).join('') + '</div>');
  },
  notes: { goal: '按单张表情管理：移动、改角色、补 OCR 文字、重建衍生图、替换文件。', parts: ['方格多选 + 批量条', '右侧详情抽屉：原图信息、对象键、SHA-256、三种衍生图状态', '「衍生图：需更新」筛选用于规格升级后批量重建'], motion: ['抽屉右侧滑入'], data: ['GET /api/admin/emojis?pack=&character=&variant_status=', 'POST /api/admin/emojis/:id/regenerate 入队 variants.generate'], perf: ['列表只取海报地址'], mobile: ['抽屉改为底部面板'] },
  demos: []
});

PAGES.push({ id: 'a-chars', group: 'adm', title: '角色管理', route: '/admin/characters', fid: 'std',
  render(ctx) {
    const rows = [['爱弥斯', 'aimisi', true, 39, 1640, 'pink'], ['菲比', 'term-9646024ba03ca7d0a6fe2d94', false, 18, 930, 'blue'], ['莫宁', 'term-8cb24287d1d23c2248be5591', false, 17, 852, 'lime'], ['漂泊者', 'rover', true, 24, 934, 'brown'], ['男漂泊者', 'submission-term-f5269ada382dd306c431e627', false, 5, 0, 'brown'], ['女漂泊者', 'submission-term-51a9fdce201ca47f0ec7d279', false, 4, 0, 'brown'], ['豚仔', 'submission-term-272f948f783562c54fb185d2', false, 5, 0, 'blue']];
    return adminShell(ctx, 'a-chars', ['管理台', '内容', '角色'],
      ahead('角色', '70 个角色 · 41 个哈希 slug 待清洗 · 3 组疑似重复', btn('合并角色', { cls: 'sm', icon: 'merge', act: 'merge' }) + btn('新建角色', { cls: 'primary sm', icon: 'plus' })) +
      panel('合并：男漂泊者、女漂泊者 → 漂泊者', '<div class="merge-flow"><div class="card"><div style="display:flex;gap:8px"><span class="avatar" style="border-color:var(--c-brown)">男</span><span class="avatar" style="border-color:var(--c-brown)">女</span></div><b>男漂泊者 · 女漂泊者</b><span class="hint">9 个包 · 将作为别名保留</span></div><span class="merge-arrow">' + ic('arrow') + '</span><div class="card"><span class="avatar lg"><img src="' + IMG(AV('漂泊者')) + '" alt=""></span><b>漂泊者 <span class="slug-ok">piaobozhe</span></b><span class="hint">合并后 33 个包 · 旧链接 301</span></div></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap">' + check('保留「男漂泊者」「女漂泊者」为子标签', true) + btn('确认合并', { cls: 'primary sm', icon: 'merge' }) + '</div>') +
      panel('角色列表', '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>角色</th><th>slug</th><th class="col-opt">主题色</th><th class="n">包</th><th class="n col-opt">表情</th><th></th></tr></thead><tbody>' +
        rows.map((r) => '<tr><td><div class="cell"><span class="avatar sm" style="border-color:var(--c-' + r[5] + ')">' + (CHAR_BY[r[0]] && CHAR_BY[r[0]].avatar ? '<img src="' + IMG(CHAR_BY[r[0]].avatar) + '" alt="">' : r[0].slice(0, 1)) + '</span><b>' + r[0] + '</b></div></td><td>' + (r[2] ? '<span class="slug-ok">' + r[1] + '</span>' : '<span class="slug-bad">' + r[1].slice(0, 24) + '…</span> <span class="hint">建议 ' + (CHAR_META[r[0]] ? CHAR_META[r[0]][0] : '') + '</span>') + '</td><td class="col-opt"><div class="swatches"><i class="is-on" style="background:var(--c-' + r[5] + ')"></i></div></td><td class="n">' + r[3] + '</td><td class="n col-opt">' + (r[4] ? fmtN(r[4]) : '—') + '</td><td><div class="row-acts"><button class="ibtn" aria-label="编辑">' + ic('edit') + '</button><button class="ibtn" aria-label="合并">' + ic('merge') + '</button></div></td></tr>').join('') + '</tbody></table></div>', null, 'flush') +
      panel('编辑：爱弥斯', '<div class="form-grid">' + field('名称', input('', { v: '爱弥斯', id: 'ac-n-' + ctx.f })) + field('slug（拼音）', input('', { v: 'aimisi', id: 'ac-s-' + ctx.f })) + field('别名', '<div class="chips">' + chip('小爱', { sm: true, x: true }) + chip('爱弥一生一世', { sm: true, x: true }) + chip('添加', { sm: true, icon: 'plus' }) + '</div>') + field('主题色', '<div class="swatches">' + PALETTE.map((c, k) => '<i class="' + (k === 0 ? 'is-on' : '') + '" style="background:var(--c-' + c + ')"></i>').join('') + '</div>') + field('类型', seg([['r', '共鸣者'], ['e', '声骸'], ['m', '吉祥物'], ['n', 'NPC']], 'r', 'noop', 'sm')) + field('头像表情', '<div style="display:flex;gap:10px;align-items:center"><span class="avatar lg"><img src="' + IMG(AV('爱弥斯')) + '" alt=""></span>' + btn('从表情库选择', { cls: 'sm' }) + '</div>') + '</div>'));
  },
  notes: { goal: '解决调研里发现的分类问题：41 个哈希 slug、重复角色、别名分散。', parts: ['合并向导：多个来源 → 目标，展示影响范围与旧链接处理', '哈希 slug 标红并给出拼音建议', '主题色从 13 色岛屿色板中选，驱动前台角色页配色'], motion: ['无'], data: ['POST /api/admin/characters/merge {from:[], to, keepAsAlias}', 'character_aliases、redirects 两张表'], perf: ['—'], mobile: ['合并向导纵向排列'] },
  demos: []
});

PAGES.push({ id: 'a-artists', group: 'adm', title: '画师管理', route: '/admin/artists', fid: 'std',
  render(ctx) {
    return adminShell(ctx, 'a-artists', ['管理台', '内容', '画师'],
      ahead('画师', '结构化画师 12 位，分面画师名 27 个，两套数据在这里合并', btn('新建画师', { cls: 'primary sm', icon: 'plus' })) +
      '<div class="alert-box">' + ic('warn') + '<div><b>疑似同一画师：「春也Huruya」「春也Haruya」「春也」</b><span class="muted">合并后保留拼写变体为别名，署名统一显示为后台设置的正式名。</span></div>' + btn('合并', { cls: 'sm', icon: 'merge' }) + '</div>' +
      panel('画师列表', '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>画师</th><th class="col-opt">别名</th><th class="n">包</th><th class="col-opt">外链</th><th class="col-opt">默认许可</th><th></th></tr></thead><tbody>' +
        DATA.artists.slice(0, 9).map((a, i) => '<tr><td><div class="cell"><span class="avatar sm" style="border-color:var(--c-' + PALETTE[i % 12] + ')">' + esc(a.name.trim().slice(0, 1)) + '</span><b>' + esc(a.name.trim()) + '</b>' + (a.name !== a.name.trim() ? ' <span class="slug-bad">名称含空格</span>' : '') + '</div></td><td class="col-opt muted">' + (i === 2 ? '春也Haruya、春也' : '—') + '</td><td class="n">' + a.packs + '</td><td class="col-opt">' + (i < 3 ? st('ok', 'B 站') : st('mute', '未填写')) + '</td><td class="col-opt">CC BY-NC-SA 4.0</td><td><div class="row-acts"><button class="ibtn" aria-label="编辑">' + ic('edit') + '</button><button class="ibtn" aria-label="合并">' + ic('merge') + '</button></div></td></tr>').join('') + '</tbody></table></div>', null, 'flush'));
  },
  notes: { goal: '署名的数据源。合并拼写变体，补全外链与默认许可。', parts: ['疑似重复提示（编辑距离 + 去空格比较）', '名称含前后空格标红'], motion: ['无'], data: ['artists、artist_aliases'], perf: ['—'], mobile: ['隐藏别名、外链、许可列'] }, demos: []
});

PAGES.push({ id: 'a-tags', group: 'adm', title: '标签与分面', route: '/admin/taxonomy', fid: 'std',
  render(ctx) {
    const dims = [['角色', 69, 'users'], ['画师', 27, 'edit'], ['分组', 2, 'folder'], ['工具', 1, 'sliders'], ['企划', 1, 'star'], ['原设', 2, 'sparkle']];
    return adminShell(ctx, 'a-tags', ['管理台', '内容', '标签与分面'],
      ahead('标签与分面', '源站 115 个 Halo 标签已拆分到 7 个维度', btn('新建维度', { cls: 'sm', icon: 'plus' })) +
      '<div class="kpis">' + dims.map((d) => kpi(d[0], String(d[1]), null, { icon: d[2], note: d[0] === '角色' || d[0] === '画师' ? '由角色、画师表驱动' : '可自由编辑' })).join('') + '</div>' +
      panel('维度：分组', '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>值</th><th>slug</th><th class="n">包</th><th>前台展示</th><th></th></tr></thead><tbody><tr><td><b>站长推荐</b></td><td><span class="slug-ok">zhan-zhang-tui-jian</span></td><td class="n">103</td><td>' + sw('', true, 'noop') + '</td><td><div class="row-acts"><button class="ibtn">' + ic('edit') + '</button></div></td></tr><tr><td><b>表情图鉴</b></td><td><span class="slug-ok">biao-qing-tu-jian</span></td><td class="n">15</td><td>' + sw('', true, 'noop') + '</td><td><div class="row-acts"><button class="ibtn">' + ic('edit') + '</button></div></td></tr><tr><td><b>榕城善良的饺子</b><div class="hint">画师维度</div></td><td><span class="slug-bad">hua-shi-rong-cheng-shan-liang-de-jiao-zi-V1zKOMYk</span></td><td class="n">8</td><td>' + sw('', false, 'noop') + '</td><td><div class="row-acts"><button class="ibtn">' + ic('merge') + '</button></div></td></tr></tbody></table></div>', seg([['g', '分组'], ['t', '工具'], ['p', '企划'], ['o', '原设']], 'g', 'noop', 'sm'), 'flush'));
  },
  notes: { goal: '把 Halo 标签「角色/xx」「画师/xx」这种前缀约定变成真正的维度。', parts: ['每个维度一张 KPI 卡', '重复后缀 slug 标红，可合并'], motion: ['无'], data: ['facet_dimensions、facet_values、pack_facets'], perf: ['—'], mobile: ['KPI 两列'] }, demos: []
});

PAGES.push({ id: 'a-comments', group: 'adm', title: '评论审核', route: '/admin/comments', fid: 'hi',
  render(ctx) {
    const tab = ctx.F.qtab || 'pending';
    return adminShell(ctx, 'a-comments', ['管理台', '社区', '评论审核'],
      ahead('评论审核', '新用户首评、含外链、命中屏蔽词或被举报的评论进入队列；其余直接公开') +
      '<div class="tabs" role="tablist">' + [['pending', '待审核', 12], ['reported', '被举报', 3], ['spam', '垃圾', 48], ['ok', '已通过', '1.2k'], ['del', '已删除', 31]].map((t) => '<button role="tab" data-act="qtab" data-v="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + t[1] + '<span class="n">' + t[2] + '</span></button>').join('') + '</div>' +
      '<div class="cols-2">' + panel('队列', QUEUE.map((q) => '<div class="qcard"><span class="avatar sm" style="border-color:var(--c-' + q.c + ')">' + esc(q.u.slice(0, 1)) + '</span><div><div class="cmt-h"><b>' + esc(q.u) + '</b>' + (q.g ? '<span class="role op">游客</span>' : '') + '<time>' + q.time + '</time><span class="muted">评论于「' + esc(q.pack) + '」</span></div><div class="cmt-b" style="margin-top:4px"><div>' + esc(q.body) + '</div>' + (q.stk ? '<div class="stk">' + q.stk.map((s) => '<img src="' + IMG(s) + '" alt="">').join('') + '</div>' : '') + '</div><div class="why">' + q.why.map((w) => '<span>' + w + '</span>').join('') + '</div><div class="hint mono" style="margin-top:4px">IP 哈希 7c1e…09 · 首次出现</div></div>' +
        '<div class="acts">' + btn('通过', { cls: 'xs', icon: 'check' }) + btn('垃圾', { cls: 'xs', icon: 'ban' }) + btn('删除', { cls: 'xs', icon: 'trash' }) + '</div></div>').join(''), check('全选', false) + btn('批量通过', { cls: 'xs' }), 'flush') +
      panel('审核规则', ['新用户首条评论需审核', '游客评论需通过 Cap 验证', '含 2 个以上链接进入队列', '编辑时限 10 分钟，删除保留墓碑'].map((r, k) => '<div class="rule-row"><div><b>' + r + '</b><small>' + ['注册不满 24 小时或首次发言', '登录用户默认免验证', '链接一律加 nofollow ugc', '与 Ecoku 一致，保持回复上下文'][k] + '</small></div>' + sw('', true, 'noop') + '</div>').join('') +
        '<div class="field" style="margin-top:12px"><div class="lab">屏蔽词<small>支持通配符</small></div><div class="chips">' + ['出号', '代练', '加群*', 'v信'].map((w) => chip(w, { sm: true, x: true })).join('') + chip('添加', { sm: true, icon: 'plus' }) + '</div></div>' +
        '<div class="field" style="margin-top:12px"><div class="lab">回应贴纸<small>前台评论下的 6 个回应</small></div><div style="display:flex;gap:6px;flex-wrap:wrap">' + REACTIONS.map((r) => '<span class="react is-on"><img src="' + IMG(r.img) + '" alt="">' + r.t + '</span>').join('') + '</div></div>') + '</div>');
  },
  notes: { goal: 'Garrul 式分层反垃圾：总是开启的基础防护 + 可调的启发式规则，命中的进入队列，不静默丢弃。', parts: ['5 个状态标签页', '每条显示命中原因（首次评论、外链、屏蔽词、被举报）与 IP 哈希', '规则面板：开关 + 屏蔽词 + 回应贴纸配置'], motion: ['无'], data: ['comments.status: published | pending | spam | deleted', 'POST /api/admin/comments/bulk {ids, action}'], perf: ['队列分页 50 条'], mobile: ['规则面板移到队列下方；操作按钮换行'] },
  demos: [['被举报', 'qtab-reported']]
});

PAGES.push({ id: 'a-users', group: 'adm', title: '用户与权限', route: '/admin/users', fid: 'hi',
  render(ctx) {
    const roleCls = { '站长': 'err', '管理员': 'info', '用户': 'mute' };
    const users = [[SITE.name + '站长', 'ow***@example.com', '站长', '—', '刚刚'], ['海风', 'se***@example.com', '管理员', '免审', '1 小时前'], ['审核员小鱼', 'fi***@example.com', '管理员', '免审', '12 分钟前'], ['今州打工人', 'jz***@example.com', '用户', '可投稿 · 3 个包', '2 小时前'], ['回音小鱼', 'hy***@example.com', '用户', '免审 · 5 个包', '昨天'], ['scraper_0x1f', 'sc***@example.net', '用户', '已禁止', '10-19'], ['黎那汐塔观光团', 'ln***@example.com', '用户', '可投稿 · 1 个包', '3 天前']];
    const perms = [['浏览、下载、收藏、评论', 1, 1, 1], ['投稿表情包（需审核，可设免审）', 1, 1, 1], ['审核投稿、发布与下架表情包', 1, 1, 0], ['表情包与表情增删改查、上传中心', 1, 1, 0], ['角色、画师、标签整理与合并', 1, 1, 0], ['评论审核、屏蔽词、禁止评论', 1, 1, 0], ['用户与角色、下载与风控', 1, 0, 0], ['存储、任务、审计、系统设置', 1, 0, 0]];
    return adminShell(ctx, 'a-users', ['管理台', '社区', '用户与权限'],
      ahead('用户与权限', '三种角色：站长拥有全部权限；管理员负责表情包与评论；所有用户都可以投稿。', btn('任命管理员', { cls: 'primary sm', icon: 'plus' })) +
      '<div class="cols-2">' + panel('角色与权限', '<div class="tbl-wrap"><table class="tbl perm"><thead><tr><th>能做什么</th><th>站长</th><th>管理员</th><th>用户</th></tr></thead><tbody>' + perms.map((p) => '<tr><td>' + p[0] + '</td>' + p.slice(1).map((v) => '<td class="' + (v ? 'y' : 'n') + '">' + ic(v ? 'check' : 'minus', 'sm') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>', null, 'flush') +
      panel('任命规则', '<ul class="rules"><li>只有站长可以任命或撤销管理员。</li><li>至少保留一位站长；站长的角色不能被其他人修改。</li><li>投稿默认对所有注册用户开放；可以对单个用户设为「免审」或「禁止投稿」。</li><li>每次写操作都记录操作人与当时的角色。</li></ul>') + '</div>' +
      '<div class="filters">' + input('用户名或邮箱', { icon: 'search', cls: 'sm', id: 'au-q-' + ctx.f }) + sel('角色：全部') + sel('投稿：全部') + sel('排序：最近活跃') + '</div>' +
      panel('用户', '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>用户</th><th class="col-opt">邮箱</th><th>角色</th><th>投稿</th><th class="col-opt">最近活跃</th><th></th></tr></thead><tbody>' +
        users.map((u) => '<tr><td><div class="cell"><span class="avatar sm">' + esc(u[0].slice(0, 1)) + '</span><b>' + esc(u[0]) + '</b></div></td><td class="col-opt mono">' + u[1] + '</td><td>' + st(roleCls[u[2]], u[2]) + '</td><td>' + (u[3] === '已禁止' ? st('err', '已禁止') : u[3] === '—' ? '<span class="muted">—</span>' : '<span class="muted">' + u[3] + '</span>') + '</td><td class="col-opt muted">' + u[4] + '</td><td><div class="row-acts"><button class="ibtn" aria-label="修改角色">' + ic('edit') + '</button><button class="ibtn" aria-label="封禁">' + ic('ban') + '</button></div></td></tr>').join('') + '</tbody></table></div>', null, 'flush'));
  },
  notes: { goal: '角色只有三种：站长、管理员、用户。投稿对所有用户开放，站长不必一个人上传。', parts: ['权限矩阵与任命规则同屏', '投稿状态按用户设置：可投稿（默认）、免审、已禁止'], motion: ['无'], data: ['Better Auth admin 插件：role 取 admin | manager | user；任命接口只允许站长调用', '服务端校验每个后台路由与操作的权限；投稿相关查询一律按 owner_id 限定'], perf: ['服务端分页'], mobile: ['权限矩阵在上，用户列表隐藏邮箱与活跃列'] },
  demos: []
});

PAGES.push({ id: 'a-downloads', group: 'adm', title: '下载与风控', route: '/admin/downloads', fid: 'std',
  render(ctx) {
    const lim = (k, v, h, id) => '<div class="rule-row"><div><b>' + k + '</b><small>' + h + '</small></div><div class="input sm" style="width:130px"><input id="lim-' + id + '-' + ctx.f + '" value="' + v + '" placeholder="不限"></div></div>';
    return adminShell(ctx, 'a-downloads', ['管理台', '系统', '下载与风控'],
      ahead('下载与风控', '默认对所有人开放下载；以下限额留空即不限制，用来防止有人批量刷 R2。') +
      '<div class="kpis">' + kpi('今日原图下载', '6,120', '9.8%', { icon: 'download', spark: dl30.slice(-10) }) + kpi('R2 读操作', '41.2<small>万</small>', null, { icon: 'cloud', note: '本月 1,108 万 · 免费额度 1,000 万' }) + kpi('触发限流', '182', null, { icon: 'shield', note: '其中 1 个来源已封禁', alert: true }) + kpi('ZIP 缓存命中', '94%', null, { icon: 'box', note: '本周生成 31 个' }) + '</div>' +
      '<div class="cols-2e">' + panel('限额（留空 = 不限）', lim('每个 IP 每天原图张数', '', '游客按 IP 计', 'ip') + lim('每个账号每天原图张数', '', '登录用户按账号计', 'acc') + lim('每个 IP 每天整包次数', '', '整包与打包清单都计入', 'zip') + lim('单次打包张数上限', '', '超过 200 张会自动分卷', 'batch') + lim('每个 IP 每分钟打包张数', '', '与单张限速分开计，正常打包不会触发单张限速', 'bmin') + '<span class="hint" style="display:block;margin-top:8px">WebP 预览始终不计数。达到限额时提示「明天恢复」，并引导登录。</span>') +
      panel('防刷', '<div class="rule-row"><div><b>单张下载速率限制</b><small>每个 IP 每分钟最多签发 60 个单张原图链接，超出返回 429</small></div>' + sw('', true, 'noop') + '</div>' +
        '<div class="rule-row"><div><b>可疑时要求人机验证</b><small>连续顺序抓取或无 Referer 时要求通过 Cap 验证</small></div>' + sw('', true, 'noop') + '</div>' +
        '<div class="rule-row"><div><b>原图仅限登录用户</b><small>紧急开关：游客只能看 WebP 预览</small></div>' + sw('', false, 'noop') + '</div>' +
        '<div class="rule-row"><div><b>暂停整包与打包下载</b><small>紧急开关：只保留单张下载</small></div>' + sw('', false, 'noop') + '</div>' +
        '<div class="rule-row"><div><b>R2 读操作月度告警</b><small>超过阈值时邮件通知站长</small></div><div class="input sm" style="width:130px"><input id="r2a-' + ctx.f + '" value="900 万"></div></div>') + '</div>' +
      panel('可疑来源', '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>来源</th><th class="n">24 小时签发</th><th>特征</th><th></th></tr></thead><tbody><tr><td class="mono">scraper_0x1f</td><td class="n">9,120</td><td>' + st('err', '连续顺序抓取') + '</td><td>' + btn('封禁', { cls: 'xs', icon: 'ban' }) + '</td></tr><tr><td class="mono">IP 哈希 a91c…2f</td><td class="n">1,840</td><td>' + st('warn', '无 Referer') + '</td><td>' + btn('加入观察', { cls: 'xs' }) + '</td></tr></tbody></table></div>', null, 'flush'));
  },
  notes: { goal: '下载默认开放，风控以开关和限额的形式备着：平时留空不限制，有人刷 R2 时一键收紧。只对站长开放。', parts: ['限额五项，留空即不限；打包按张数单独限速', '防刷：单张速率限制默认开；可疑时要求 Cap 验证；两个紧急开关', 'R2 读操作统计与月度告警（R2 出流量免费，读操作按次计费）', '可疑来源列表，可封禁或观察'], motion: ['无'], data: ['限额与开关存 site_settings；计数表 download_counters（UNLOGGED，类别 orig、batch_item、batch、zip），每小时汇总到 download_stats_daily', '签发原图链接时依次检查：可下载 → 紧急开关 → 速率 → 限额；未配置的项直接跳过；打包每批最多 20 张', 'IP 一律取 CF-Connecting-IP', 'Cloudflare WAF 在 /dl/* 与 /api/batch/* 再加一道速率规则作为外层'], perf: ['计数写入为单行 UPSERT，不在热路径做聚合'], mobile: ['面板纵向排列'] },
  demos: [['前台触发限额时的提示', 'limit-demo']]
});

PAGES.push({ id: 'a-storage', group: 'adm', title: '存储 R2', route: '/admin/storage', fid: 'std',
  render(ctx) {
    const tree = [['wuwa/', 0, 'cloud', '', ''], ['assets/v1/packs/', 1, 'folder', '14.0 GiB', 'is-on'], ['aimisi-01/emojis/', 2, 'folder', '25', ''], ['aimisi-same-pack-merged-20261005/', 2, 'folder', '143', ''], ['derived/v1/p240/', 1, 'image', '15,272', ''], ['derived/v1/a160/', 1, 'image', '12,276', ''], ['derived/v1/full/', 1, 'image', '按需', ''], ['review/v1/', 1, 'eye', '58', ''], ['zips/v1/packs/', 1, 'folder', '9.4 GiB', ''], ['uploads/tmp/', 1, 'folder', '312 MB', ''], ['backups/postgres/', 1, 'db', '1.2 GiB', ''], ['meta/v1/ · sync/v1/', 1, 'lock', '14 MB', ''], ['docs/v1/ · design/v1/', 1, 'folder', '5.6 MB', '']];
    return adminShell(ctx, 'a-storage', ['管理台', '系统', '存储 R2'],
      ahead('存储', '单桶 wuwa · 缩略图经 /img 路由由 CDN 缓存 · 原图与 ZIP 用签名链接', btn('扫描孤儿对象', { cls: 'sm', icon: 'search' })) +
      panel('用量', '<div class="usage"><div class="bar"><i style="width:52%;background:var(--tp-teal)"></i><i style="width:8%;background:var(--c-purple)"></i><i style="width:35%;background:var(--c-yellow)"></i><i style="width:1%;background:var(--c-orange)"></i><i style="width:4%;background:var(--c-brown)"></i></div><div class="lg"><span><i style="background:var(--tp-teal)"></i>原图 14.0 GiB</span><span><i style="background:var(--c-purple)"></i>衍生图 2.1 GiB</span><span><i style="background:var(--c-yellow)"></i>ZIP 9.4 GiB</span><span><i style="background:var(--c-orange)"></i>暂存 312 MB</span><span><i style="background:var(--c-brown)"></i>备份 1.2 GiB</span></div><span class="hint">衍生图与 ZIP 为预估值（示例）。</span></div>') +
      '<div class="cols-2">' + panel('对象浏览', '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>对象键</th><th class="n">大小</th><th class="col-opt">类型</th><th></th></tr></thead><tbody>' + EMO.slice(0, 7).map((e) => '<tr><td class="mono" style="font-size:12px">assets/v1/packs/aimisi-01/emojis/' + e.id + '.gif</td><td class="n">' + fmtB(e.bytes) + '</td><td class="col-opt">image/gif</td><td><div class="row-acts"><button class="ibtn" aria-label="复制键">' + ic('copy') + '</button><button class="ibtn" aria-label="预览">' + ic('eye') + '</button></div></td></tr>').join('') + '</tbody></table></div>', null, 'flush') +
      panel('前缀', '<div class="tree">' + tree.map((t) => '<a href="#" class="in' + t[1] + ' ' + t[4] + '">' + ic(t[2]) + t[0] + '<small>' + t[3] + '</small></a>').join('') + '</div>' +
        '<div class="rule-row" style="margin-top:8px"><div><b>生命周期：uploads/tmp/ 7 天、backups/ 30 天</b><small>R2 生命周期规则</small></div>' + st('ok', '已启用') + '</div><div class="rule-row"><div><b>meta/v1/、sync/v1/ 只读</b><small>v1 快照，仅作导入来源</small></div>' + st('info', '只读') + '</div>') + '</div>');
  },
  notes: { goal: '后台直接看到 R2 的分类目录与用量。所有文件都在同一个桶 wuwa 里，按用途分前缀。', parts: ['用量分段条：原图、衍生图、ZIP、暂存、备份', '前缀树：assets、derived、zips、uploads、backups、meta、docs、design', '生命周期与只读前缀说明'], motion: ['无'], data: ['ListObjectsV2（服务端代理，分页）；用量来自每日统计任务'], perf: ['对象列表按需分页'], mobile: ['前缀树在上，对象表在下'] }, demos: []
});

PAGES.push({ id: 'a-jobs', group: 'adm', title: '任务队列', route: '/admin/jobs', fid: 'std',
  render(ctx) {
    return adminShell(ctx, 'a-jobs', ['管理台', '系统', '任务队列'],
      ahead('任务队列', 'pg-boss · worker 容器 2 个并发', btn('暂停队列', { cls: 'sm', icon: 'pause' })) +
      '<div class="kpis">' + kpi('运行中', '2', null, { icon: 'play2' }) + kpi('排队', '14', null, { icon: 'clock' }) + kpi('今日完成', '1,208', null, { icon: 'check' }) + kpi('失败', '1', null, { icon: 'warn', alert: true, note: '可重试' }) + '</div>' +
      panel('最近任务', '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>队列</th><th>对象</th><th>状态</th><th class="col-opt">进度</th><th class="col-opt">开始</th><th class="col-opt">耗时</th><th></th></tr></thead><tbody>' + JOBS.map((j) => '<tr><td class="mono">' + j.q + '</td><td>' + esc(j.t) + '</td><td>' + st(j.s === 'run' ? 'info run' : j.s === 'ok' ? 'ok' : j.s === 'err' ? 'err' : 'mute', j.s === 'run' ? '运行中' : j.s === 'ok' ? '完成' : j.s === 'err' ? '失败' : '排队') + '</td><td class="col-opt"><div class="mini-prog" style="--p:' + j.p + '%"><i></i></div></td><td class="col-opt num">' + j.at + '</td><td class="col-opt">' + j.dur + '</td><td><div class="row-acts">' + (j.s === 'err' ? '<button class="ibtn" aria-label="重试">' + ic('refresh') + '</button>' : '') + '<button class="ibtn" aria-label="详情">' + ic('more') + '</button></div></td></tr>').join('') + '</tbody></table></div>', null, 'flush') +
      panel('定时任务', ['每小时汇总下载计数', '每天 03:00 备份数据库到 R2 backups/postgres/', '每天 04:00 检查 R2 读操作告警', '每天 05:00 清理过期投稿文件与草稿'].map((r, k) => '<div class="rule-row"><div><b>' + r + '</b><small class="mono">' + ['0 * * * *', '0 3 * * *', '0 4 * * *', '0 5 * * *'][k] + ' · Asia/Shanghai</small></div>' + sw('', true, 'noop') + '</div>').join('') + '<div class="hint" style="margin-top:8px">ZIP 不定时重建：只在包发布或内容变化时入队，文件按内容哈希命名。</div>'));
  },
  notes: { goal: '所有后台异步工作（衍生图、ZIP、备份、通知、索引）集中可见。', parts: ['失败任务可重试；超时原因写在耗时列', '定时任务带时区（pg-boss schedule 支持 tz）'], motion: ['运行中状态点闪烁'], data: ['pg-boss 表：pgboss.job；GET /api/admin/jobs'], perf: ['worker 与 web 同镜像、不同启动命令'], mobile: ['隐藏进度、开始、耗时列'] }, demos: []
});

PAGES.push({ id: 'a-audit', group: 'adm', title: '审计日志', route: '/admin/audit', fid: 'std',
  render(ctx) {
    return adminShell(ctx, 'a-audit', ['管理台', '系统', '审计日志'],
      ahead('审计日志', '后台所有写操作都会记录，保留 180 天') + '<div class="filters">' + sel('操作人：全部') + sel('动作：全部') + sel('时间：今天') + '</div>' +
      panel('记录', '<div class="feed" style="padding:4px 16px">' + AUDIT.map((a) => '<div class="it"><span class="dot">' + ic('history') + '</span><div><b>' + a.who + '</b> · <span class="mono">' + a.act + '</span> · ' + esc(a.obj) + (a.diff ? '<div class="diff" style="margin-top:6px">' + a.diff[0] + ': <span class="del">' + esc(a.diff[1]) + '</span> → <span class="add">' + esc(a.diff[2]) + '</span></div>' : '') + '</div><time>' + a.t + '</time></div>').join('') + '</div>', null, 'flush'));
  },
  notes: { goal: '多人维护时可追溯：谁在什么时候改了什么。', parts: ['字段级 diff'], motion: ['无'], data: ['audit_logs(actor_id, action, target, diff jsonb, ip_hash, created_at)'], perf: ['按月分区'], mobile: ['同上'] }, demos: []
});

PAGES.push({ id: 'a-settings', group: 'adm', title: '系统设置', route: '/admin/settings', fid: 'std',
  render(ctx) {
    const tab = ctx.F.stab || 'site';
    const T = [['site', '站点'], ['auth', '账号与注册'], ['sub', '投稿'], ['cm', '评论'], ['int', '集成'], ['bk', '备份']];
    const B = {
      site: '<div class="form-grid">' + field('站点名称', input('', { v: SITE.name, id: 'as-n-' + ctx.f }), { hint: '对应环境变量 SITE_NAME，后台修改即时生效' }) + field('副标题', input('', { v: '鸣潮表情图鉴', id: 'as-s-' + ctx.f })) + field('顶部公告', input('', { v: '新上架：全角色琵琶曲 v2.0，27 张动态回眸', id: 'as-a-' + ctx.f }), { cls: 'full', hint: '可关闭的横条，替代源站的欢迎弹窗' }) + field('公告有效期', '<span class="sel">至 2026-10-27 ' + ic('cal') + '</span>') + field('维护模式', sw('关闭', false, 'noop')) + '</div>',
      auth: ['开放注册', '注册需要邮箱验证', '允许通行密钥登录', '允许 GitHub 登录'].map((r) => '<div class="rule-row"><div><b>' + r + '</b></div>' + sw('', true, 'noop') + '</div>').join(''),
      sub: ['开放投稿（所有注册用户）', '投稿需要审核（免审用户除外）', '已发布的包修改后重新审核'].map((r) => '<div class="rule-row"><div><b>' + r + '</b></div>' + sw('', true, 'noop') + '</div>').join('') + '<div class="rule-row"><div><b>单个文件上限</b><small>GIF、PNG、WebP</small></div><span class="sel">20 MB' + ic('down') + '</span></div>',
      cm: ['开启评论', '允许游客评论（需 Cap 验证）', '允许贴纸（每条最多 6 张）', '站内回复通知'].map((r) => '<div class="rule-row"><div><b>' + r + '</b></div>' + sw('', true, 'noop') + '</div>').join(''),
      int: '<div class="form-grid">' + field('Cap 验证难度', input('', { v: '4', id: 'as-t-' + ctx.f }), { hint: '每个挑战的前导零位数，越大越慢' }) + field('Cap 挑战数量', input('', { v: '50', id: 'as-ts-' + ctx.f }), { hint: '一次验证要解的挑战数；手机上约 1 秒' }) + field('R2 端点', input('', { v: 'https://<account>.r2.cloudflarestorage.com', id: 'as-r-' + ctx.f }), { hint: '密钥来自环境变量，不在后台显示' }) + field('发信服务', '<span class="sel">SMTP · smtp.example.com' + ic('down') + '</span>') + '</div>',
      bk: '<div class="rule-row"><div><b>每日自动备份到 R2</b><small class="mono">backups/postgres/YYYY/MM/DD/</small></div>' + sw('', true, 'noop') + '</div><div class="rule-row"><div><b>保留天数</b><small>超过后由生命周期规则删除</small></div><span class="sel">14 天' + ic('down') + '</span></div>' + btn('立即备份', { cls: 'sm', icon: 'db' })
    };
    return adminShell(ctx, 'a-settings', ['管理台', '系统', '系统设置'], ahead('系统设置', '修改即时生效，无需重新部署；密钥类配置只读') +
      '<div class="tabs" role="tablist">' + T.map((t) => '<button role="tab" data-act="stab" data-v="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + t[1] + '</button>').join('') + '</div>' + panel(T.find((t) => t[0] === tab)[1], B[tab], btn('保存', { cls: 'primary xs' })));
  },
  notes: { goal: '运营类开关放后台，密钥类配置只读显示，避免把秘钥写进数据库。', parts: ['公告横条替代欢迎弹窗', '集成：Cap 人机验证（自托管，无密钥）、R2、发信；Secret 不回显'], motion: ['无'], data: ['site_settings(key, value jsonb)；变更写审计日志'], perf: ['设置读入内存缓存，变更时失效'], mobile: ['标签横向滚动'] },
  demos: [['集成设置', 'stab-int']]
});
