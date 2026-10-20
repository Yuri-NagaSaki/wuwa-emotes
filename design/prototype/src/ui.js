// ---------- shared render helpers (return HTML strings) ----------
const NAV = [['home', '首页', 'home'], ['packs', '表情包', 'grid'], ['characters', '角色', 'users'], ['gallery', '画廊', 'wave'], ['explore', '探索', 'hash']];
function header(ctx, active) {
  const n = ctx.S.bottle.size;
  const user = ctx.S.user || active === 'me'
    ? '<button class="avatar user-slot" data-go="me" aria-label="个人中心"><img src="' + IMG(AV('爱弥斯')) + '" alt=""></button>'
    : '<button class="btn sm user-slot" data-go="login">' + ic('user', 'sm') + '登录</button>';
  return '<header class="head"><div class="wrap">' +
    '<a class="logo" data-go="home" href="#" aria-label="' + SITE.name + '首页">' + logoMark() + '<span class="logo-word"><b>' + SITE.name + '</b><small>' + SITE.sub + '</small></span></a>' +
    '<nav class="nav" aria-label="主导航">' + NAV.map((x) => '<a href="#" data-go="' + x[0] + '"' + (active === x[0] ? ' aria-current="page"' : '') + '>' + x[1] + '</a>').join('') + '</nav>' +
    '<button class="head-search" data-act="cmdk" aria-label="搜索">' + ic('search') + '<span>搜索表情包、角色、画师</span><span class="kbd">Ctrl K</span></button>' +
    '<div class="head-actions"><button class="icon-btn m-search" data-act="cmdk" aria-label="搜索">' + ic('search') + '</button>' +
    '<button class="bottle-btn" data-act="bottle" aria-label="打包清单，已选 ' + n + ' 张">' + ic('box') + '<span class="label">打包</span><span class="count num">' + n + '</span></button>' + user + '</div>' +
    '</div></header>';
}
function announce(ctx) {
  if (ctx.S.annClosed) return '';
  return '<div class="announce"><div class="wrap">' + ic('wave', 'wave-ico') + '<span>新上架：<a href="#" data-go="pack">全角色琵琶曲 v2.0</a>，27 张动态回眸</span><button class="x" data-act="ann-close" aria-label="关闭公告">' + ic('close', 'sm') + '</button></div></div>';
}
function footer() {
  return '<footer class="foot"><div class="foot-wave" aria-hidden="true"><svg viewBox="0 0 1200 40" preserveAspectRatio="none">' +
    '<path class="back" d="M0 22 Q75 4 150 22 T300 22 T450 22 T600 22 T750 22 T900 22 T1050 22 T1200 22 V40 H0z"/>' +
    '<path d="M0 26 Q75 12 150 26 T300 26 T450 26 T600 26 T750 26 T900 26 T1050 26 T1200 26 V40 H0z"/></svg></div>' +
    '<div class="wrap"><div class="about"><a class="logo" href="#" data-go="home">' + logoMark() + '<span class="logo-word"><b>' + SITE.name + '</b><small>' + SITE.sub + '</small></span></a>' +
    '<p>潮友共建的鸣潮表情仓库。表情版权归原画师与官方所有，本站按 CC BY-NC-SA 4.0 等原始许可整理发布，不做商用。</p></div>' +
    '<div><h4>浏览</h4><ul><li><a href="#" data-go="packs">全部表情包</a></li><li><a href="#" data-go="characters">角色图鉴</a></li><li><a href="#" data-go="gallery">潮汐画廊</a></li><li><a href="#" data-go="collections">精选合集</a></li></ul></div>' +
    '<div><h4>社区</h4><ul><li><a href="#" data-go="about">关于' + SITE.name + '</a></li><li><a href="#" data-go="links">友情链接</a></li><li><a href="#" data-go="api">API 接入</a></li><li><a href="#" data-go="artists">画师名录</a></li></ul></div>' +
    '<div><h4>规则</h4><ul><li><a href="#" data-go="legal">隐私政策</a></li><li><a href="#" data-go="legal">服务条款</a></li><li><a href="#" data-go="legal">版权与下架申诉</a></li></ul></div>' +
    '<div class="foot-base"><span>© 2026 ' + SITE.name + ' · 非官方粉丝站，与库洛游戏无关</span><span class="lic">' + ic('shield', 'sm') + '画师署名随包附带 CREDITS.txt</span><span>表情 ' + fmtN(DATA.stats.emojis) + ' 张 · 表情包 ' + DATA.stats.packs + ' 个</span></div></div></footer>';
}
function tabbar(active) {
  const T = [['home', '首页', 'home'], ['packs', '表情包', 'grid'], ['gallery', '画廊', 'wave'], ['characters', '角色', 'users'], ['me', '我的', 'user']];
  return '<nav class="tabbar" aria-label="底部导航">' + T.map((x) => '<a href="#" data-go="' + x[0] + '"' + (active === x[0] ? ' aria-current="page"' : '') + '>' + ic(x[2]) + x[1] + '</a>').join('') + '</nav>';
}
function shell(ctx, active, inner, opts) {
  opts = opts || {};
  ctx.layer.push(tabbar(active));
  ctx.layer.push('<button class="fab-bottle' + (ctx.S.bottle.size ? ' is-on' : '') + '" data-act="bottle" aria-label="打包清单">' + ic('box', 'lg') + '<span class="count">' + ctx.S.bottle.size + '</span></button>');
  return (opts.noAnn ? '' : announce(ctx)) + header(ctx, active) + '<main class="page">' + inner + '</main>' + (opts.noFoot ? '' : footer());
}
// ---------- atoms ----------
function btn(label, o) {
  o = o || {};
  return '<button class="btn' + (o.cls ? ' ' + o.cls : '') + '"' + (o.act ? ' data-act="' + o.act + '"' : '') + (o.go ? ' data-go="' + o.go + '"' : '') + (o.attr || '') + '>' + (o.icon ? ic(o.icon) : '') + (label || '') + '</button>';
}
function chip(label, o) {
  o = o || {};
  return '<button class="chip' + (o.on ? ' is-on' : '') + (o.sm ? ' sm' : '') + '"' + (o.act ? ' data-act="' + o.act + '"' : '') + (o.go ? ' data-go="' + o.go + '"' : '') + (o.attr || '') + '>' +
    (o.av ? '<span class="av" style="--cc:' + o.cc + '"><img src="' + IMG(o.av) + '" alt=""></span>' : '') + (o.icon ? ic(o.icon, 'sm') : '') + esc(label) + (o.n != null ? '<span class="n">' + o.n + '</span>' : '') + (o.x ? '<span class="x">' + ic('close', 'sm') + '</span>' : '') + '</button>';
}
const tag = (t, color) => '<span class="tag" style="--tg:' + (color || 'var(--c-mint)') + '">' + t + '</span>';
function seg(items, on, act, cls) {
  return '<div class="seg' + (cls ? ' ' + cls : '') + '" role="group">' + items.map((x) => {
    const k = Array.isArray(x) ? x[0] : x, l = Array.isArray(x) ? x[1] : x, i = Array.isArray(x) ? x[2] : null;
    return '<button data-act="' + act + '" data-v="' + k + '" aria-pressed="' + (k === on) + '">' + (i ? ic(i, 'sm') : '') + l + '</button>';
  }).join('') + '</div>';
}
const sw = (label, on, act) => '<button class="switch" role="switch" aria-checked="' + !!on + '"' + (act ? ' data-act="' + act + '"' : '') + '><span class="track"></span>' + (label || '') + '</button>';
const ribbon = (t, cls) => '<h2 class="ribbon' + (cls ? ' ' + cls : '') + '"><span>' + t + '</span></h2>';
function secHead(title, o) {
  o = o || {};
  return '<div class="sec-h">' + (o.plain ? '<h2 class="h-plain">' + title + '</h2>' : ribbon(title, o.cls)) + (o.sub ? '<span class="sub">' + o.sub + '</span>' : '') + (o.more ? '<a class="more" href="#" data-go="' + o.more[1] + '">' + o.more[0] + ic('arrow', 'sm') + '</a>' : '') + '</div>';
}
const stats = (items) => '<div class="stats">' + items.map((x) => '<div class="stat"><b>' + x[0] + '</b><span>' + x[1] + '</span></div>').join('') + '</div>';
function field(label, inner, o) {
  o = o || {};
  return '<div class="field' + (o.cls ? ' ' + o.cls : '') + '"><label>' + label + (o.aside ? '<small>' + o.aside + '</small>' : '') + '</label>' + inner + (o.hint ? '<span class="hint' + (o.err ? ' err' : '') + '">' + o.hint + '</span>' : '') + '</div>';
}
const input = (ph, o) => { o = o || {}; return '<div class="input' + (o.cls ? ' ' + o.cls : '') + '">' + (o.icon ? ic(o.icon) : '') + '<input id="' + (o.id || 'in-' + Math.random().toString(36).slice(2, 7)) + '" type="' + (o.type || 'text') + '" placeholder="' + ph + '" value="' + (o.v || '') + '">' + (o.tail || '') + '</div>'; };
const check = (label, on, act) => '<span class="check' + (on ? ' is-on' : '') + '"' + (act ? ' data-act="' + act + '"' : '') + '><span class="box">' + ic('check') + '</span>' + label + '</span>';
// ---------- emoji tile ----------
function tile(e, i, o) {
  o = o || {};
  const sel = o.sel && o.sel.has(i), fav = o.favs && o.favs.has(e.img);
  return '<figure class="tile is-in' + (sel ? ' is-sel' : '') + (o.big ? ' big' : '') + '" style="--d:' + (i % 24) + '" data-i="' + i + '" data-img="' + e.img + '">' +
    '<button class="tile-hit" data-act="' + (o.act || 'lightbox') + '" data-i="' + i + '" aria-label="查看表情 ' + (i + 1) + '"><img src="' + IMG(e.img) + '"' + (e.anim ? ' data-anim="' + IMG(e.anim) + '"' : '') + ' width="240" height="240" loading="lazy" decoding="async" alt="' + esc(o.alt || '表情 ' + (i + 1)) + '"></button>' +
    '<span class="tile-fmt">' + (e.fmt || 'gif').toUpperCase() + '</span>' +
    '<span class="tile-check" aria-hidden="true">' + ic('check') + '</span>' +
    '<div class="tile-acts"><button data-act="copy" data-i="' + i + '" aria-label="复制图片" class="tip" data-tip="复制">' + ic('copy') + '</button>' +
    '<button data-act="dl1" data-i="' + i + '" aria-label="保存原图" class="tip" data-tip="保存原图">' + ic('download') + '</button>' +
    '<button data-act="add" data-i="' + i + '" aria-label="加入打包" class="tip" data-tip="加入打包">' + ic('box') + '</button>' +
    '<button data-act="fav1" data-i="' + i + '" aria-label="收藏" class="tip' + (fav ? ' is-fav' : '') + '" data-tip="收藏">' + ic('heart') + '</button></div></figure>';
}
// ---------- pack card (masonry) ----------
function cover(p, variant) {
  const imgs = [p.cover].concat(p.minis || []);
  let v = variant;
  if (imgs.length < 4 && v !== 'one') v = 'one';
  const pics = (v === 'one' ? imgs.slice(0, 1) : imgs.slice(0, 4)).map((x, j) => '<img src="' + IMG(x) + '"' + (j === 0 && p.coverAnim ? ' data-anim="' + IMG(p.coverAnim) + '"' : '') + ' width="240" height="240" loading="lazy" decoding="async" alt="">').join('');
  return '<div class="cv ' + v + '">' + pics + '</div>';
}
function packCard(p, i, o) {
  o = o || {};
  const variant = o.variant || ['four', 'lead', 'one', 'strip'][i % 4];
  const chars = p.chars.slice(0, 3).map((n) => { const c = CHAR_BY[n] || charOf(n); return tag(esc(n), c.color); }).join('') + (p.chars.length > 3 ? tag('+' + (p.chars.length - 3), 'var(--tp-line-2)') : '');
  const flags = (p.official ? '<b class="flag official">官转</b>' : '') + (p.pin > 0 ? '<b class="flag pin">置顶</b>' : '') + (p.memorial ? '<b class="flag memorial">' + ic('star', 'sm') + '纪念</b>' : '') + (o.isNew ? '<b class="flag new">新</b>' : '') + (!p.anim ? '<b class="flag static">静态</b>' : '');
  return '<article class="pcard is-in" style="--acc:' + p.acc + ';--d:' + (i % 12) + '">' +
    '<a class="pcard-cover" href="#" data-go="pack:' + p.key + '" aria-label="' + esc(p.title) + '">' + cover(p, variant) + '<span class="pcard-flags">' + flags + '</span><span class="pcard-count">' + p.count + ' 张</span></a>' +
    '<div class="pcard-body"><h3><a href="#" data-go="pack:' + p.key + '">' + esc(p.title) + '</a></h3>' +
    (o.noEx || !p.excerpt ? '' : '<p class="pcard-ex">' + esc(p.excerpt) + '</p>') +
    '<div class="pcard-chars">' + chars + '</div>' +
    '<div class="pcard-meta"><span class="pill-stat">' + ic('download', 'sm') + fmtW(p.dl) + '</span><span class="pill-stat">' + ic('heart', 'sm') + fmtN(p.fav) + '</span><span class="pill-stat">' + ic('clock', 'sm') + p.date.slice(5) + '</span></div>' +
    (p.artists && p.artists.length ? '<div class="pcard-credit">' + ic('edit', 'sm') + '<span>画师 ' + esc(p.artists.join('、')) + '</span></div>' : (p.official ? '<div class="pcard-credit">' + ic('lock', 'sm') + '<span>官方表情 · 仅预览，不提供下载</span></div>' : '')) +
    '</div></article>';
}
function charCard(c) {
  return '<a class="ccard" href="#" data-go="char:' + esc(c.name) + '" style="--cc:' + c.color + '"><span class="pool">' + (c.avatar ? '<img src="' + IMG(c.avatar) + '" width="160" height="160" loading="lazy" alt="">' : '') + '</span><b>' + esc(c.name) + '</b><span>' + fmtN(c.count) + ' 张 · ' + c.packs + ' 包</span></a>';
}
function charChip(c) {
  return '<a class="cchip" href="#" data-go="char:' + esc(c.name) + '" style="--cc:' + c.color + '"><span class="pool">' + (c.avatar ? '<img src="' + IMG(c.avatar) + '" width="160" height="160" loading="lazy" alt="">' : '') + '</span><b>' + esc(c.name) + '</b><small>' + fmtN(c.count) + ' 张</small></a>';
}
// the hero illustration: emojis floating in a tidepool
function poolArt(imgs) {
  const spots = [[16, 20, '-0.4s'], [56, 12, '-1.8s'], [36, 44, '-3.1s'], [68, 52, '-0.9s'], [14, 58, '-2.4s'], [48, 72, '-4s']];
  return '<div class="pool-art" aria-hidden="true"><svg class="pool" viewBox="0 0 560 500"><defs><radialGradient id="tp-pool-grad" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#7fe6d9"/><stop offset="0.55" stop-color="#2cc7b8"/><stop offset="1" stop-color="#139a96"/></radialGradient></defs>' +
    '<path class="rim" d="M282 24c132 0 250 70 254 196 5 150-104 262-262 262C120 482 22 384 26 248 30 108 150 24 282 24z"/>' +
    '<path class="water" d="M282 50c116 0 222 60 226 172 4 132-94 232-234 232C140 454 52 368 56 248 60 124 166 50 282 50z"/>' +
    '<ellipse class="ring" cx="280" cy="250" rx="200" ry="170"/><ellipse class="ring r2" cx="280" cy="250" rx="200" ry="170"/><ellipse class="ring r3" cx="280" cy="250" rx="200" ry="170"/>' +
    '<circle class="pebble" cx="52" cy="140" r="16"/><circle class="pebble b" cx="78" cy="118" r="9"/><circle class="pebble c" cx="512" cy="356" r="14"/><circle class="pebble b" cx="488" cy="392" r="8"/><circle class="pebble c" cx="120" cy="452" r="11"/>' +
    '<path class="star" d="M476 70l9 20 22 2-16 15 5 22-20-11-19 11 4-22-16-15 22-2z" transform="rotate(12 476 92)"/></svg>' +
    imgs.slice(0, 6).map((x, k) => '<span class="floaty" style="left:' + spots[k][0] + '%;top:' + spots[k][1] + '%;--fd:' + spots[k][2] + '"><img src="' + IMG(x) + '" width="160" height="160" alt=""></span>').join('') +
    '<span class="pool-tag" style="left:-2%;top:76%">' + ic('sparkle', 'sm') + '今日新增 <b>' + 27 + '</b> 张</span>' +
    '<span class="pool-tag" style="right:2%;top:2%">' + ic('download', 'sm') + '累计下载 <b>' + fmtW(DATA.stats.downloads) + '</b></span></div>';
}
function emptyArt() {
  return '<svg class="pool-art" viewBox="0 0 180 110" aria-hidden="true"><ellipse cx="90" cy="70" rx="82" ry="34" fill="#efe2bf"/><ellipse cx="90" cy="68" rx="66" ry="24" fill="#bfeee7"/><path d="M60 66c6-5 12-5 18 0s12 5 18 0 12-5 18 0" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M128 26l4 9 10 1-7 7 2 10-9-5-9 5 2-10-7-7 10-1z" fill="#f2857a" stroke="#c9584c" stroke-width="2" stroke-linejoin="round"/></svg>';
}
// ---------- overlays ----------
function lightbox(ctx) {
  // single-emoji detail: a compact dialog sized to the sticker (native 300 px), not a full-screen viewer
  const i = ctx.F.lb, e = EMO[i], pv = !!ctx.S.previewOnly, fav = ctx.S.favs.has(e.img), art = DETAIL.artists[0] || '—', orig = !!ctx.F.orig;
  const s0 = Math.max(0, Math.min(i - 4, EMO.length - 9));
  const strip = EMO.slice(s0, s0 + 9).map((x, k) => '<button class="em-th' + (s0 + k === i ? ' is-on' : '') + '" data-act="lb-go" data-i="' + (s0 + k) + '" aria-label="第 ' + (s0 + k + 1) + ' 张"><img src="' + IMG(x.img) + '" width="240" height="240" alt=""></button>').join('');
  const act = (icon, label, a, cls) => '<button class="em-act' + (cls ? ' ' + cls : '') + '" data-act="' + a + '" data-i="' + i + '">' + ic(icon) + '<span>' + label + '</span></button>';
  const acts = pv
    ? '<div class="note-box warn">' + ic('lock', 'sm') + '<span>这个包暂不提供下载，只能浏览与收藏。</span></div><div class="em-acts">' + act('heart', fav ? '已收藏' : '收藏', 'fav1', fav ? 'is-fav' : '') + act('link', '复制链接', 'share') + '</div>'
    : '<div class="em-acts">' + act('copy', '复制图片', 'copy') + act('download', '保存原图', 'dl1') + act(orig ? 'image' : 'eye', orig ? '回到 WebP' : '查看原图', 'orig', orig ? 'is-on' : '') + act('heart', fav ? '已收藏' : '收藏', 'fav1', fav ? 'is-fav' : '') + act('box', '加入打包', 'add', 'sun') + act('link', '复制链接', 'share') + '</div>';
  return '<div class="scrim" data-act="close"></div><div class="em-wrap" role="dialog" aria-label="表情详情">' +
    '<button class="icon-btn em-nav" data-act="lb-prev" aria-label="上一张">' + ic('left') + '</button>' +
    '<div class="em-card"><span class="grab"></span>' +
    '<div class="em-media"><img src="' + IMG(e.anim || e.img) + '" width="300" height="300" alt="表情 ' + (i + 1) + '"><span class="em-badge' + (orig ? ' is-orig' : '') + '">' + (orig ? '原图 ' + (e.fmt || 'gif').toUpperCase() + ' · ' + fmtB(e.bytes) : 'WebP 预览') + '</span></div>' +
    '<div class="em-info"><div class="em-top"><div><div class="eyebrow">' + esc(DETAIL.title) + '</div><h3>第 ' + (i + 1) + ' 张<small> / ' + EMO.length + '</small></h3></div><button class="icon-btn" data-act="close" aria-label="关闭">' + ic('close') + '</button></div>' +
    '<div class="chips">' + tag('角色 · 爱弥斯', 'var(--c-pink)') + tag('画师 · ' + esc(art), 'var(--c-purple)') + '</div>' +
    '<div class="em-meta"><span>' + e.w + ' × ' + e.h + '</span><span>' + e.frames + ' 帧</span><span>原图 ' + (e.fmt || 'gif').toUpperCase() + ' ' + fmtB(e.bytes) + '</span></div>' + acts +
    '<p class="em-lic">' + ic('shield', 'sm') + '<span>页面里显示的是 WebP，原图只在「查看原图」「保存原图」时加载。CC BY-NC-SA 4.0 · 画师 ' + esc(art) + '。</span></p></div>' +
    '<div class="em-strip">' + strip + '<span class="em-keys"><span class="kbd">←</span><span class="kbd">→</span> 切换 · <span class="kbd">Esc</span> 关闭</span></div></div>' +
    '<button class="icon-btn em-nav" data-act="lb-next" aria-label="下一张">' + ic('right') + '</button></div>';
}
function bottleDrawer(ctx) {
  // 打包清单: a plain tray. No illustration; progress lives inside the primary button.
  const items = Array.from(ctx.S.bottle);
  const groups = {};
  items.forEach((img) => { const it = POOL.find((x) => x.img === img) || { t: '其他', img }; (groups[it.t] = groups[it.t] || []).push(img); });
  const n = items.length, size = n * 0.66 * 1048576, prog = ctx.F.zip, vols = Math.max(1, Math.ceil(n / 200));
  const body = n
    ? '<div class="pk-sum"><div><b class="num">' + n + '</b> 张<span>来自 ' + Object.keys(groups).length + ' 个包</span></div><div><b class="num">' + fmtB(size) + '</b><span>原图合计 · 附 CREDITS.txt</span></div></div>' +
      Object.keys(groups).map((t) => '<div class="bgroup"><h4>' + esc(t) + '<small>' + groups[t].length + ' 张</small></h4><div class="bthumbs">' + groups[t].map((img) => '<span class="bthumb"><img src="' + IMG(img) + '" alt=""><button data-act="unbottle" data-img="' + img + '" aria-label="移出">' + ic('close') + '</button></span>').join('') + '</div></div>').join('')
    : '<div class="empty"><span class="empty-ico">' + ic('box', 'lg') + '</span><h3>还没有选中的表情</h3><p>在任意表情上点「打包」加入，可以跨包收集，最后一次下载。</p></div>';
  const foot = prog == null
    ? '<div class="note-box warn wx-note">' + ic('warn', 'sm') + '<span>微信内置浏览器无法下载压缩包，请点右上角「在浏览器打开」。</span></div>' +
      btn('打包下载原图（' + n + ' 张）', { cls: 'primary block', icon: 'download', act: 'zip', attr: n ? '' : ' disabled' }) +
      '<span class="hint">在浏览器里打包，默认不需要登录；' + (vols > 1 ? '将拆成 ' + vols + ' 个压缩包。' : '每 200 张一个压缩包。') + '站长开启下载限额后，按设置计数。</span>'
    : (prog < 100
      ? '<button class="btn primary block is-progress" style="--p:' + prog + '%" disabled>' + ic('box') + '正在打包 ' + prog + '%</button><span class="hint">原图直接从存储读取，不经过网站服务器。</span>'
      : '<div class="note-box">' + ic('check', 'sm') + '<span>已生成 ' + SITE.slug + '-' + n + '-stickers.zip（设计稿不会真的下载）。</span></div>' + btn('清空并重新挑选', { cls: 'block', act: 'zip-reset' }));
  return '<div class="scrim" data-act="close"></div><aside class="drawer" role="dialog" aria-label="打包清单"><span class="grab"></span><div class="drawer-h">' + ic('box', 'lg') + '<div><h3>打包清单</h3><span class="hint">跨包挑选，一次下载原图</span></div><button class="icon-btn x" data-act="close" aria-label="关闭">' + ic('close') + '</button></div>' +
    '<div class="drawer-b">' + body + '</div><div class="drawer-f">' + foot + '</div></aside>';
}
function cmdk(ctx) {
  const q = ctx.F.q || '爱弥';
  const hl = (s) => esc(s).replace(new RegExp(q.split('').map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(''), 'g'), (m) => '<mark>' + m + '</mark>');
  const c = CHAR_BY['爱弥斯'];
  const packs = PACKS.filter((p) => p.title.includes('爱弥斯')).slice(0, 3);
  const row = (th, t, sub, r, act, on) => '<div class="cmdk-it' + (on ? ' is-act' : '') + '" data-go="' + act + '"><span class="th">' + th + '</span><div>' + t + '<small>' + sub + '</small></div><span class="r">' + r + '</span></div>';
  return '<div class="scrim" data-act="close"></div><div class="cmdk-wrap"><div class="cmdk" role="dialog" aria-label="搜索"><div class="cmdk-in">' + ic('search', 'lg') + '<span class="q">' + esc(q) + '<span class="caret"></span></span><span class="kbd">Esc</span></div><div class="cmdk-list">' +
    '<div class="cmdk-g">角色</div>' + row('<img src="' + IMG(c.avatar) + '" alt="">', hl('爱弥斯'), fmtN(c.count) + ' 张 · ' + c.packs + ' 个包', '↵ 打开', 'char:爱弥斯', true) +
    '<div class="cmdk-g">表情包</div>' + packs.map((p) => row('<img src="' + IMG(p.cover) + '" alt="">', hl(p.title), p.count + ' 张 · ' + (p.anim ? '动态' : '静态'), fmtW(p.dl) + ' 下载', 'pack:' + p.key)).join('') +
    '<div class="cmdk-g">操作</div>' + row(ic('dice'), '随机来一张' + hl('爱弥斯'), '从 1,640 张里抽', '', 'char:爱弥斯') + row(ic('box'), '打开打包清单', '已选 ' + ctx.S.bottle.size + ' 张', '', 'bottle') +
    '</div><div class="cmdk-f"><span><span class="kbd">↑</span><span class="kbd">↓</span> 选择</span><span><span class="kbd">↵</span> 打开</span><span><span class="kbd">Tab</span> 切换分类</span></div></div></div>';
}
function stickerPicker(ctx) {
  const tabs = [['recent', '最近', null], ['fav', '收藏', null], ['爱弥斯', '爱弥斯', AV('爱弥斯')], ['达妮娅', '达妮娅', AV('达妮娅')], ['菲比', '菲比', AV('菲比')], ['心', '心', AV('心')], ['守岸人', '守岸人', AV('守岸人')]];
  const on = ctx.F.ptab || 'recent';
  const list = on === 'recent' ? EMO.slice(0, 18).map((e) => e.img) : on === 'fav' ? Array.from(ctx.S.favs).concat(EMO.slice(18).map((e) => e.img)).slice(0, 18) : POOL.filter((x) => x.t.includes(on)).map((x) => x.img).concat(EMO.slice(0, 12).map((e) => e.img)).slice(0, 18);
  return '<div class="pop picker" style="left:14px;bottom:70px" role="dialog" aria-label="插入贴纸"><div class="picker-h">' + input('搜索贴纸：好耶、哭哭、爱弥斯', { icon: 'search', cls: 'sm', id: 'pk-q-' + ctx.f }) +
    '<div class="picker-tabs">' + tabs.map((t) => '<button data-act="ptab" data-v="' + t[0] + '" class="' + (t[0] === on ? 'is-on' : '') + '">' + (t[2] ? '<img src="' + IMG(t[2]) + '" alt="">' : ic(t[0] === 'recent' ? 'clock' : 'heart', 'sm')) + t[1] + '</button>').join('') + '</div></div>' +
    '<div class="picker-grid">' + list.map((img) => '<button data-act="pick" data-img="' + img + '" aria-label="插入贴纸"><img src="' + IMG(img) + '" loading="lazy" alt=""></button>').join('') + '</div>' +
    '<div class="picker-f"><span>点选插入，每条最多 6 张</span><span>贴纸按表情 ID 保存</span></div></div>';
}
function commentsSection(ctx) {
  const F = ctx.F;
  const pend = F.pending || [];
  const reacts = (re, mine) => REACTIONS.filter((r) => re && re[r.k]).map((r) => '<button class="react' + (mine && mine[r.k] ? ' is-on' : '') + '" data-act="react" title="' + r.t + '"><img src="' + IMG(r.img) + '" alt="' + r.t + '">' + re[r.k] + '</button>').join('') + '<button class="react add" data-act="react" aria-label="添加回应">' + ic('smile', 'sm') + '</button>';
  const roleTag = (c) => (c.role === 'staff' ? '<span class="role staff">站长</span>' : c.role === 'artist' ? '<span class="role artist">画师</span>' : '');
  const one = (c, sm) => '<div class="cmt' + (c.pinned ? ' is-pinned' : '') + (c.gone ? ' is-gone' : '') + '"><span class="avatar' + (sm ? ' sm' : '') + '" style="border-color:var(--c-' + c.c + ');background:color-mix(in srgb,var(--c-' + c.c + ') 30%,var(--tp-card))">' + (c.gone ? '' : esc(c.u.slice(0, 1))) + '</span><div>' +
    '<div class="cmt-h"><b>' + esc(c.u) + '</b>' + roleTag(c) + (c.pinned ? '<span class="role op">' + ic('pin', 'sm') + '置顶</span>' : '') + '<time>' + c.time + '</time></div>' +
    '<div class="cmt-b"><div>' + c.body + '</div>' + (c.stk ? '<div class="stk">' + c.stk.map((s) => '<img src="' + IMG(s) + '" alt="贴纸" loading="lazy">').join('') + '</div>' : '') + '</div>' +
    (c.gone ? '' : '<div class="cmt-f">' + reacts(c.re, c.mine) + '<button class="lnk" data-act="reply">' + ic('reply', 'sm') + '回复</button><button class="lnk" data-act="report">' + ic('flag', 'sm') + '举报</button></div>') +
    (c.replies ? '<div class="cmt-replies">' + c.replies.map((r) => one(r, true)).join('') + (c.more ? '<button class="more-replies" data-act="more">' + ic('down', 'sm') + '展开其余 ' + c.more + ' 条回复</button>' : '') + '</div>' : '') + '</div></div>';
  return '<section class="sec cm" id="comments"><div class="cm-head"><h2>评论</h2><span class="n">128</span>' + seg([['hot', '最热'], ['new', '最新'], ['old', '最早']], F.csort || 'hot', 'csort', 'sm') + '</div>' +
    '<div class="composer">' + (ctx.S.user ? '<div class="who"><span class="avatar sm"><img src="' + IMG(AV('爱弥斯')) + '" alt=""></span>以 <b>今州打工人</b> 的身份评论</div>' : '<div class="guest">' + input('昵称（必填）', { cls: 'sm', id: 'cm-n-' + ctx.f }) + input('邮箱（选填，仅用于回复提醒）', { cls: 'sm', id: 'cm-e-' + ctx.f }) + '</div>') +
    '<textarea class="textarea" id="cm-t-' + ctx.f + '" placeholder="说点什么，或者直接甩一张贴纸">' + (F.draft || '') + '</textarea>' +
    (pend.length ? '<div class="pending-stk">' + pend.map((s, k) => '<span class="bthumb"><img src="' + IMG(s) + '" alt=""><button data-act="unpick" data-k="' + k + '" aria-label="移除贴纸">' + ic('close') + '</button></span>').join('') + '</div>' : '') +
    '<div class="tools"><button class="tbtn' + (F.picker ? ' is-on' : '') + '" data-act="picker" aria-label="插入贴纸">' + ic('smile') + '贴纸</button><button class="tbtn" aria-label="加粗">B</button><button class="tbtn" style="font-style:italic" aria-label="斜体">I</button><button class="tbtn" aria-label="引用">' + ic('quote', 'sm') + '</button><button class="tbtn" aria-label="链接">' + ic('link', 'sm') + '</button>' +
    '<div class="send">' + (ctx.S.user ? '' : '<span class="captcha"><span class="ok">' + ic('check', 'sm') + '</span>人机验证已通过</span>') + '<span class="count">' + (F.draft || '').length + ' / 1000</span>' + btn('发布', { cls: 'primary sm', icon: 'send', act: 'post' }) + '</div></div>' +
    (F.picker ? stickerPicker(ctx) : '') + '</div>' +
    '<div>' + COMMENTS.map((c) => one(c)).join('') + '</div><div class="loadmore">' + btn('加载更多评论', { cls: 'sm', act: 'more' }) + '</div></section>';
}
function modal(title, body, acts) {
  return '<div class="scrim" data-act="close"></div><div class="modal-wrap"><div class="modal" role="dialog" aria-label="' + title + '"><div class="modal-body">' + body.icon + '<h3>' + title + '</h3><p>' + body.text + '</p><div class="acts">' + acts + '</div></div></div></div>';
}
// ---------- admin shell ----------
const ADM_NAV = [
  ['概览', [['a-dash', '仪表盘', 'gauge', 0, 'dash']]],
  ['内容', [['a-review', '投稿审核', 'inbox', PENDING_SUBS, 'review'], ['a-packs', '表情包', 'grid', 0, 'packs'], ['a-upload', '上传中心', 'upload', 0, 'upload'], ['a-emojis', '表情库', 'image', 0, 'packs'], ['a-chars', '角色', 'users', 0, 'taxonomy'], ['a-artists', '画师', 'edit', 0, 'taxonomy'], ['a-tags', '标签', 'hash', 0, 'taxonomy']]],
  ['社区', [['a-comments', '评论审核', 'chat', 12, 'comments'], ['a-users', '用户与权限', 'user', 0, 'users']]],
  ['系统', [['a-downloads', '下载与风控', 'shield', 0, 'downloads'], ['a-storage', '存储 R2', 'cloud', 0, 'storage'], ['a-jobs', '任务队列', 'layers', 3, 'system'], ['a-audit', '审计日志', 'history', 0, 'audit'], ['a-settings', '系统设置', 'sliders', 0, 'settings']]]
];
function adminShell(ctx, active, crumbs, inner) {
  const role = ctx.S.role || 'admin';
  const item = ADM_NAV.flatMap((g) => g[1]).find((x) => x[0] === active);
  const allowed = !item || can(role, item[4]);
  const nav = ADM_NAV.map((g) => { const its = g[1].filter((x) => can(role, x[4])); return its.length ? '<h5>' + g[0] + '</h5>' + its.map((x) => '<a href="#" data-go="' + x[0] + '"' + (x[0] === active ? ' aria-current="page"' : '') + '>' + ic(x[2]) + x[1] + (x[3] ? '<span class="badge-dot">' + x[3] + '</span>' : '') + '</a>').join('') : ''; }).join('');
  const who = role === 'admin' ? [SITE.name + '站长', '站'] : ['海风', '海'];
  const body = allowed ? inner : '<div class="empty" style="padding-top:80px">' + emptyArt() + '<h3>' + ROLES[role].name + '没有「' + (item ? item[1] : '') + '」的权限</h3><p>用户、存储、任务、审计和系统设置只对站长开放。需要调整时请联系站长。</p>' + btn('回到仪表盘', { go: 'a-dash', cls: 'sm' }) + '</div>';
  return '<div class="adm"><aside class="adm-side"><div class="adm-logo">' + logoMark() + '<div><b>' + SITE.name + '</b><small>管理台</small></div></div><nav class="adm-nav" aria-label="后台导航">' + nav +
    '</nav><div class="adm-me"><span class="avatar sm" style="border-color:var(--c-teal)">' + who[1] + '</span><div><b>' + who[0] + '</b><small>' + ROLES[role].name + '</small></div><button class="ibtn" style="margin-left:auto" aria-label="退出登录">' + ic('logout') + '</button></div></aside>' +
    '<div class="adm-main"><header class="adm-top"><button class="ibtn adm-burger" data-act="adm-menu" aria-label="打开菜单">' + ic('menu') + '</button><div class="crumbs">' + crumbs.map((c, k) => (k ? ic('right') : '') + '<span>' + c + '</span>').join('') + '</div>' +
    '<div class="design-only" title="设计稿专用：切换查看身份">' + seg([['admin', '站长'], ['manager', '管理员']], role, 'role', 'sm') + '</div>' +
    input('搜索包、表情 ID、用户', { icon: 'search', id: 'adm-q-' + ctx.f }) + '<button class="ibtn hide-sm" data-go="home" aria-label="查看前台" title="查看前台">' + ic('external') + '</button><button class="ibtn" aria-label="通知" style="position:relative">' + ic('bell') + '</button></header>' +
    '<div class="adm-body">' + body + '</div></div></div>';
}
function kpi(k, v, d, o) {
  o = o || {};
  const pts = o.spark || [];
  const max = Math.max.apply(null, pts.concat([1])), min = Math.min.apply(null, pts.concat([0]));
  const P = pts.map((y, x) => [x * (84 / Math.max(1, pts.length - 1)), 28 - ((y - min) / Math.max(1, max - min)) * 24]);
  const line = P.map((p, x) => (x ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return '<div class="kpi' + (o.alert ? ' alert' : '') + '"><span class="k">' + (o.icon ? ic(o.icon, 'sm') : '') + k + '</span><span class="v">' + v + '</span>' + (d ? '<span class="d' + (o.down ? ' down' : '') + '">' + ic(o.down ? 'down' : 'up', 'sm') + d + '</span>' : '<span class="d" style="color:var(--tp-muted)">' + (o.note || '') + '</span>') +
    (pts.length ? '<svg class="spark" viewBox="0 0 84 30" aria-hidden="true"><path class="a" d="' + line + ' L84 30 L0 30z"/><path class="l" d="' + line + '"/></svg>' : '') + '</div>';
}
function areaChart(series, o) {
  o = o || {};
  const W = 640, H = 220, pl = 40, pr = 10, pt = 14, pb = 26;
  const max = Math.ceil(Math.max.apply(null, series.concat(o.series2 || [])) / 1000) * 1000;
  const X = (i) => pl + i * ((W - pl - pr) / (series.length - 1)), Y = (v) => pt + (1 - v / max) * (H - pt - pb);
  const d = series.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
  const d2 = o.series2 ? o.series2.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ') : '';
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => '<line class="grid" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(max * t) + '" y2="' + Y(max * t) + '"/><text class="ax" x="' + (pl - 6) + '" y="' + (Y(max * t) + 4) + '" text-anchor="end">' + (max * t >= 1000 ? (max * t / 1000) + 'k' : max * t) + '</text>').join('');
  const xl = [0, 7, 14, 21, 29].map((i) => '<text class="ax" x="' + X(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + (o.labels ? o.labels[i] : i) + '</text>').join('');
  const last = series.length - 1;
  return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + (o.label || '趋势图') + '">' + ticks + xl + '<path class="area" d="' + d + ' L' + X(last) + ' ' + Y(0) + ' L' + X(0) + ' ' + Y(0) + 'z"/>' + (d2 ? '<path class="line2" d="' + d2 + '"/>' : '') + '<path class="line" d="' + d + '"/><circle class="dot" cx="' + X(last) + '" cy="' + Y(series[last]) + '" r="5"/></svg>';
}
