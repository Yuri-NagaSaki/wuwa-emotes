// ---------- board runtime ----------
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const DEV = { desktop: { w: 1280, h: 800, chrome: 34 }, phone: { w: 390, h: 844, chrome: 0 } };
const S = {
  page: 'ds', params: {}, theme: 'light', still: false, notes: true, device: null,
  bottle: new Set([EMO[0].img, EMO[3].img, EMO[8].img, PACKS[1].cover]),
  favs: new Set([EMO[2].img]), user: null, annClosed: false
};
const FS = [{}, {}];
const frames = [];
let focusFrame = 0;
const pageById = (id) => PAGES.find((p) => p.id === id) || PAGES[0];
const safe = (fn) => { try { return fn(); } catch (e) { return null; } };

// ---------- index + notes ----------
function renderNav() {
  const q = ($('#bd-find').value || '').trim().toLowerCase();
  const groups = [['ds', '设计系统'], ['pub', '公开页'], ['adm', '后台页']];
  $('#bd-nav').innerHTML = groups.map((g) => {
    const items = PAGES.filter((p) => p.group === g[0] && (!q || (p.title + p.route).toLowerCase().includes(q)));
    if (!items.length) return '';
    return '<div class="bd-group"><h4>' + g[1] + '<span>' + items.length + '</span></h4>' + items.map((p) => '<button class="bd-item" data-bd="go" data-v="' + p.id + '"' + (p.id === S.page ? ' aria-current="page"' : '') + '><span>' + p.title + '<small>' + esc(p.route) + '</small></span><i class="bd-fid' + (p.fid === 'hi' ? '' : ' lite') + '" title="' + (p.fid === 'hi' ? '高保真' : '标准保真') + '"></i></button>').join('') + '</div>';
  }).join('');
}
function renderNotes() {
  const p = pageById(S.page), n = p.notes || {};
  const sec = (t, arr) => (arr && arr.length ? '<div class="bd-note"><h5>' + t + '</h5><ul>' + arr.map((x) => '<li>' + x.replace(/`([^`]+)`/g, '<code>$1</code>') + '</li>').join('') + '</ul></div>' : '');
  $('#bd-notes').innerHTML = '<div class="bd-head" style="display:grid;gap:8px"><span class="bd-fidtag"><i class="bd-fid' + (p.fid === 'hi' ? '' : ' lite') + '"></i>' + (p.fid === 'hi' ? '高保真' : '标准保真') + ' · ' + (p.group === 'adm' ? '后台页' : p.group === 'ds' ? '设计系统' : '公开页') + '</span><h3>' + p.title + '</h3><p class="lead">' + (n.goal || '') + '</p>' +
    (p.demos && p.demos.length ? '<div class="bd-note"><h5>演示状态</h5><div class="bd-demos">' + p.demos.map((d) => '<button data-bd="demo" data-v="' + d[1] + '">' + d[0] + '</button>').join('') + '</div></div>' : '') + '</div>' +
    sec('组成', n.parts) + sec('交互与动效', n.motion) + sec('数据与接口', n.data) + sec('权限', n.perm) + sec('性能', n.perf) + sec('移动端', n.mobile) +
    '<div class="bd-note"><h5>说明</h5><ul><li>表情图片为 R2 中的真实素材（缩小后的 WebP），版权归原画师与官方，仅用于设计评审。</li><li>评论、用户、任务、审计等内容为示例数据。</li></ul></div>';
}
function syncBar() {
  const p = pageById(S.page);
  $('#bd-title').textContent = p.title; $('#bd-route').textContent = p.route;
  $$('[data-bd="dev"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === S.device)));
  $$('[data-bd="theme"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === S.theme)));
  $('[data-bd="notes"]').setAttribute('aria-pressed', String(S.notes));
  $('#bd-work').classList.toggle('no-notes', !S.notes);
  $('#bd-notes').hidden = !S.notes;
}

// ---------- frames ----------
function buildStage() {
  const stage = $('#bd-stage');
  stage.innerHTML = '';
  frames.length = 0;
  const kinds = S.device === 'split' ? ['desktop', 'phone'] : [S.device];
  kinds.forEach((kind, i) => {
    const d = DEV[kind];
    const dev = document.createElement('div'); dev.className = 'bd-dev';
    dev.innerHTML = '<span class="bd-dev-label">' + (kind === 'desktop' ? 'DESKTOP · 1280' : 'PHONE · 390') + '</span>';
    const slot = document.createElement('div'); slot.className = 'bd-slot';
    const fr = document.createElement('div'); fr.className = 'bd-frame is-' + kind;
    fr.style.width = d.w + 'px'; fr.style.height = (d.h + d.chrome) + 'px';
    fr.innerHTML = (kind === 'desktop'
      ? '<div class="bd-chrome"><i></i><i></i><i></i><span class="url"></span></div>'
      : '<div class="bd-chrome"><span>9:41</span><span class="notch"></span><span class="sig"><b></b></span></div><span class="bd-home-ind"></span>') +
      '<div class="tp" style="top:' + d.chrome + 'px' + (kind === 'phone' ? ';--safe-top:44px;--safe-bottom:22px' : '') + '"><div class="tp-scroll"></div><div class="tp-layer"></div></div>';
    slot.appendChild(fr); dev.appendChild(slot); stage.appendChild(dev);
    const idx = kind === 'desktop' ? 0 : (kinds.length === 1 ? 0 : 1);
    const st = FS[kind === 'desktop' ? 0 : 1];
    frames.push({ kind, d, slot, fr, tp: $('.tp', fr), sc: $('.tp-scroll', fr), ly: $('.tp-layer', fr), st, i: frames.length });
    bindFrame(frames[frames.length - 1]);
  });
  fit();
}
function fit() {
  const canvas = $('#bd-canvas');
  const W = canvas.clientWidth - 48;
  frames.forEach((f) => {
    let s;
    if (S.device === 'split') {
      const ps = Math.min(0.86, Math.max(0.6, (W * 0.3) / 390));
      if (f.kind === 'phone') s = ps;
      else s = Math.max(0.3, Math.min(1, (W - 390 * ps - 32) / 1280));
    } else if (f.kind === 'desktop') s = Math.min(1, W / 1280);
    else s = Math.min(1, (canvas.clientWidth - 24) / 390);
    f.s = s;
    f.fr.style.transform = 'scale(' + s + ')';
    f.slot.style.width = (f.d.w * s) + 'px';
    f.slot.style.height = ((f.d.h + f.d.chrome) * s) + 'px';
  });
}
function ctxFor(f) { return { S, F: f.st, f: f.i, layer: [], params: S.params, kind: f.kind }; }
function renderFrame(f, keepScroll) {
  const p = pageById(S.page);
  if (p.autoOv && f.st.ov === undefined) Object.assign(f.st, p.autoOv);
  const ctx = ctxFor(f);
  const top = f.sc.scrollTop;
  f.tp.dataset.tpTheme = S.theme;
  f.tp.classList.toggle('is-still', S.still);
  let html = '';
  try { html = p.render(ctx); } catch (e) { html = '<div style="padding:24px;color:#b00">渲染出错：' + esc(e.message) + '</div>'; console.error(e); }
  f.sc.classList.toggle('is-admin', p.group === 'adm');
  f.sc.innerHTML = html;
  f.base = ctx.layer.join('');
  renderLayer(f);
  if (f.kind === 'desktop') { const u = $('.url', f.fr); if (u) u.textContent = SITE.domain + p.route; }
  f.sc.scrollTop = keepScroll ? top : 0;
  layoutMasonry(f);
  if (f.st.autoplay) setAutoplay(f, true);
}
function renderLayer(f) {
  const ctx = ctxFor(f);
  let ov = '';
  const o = f.st.ov;
  if (o === 'lightbox') ov = lightbox(ctx);
  else if (o === 'bottle') ov = bottleDrawer(ctx);
  else if (o === 'cmdk') ov = cmdk(ctx);
  else if (o === 'zipmodal') ov = modal('打包下载 25 张原图', { icon: '<span class="modal-ico">' + ic('box', 'lg') + '</span>', text: '原图 ZIP 约 16.5 MB，内含 CREDITS.txt（署名与许可）。不需要登录。' }, btn('开始下载', { cls: 'primary', icon: 'download', act: 'close' }) + btn('取消', { act: 'close' }));
  else if (o === 'limitmodal') ov = modal('今天下载得有点多', { icon: '<span class="modal-ico">' + ic('clock', 'lg') + '</span>', text: '这个网络今天已下载 300 张原图，达到站长设置的上限。WebP 预览不受影响；明天 0 点恢复，登录后上限更高。' }, btn('登录', { cls: 'primary', go: 'login' }) + btn('知道了', { act: 'close' }));
  else if (o === 'rejectmodal') ov = modal('退回这条投稿？', { icon: '<span class="modal-ico">' + ic('reply', 'lg') + '</span>', text: '投稿者会在「我的投稿」里看到原因，修改后可以重新提交。<span class="chips" style="justify-content:center;margin-top:12px">' + ['缺少画师授权说明', '与已有包重复', '与鸣潮无关', '标题或角色不规范'].map((t, k) => chip(t, { sm: true, on: k === 0 })).join('') + '</span>' }, btn('退回', { cls: 'primary', act: 'reject-ok' }) + btn('取消', { act: 'close' }));
  else if (o === 'delmodal') ov = modal('删除这个表情包？', { icon: '<span style="color:var(--tp-err)">' + ic('trash', 'lg') + '</span>', text: '25 张表情、ZIP 和衍生图会进入 7 天回收期，期间可恢复；前台链接立即失效并返回 410。' }, btn('删除', { cls: 'danger', act: 'close' }) + btn('取消', { act: 'close' }));
  else if (o === 'longpress') ov = '<div class="scrim" data-act="close"></div><aside class="drawer" role="dialog" aria-label="表情操作"><span class="grab"></span><div class="drawer-h"><img src="' + IMG(EMO[f.st.lp || 0].img) + '" width="48" height="48" style="border-radius:12px;background:var(--tp-input)" alt=""><div><h3>第 ' + ((f.st.lp || 0) + 1) + ' 张</h3><span class="hint">GIF · ' + fmtB(EMO[f.st.lp || 0].bytes) + '</span></div><button class="icon-btn x" data-act="close" aria-label="关闭">' + ic('close') + '</button></div><div class="drawer-b" style="gap:10px">' +
    [['image', '保存到相册', '微信内请长按大图保存'], ['copy', '复制图片', '仅静态 PNG'], ['download', '保存原图', 'GIF 原文件'], ['box', '加入打包', ''], ['heart', '收藏', ''], ['share', '分享链接', '']].map((a) => '<button class="set-row" data-act="close" style="text-align:left;border-radius:16px">' + ic(a[0]) + '<div><b>' + a[1] + '</b>' + (a[2] ? '<small>' + a[2] + '</small>' : '') + '</div></button>').join('') + '</div></aside>';
  else if (o === 'filters') ov = '<div class="scrim" data-act="close"></div><aside class="drawer" role="dialog" aria-label="筛选"><span class="grab"></span><div class="drawer-h"><h3>筛选</h3><button class="icon-btn x" data-act="close" aria-label="关闭">' + ic('close') + '</button></div><div class="drawer-b">' +
    '<div><h4 style="font-size:14px;margin-bottom:8px">类型</h4><div class="chips">' + chip('全部', { sm: true, on: true }) + chip('动态', { sm: true, n: 225 }) + chip('静态', { sm: true, n: 85 }) + '</div></div><div><h4 style="font-size:14px;margin-bottom:8px">角色</h4><div class="chips">' + topChars.slice(0, 10).map((c, k) => chip(c.name, { sm: true, av: c.avatar, cc: c.color, on: k === 0 })).join('') + '</div></div><div><h4 style="font-size:14px;margin-bottom:8px">来源</h4><div class="chips">' + chip('社区约稿', { sm: true }) + chip('官方转载', { sm: true }) + '</div></div></div><div class="drawer-f" style="grid-template-columns:1fr 2fr">' + btn('重置', { act: 'fclear' }) + btn('查看 18 个结果', { cls: 'primary', act: 'close' }) + '</div></aside>';
  else if (o === 'admmenu') ov = '<div class="scrim" data-act="close"></div><aside class="drawer" style="left:0;right:auto;border-radius:0 28px 28px 0;top:0;bottom:0;max-height:none;animation-name:tp-fade;width:82%"><div class="adm-logo" style="padding-top:calc(14px + var(--safe-top))">' + logoMark() + '<div><b>' + SITE.name + '</b><small>管理台</small></div></div><nav class="adm-nav">' + ADM_NAV.map((g) => { const its = g[1].filter((x) => can(S.role || 'admin', x[4])); return its.length ? '<h5>' + g[0] + '</h5>' + its.map((x) => '<a href="#" data-go="' + x[0] + '"' + (x[0] === S.page ? ' aria-current="page"' : '') + '>' + ic(x[2]) + x[1] + '</a>').join('') : ''; }).join('') + '</nav></aside>';
  f.ly.innerHTML = (f.base || '') + ov + '<div class="toast-zone"></div>';
}
function rerenderAll(keep) { frames.forEach((f) => renderFrame(f, keep)); }
function relayers() { frames.forEach((f) => { const ctx = ctxFor(f); const p = pageById(S.page); try { p.render(ctx); } catch (e) {} f.base = ctx.layer.join(''); renderLayer(f); }); }

// ---------- masonry (shortest column; widths known before images load) ----------
function layoutMasonry(f) {
  $$('[data-masonry]', f.sc).forEach((m) => {
    if (m.classList.contains('is-laid')) {
      const items = $$('.mcol > *', m); m.innerHTML = ''; items.sort((a, b) => (+a.dataset.mi) - (+b.dataset.mi)).forEach((x) => m.appendChild(x)); m.classList.remove('is-laid');
    }
    const kids = Array.from(m.children);
    kids.forEach((k, i) => (k.dataset.mi = i));
    const cs = getComputedStyle(m);
    const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length || 1;
    if (cols < 2) return;
    const gap = parseFloat(cs.rowGap) || 16;
    const hs = kids.map((k) => k.getBoundingClientRect().height / (f.s || 1));
    const colEls = Array.from({ length: cols }, () => { const c = document.createElement('div'); c.className = 'mcol'; return c; });
    const acc = new Array(cols).fill(0);
    kids.forEach((k, i) => { let j = 0; for (let c = 1; c < cols; c++) if (acc[c] < acc[j] - 1) j = c; colEls[j].appendChild(k); acc[j] += hs[i] + gap; });
    m.classList.add('is-laid'); colEls.forEach((c) => m.appendChild(c));
  });
}
function setAutoplay(f, on) {
  $$('.tile img[data-anim]', f.sc).forEach((img) => { if (!img.dataset.still) img.dataset.still = img.getAttribute('src'); img.src = on ? img.dataset.anim : img.dataset.still; });
}

// ---------- interactions ----------
function toast(f, html) {
  frames.forEach((fr) => { if (fr !== f && f) return; const z = $('.toast-zone', fr.ly); if (!z) return; const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = html; z.appendChild(t); setTimeout(() => t.remove(), 2500); });
}
function bumpCounts() {
  frames.forEach((f) => {
    $$('.bottle-btn .count, .fab-bottle .count', f.fr).forEach((c) => (c.textContent = S.bottle.size));
    const fab = $('.fab-bottle', f.fr); if (fab) fab.classList.toggle('is-on', S.bottle.size > 0);
    const b = $('.bottle-btn', f.fr); if (b) { b.classList.remove('is-bump'); void b.offsetWidth; b.classList.add('is-bump'); }
    if (f.st.ov === 'bottle') renderLayer(f);
  });
}
function flyToBottle(f, fromEl, img) {
  const target = (f.kind === 'phone' ? $('.fab-bottle.is-on', f.ly) || $('.bottle-btn', f.fr) : $('.bottle-btn', f.fr));
  if (!fromEl || !target || S.still || !f.tp.animate) { bumpCounts(); return; }
  const R0 = f.tp.getBoundingClientRect(), a = fromEl.getBoundingClientRect(), b = target.getBoundingClientRect(), s = f.s || 1;
  const x0 = (a.left - R0.left) / s + a.width / s / 2 - 32, y0 = (a.top - R0.top) / s + a.height / s / 2 - 32;
  const x1 = (b.left - R0.left) / s + b.width / s / 2 - 32, y1 = (b.top - R0.top) / s + b.height / s / 2 - 32;
  const el = document.createElement('div'); el.className = 'fly'; el.innerHTML = '<img src="' + IMG(img) + '" alt="">'; el.style.left = '0'; el.style.top = '0';
  f.ly.appendChild(el);
  const mx = (x0 + x1) / 2, my = Math.min(y0, y1) - 120;
  const an = el.animate([
    { transform: 'translate(' + x0 + 'px,' + y0 + 'px) scale(1) rotate(0deg)' },
    { transform: 'translate(' + mx + 'px,' + my + 'px) scale(0.8) rotate(-14deg)', offset: 0.45 },
    { transform: 'translate(' + x1 + 'px,' + y1 + 'px) scale(0.25) rotate(8deg)', opacity: 0.4 }
  ], { duration: 700, easing: 'cubic-bezier(0.4,0,0.2,1)' });
  an.onfinish = () => { el.remove(); bumpCounts(); };
}
function imgOfIndex(f, i) {
  const t = $('.tile[data-i="' + i + '"]', f.sc);
  return t ? t.dataset.img : (EMO[i % EMO.length] || EMO[0]).img;
}
function navigate(go) {
  const [page, param] = go.split(':');
  if (page === 'char') S.params = { char: param || '爱弥斯' };
  const id = page === 'pack' ? 'pack' : page;
  if (!PAGES.find((p) => p.id === id)) return;
  S.page = id;
  FS.forEach((st) => { Object.keys(st).forEach((k) => delete st[k]); });
  try { history.replaceState(null, '', '#' + id); } catch (e) {}
  renderNav(); renderNotes(); syncBar();
  const run = () => rerenderAll(false);
  if (document.startViewTransition && !S.still) safe(() => document.startViewTransition(run)) || run(); else run();
}
function act(f, el, a, ev) {
  const st = f.st, v = el.dataset.v, i = el.dataset.i != null ? +el.dataset.i : null;
  const reLayer = () => renderLayer(f);
  const reFrame = () => renderFrame(f, true);
  switch (a) {
    case 'cmdk': st.ov = 'cmdk'; reLayer(); break;
    case 'bottle': st.ov = 'bottle'; reLayer(); break;
    case 'close': st.ov = null; st.zip = null; st.orig = false; reLayer(); break;
    case 'close-drawer': st.noDrawer = true; reFrame(); break;
    case 'lightbox': st.ov = 'lightbox'; st.orig = false; st.lb = Math.max(0, (i || 0) % EMO.length); reLayer(); break;
    case 'lb-prev': st.orig = false; st.lb = (st.lb + EMO.length - 1) % EMO.length; reLayer(); break;
    case 'lb-next': st.orig = false; st.lb = (st.lb + 1) % EMO.length; reLayer(); break;
    case 'lb-go': st.orig = false; st.lb = (i || 0) % EMO.length; reLayer(); break;
    case 'orig': st.orig = !st.orig; reLayer(); if (st.orig) toast(f, ic('image') + '已加载原图 <small>' + (EMO[st.lb].fmt || 'gif').toUpperCase() + ' · ' + fmtB(EMO[st.lb].bytes) + '</small>'); break;
    case 'random': st.ov = 'lightbox'; st.lb = Math.floor(Math.random() * EMO.length); reLayer(); toast(f, ic('dice') + '从 1,640 张里抽到了第 ' + (st.lb + 1) + ' 张'); break;
    case 'copy': toast(f, ic('copy') + '已复制静态 PNG <small>动图请下载 GIF</small>'); break;
    case 'dl1': toast(f, ic('download') + '开始下载 <small>设计稿不触发真实下载</small>'); break;
    case 'add': {
      const img = st.ov === 'lightbox' ? EMO[st.lb].img : imgOfIndex(f, i);
      const from = st.ov === 'lightbox' ? $('.em-media img', f.ly) : (el.closest('.tile') || el);
      if (S.bottle.has(img)) { toast(f, ic('box') + '已经在打包清单里了'); break; }
      S.bottle.add(img); flyToBottle(f, from, img); toast(f, ic('box') + '已加入打包 <small>共 ' + S.bottle.size + ' 张</small>');
      frames.forEach((o) => { if (o !== f) bumpCounts(); }); break;
    }
    case 'fav1': {
      const img = st.ov === 'lightbox' ? EMO[st.lb].img : imgOfIndex(f, i);
      if (S.favs.has(img)) S.favs.delete(img); else S.favs.add(img);
      el.classList.toggle('is-fav', S.favs.has(img)); toast(f, ic('heart') + (S.favs.has(img) ? '已收藏到「默认收藏夹」' : '已取消收藏')); break;
    }
    case 'fav-pack': if (S.favs.has('pack')) S.favs.delete('pack'); else S.favs.add('pack'); rerenderAll(true); toast(f, ic('heart') + (S.favs.has('pack') ? '已收藏这个包' : '已取消收藏')); break;
    case 'selmode': st.selecting = !st.selecting; st.sel = new Set(); reFrame(); break;
    case 'demo-select': st.selecting = true; st.sel = new Set([0, 1, 2, 4, 7, 9]); reFrame(); break;
    case 'toggle': { st.sel = st.sel || new Set(); if (st.sel.has(i)) st.sel.delete(i); else st.sel.add(i); reFrame(); break; }
    case 'add-sel': { const imgs = Array.from(st.sel || []).map((k) => EMO[k].img); imgs.forEach((x) => S.bottle.add(x)); const first = $('.tile.is-sel', f.sc); st.selecting = false; st.sel = new Set(); flyToBottle(f, first, imgs[0] || EMO[0].img); reFrame(); toast(f, ic('box') + '已放进 ' + imgs.length + ' 张 <small>共 ' + S.bottle.size + ' 张</small>'); break; }
    case 'add-all': EMO.forEach((e) => S.bottle.add(e.img)); st.ov = null; reLayer(); bumpCounts(); toast(f, ic('box') + '整包 25 张已加入打包'); break;
    case 'unbottle': S.bottle.delete(el.dataset.img); bumpCounts(); if (S.page === 'bottle') reFrame(); break;
    case 'zfmt': st.fmt = v; reLayer(); break;
    case 'zip': {
      st.zip = 0; reLayer();
      const tick = setInterval(() => { st.zip = Math.min(100, st.zip + 7 + Math.round(Math.random() * 9)); if (st.ov !== 'bottle') { clearInterval(tick); return; } reLayer(); if (st.zip >= 100) clearInterval(tick); }, 180);
      break;
    }
    case 'zip-reset': st.zip = null; reLayer(); break;
    case 'zip-page': {
      st.zip = 0; reFrame();
      const tick = setInterval(() => { if (S.page !== 'bottle' || st.zip == null) { clearInterval(tick); return; } st.zip = Math.min(100, st.zip + 7 + Math.round(Math.random() * 9)); reFrame(); if (st.zip >= 100) clearInterval(tick); }, 180);
      break;
    }
    case 'zip-pack': st.ov = 'zipmodal'; reLayer(); break;
    case 'confirm-del': st.ov = 'delmodal'; reLayer(); break;
    case 'share': toast(f, ic('link') + '链接已复制'); break;
    case 'autoplay': st.autoplay = !st.autoplay; el.setAttribute('aria-checked', String(st.autoplay)); setAutoplay(f, st.autoplay); break;
    case 'picker': st.picker = !st.picker; reFrame(); break;
    case 'ptab': st.ptab = v; reFrame(); break;
    case 'pick': st.pending = st.pending || []; if (st.pending.length >= 6) { toast(f, ic('warn') + '每条评论最多 6 张贴纸'); break; } st.pending.push(el.dataset.img); st.picker = false; reFrame(); break;
    case 'unpick': st.pending.splice(+el.dataset.k, 1); reFrame(); break;
    case 'post': toast(f, S.user ? ic('check') + '评论已发布' : ic('shield') + '已提交 <small>首条评论需审核，通常几分钟内通过</small>'); st.pending = []; break;
    case 'react': el.classList.toggle('is-on'); break;
    case 'csort': st.csort = v; reFrame(); break;
    case 'sort': st.sort = v; reFrame(); break;
    case 'fchar': { st.fchars = st.fchars || ['爱弥斯']; const k = st.fchars.indexOf(v); if (k >= 0) st.fchars.splice(k, 1); else st.fchars.push(v); reFrame(); break; }
    case 'fclear': st.fchars = []; st.ov = null; reFrame(); break;
    case 'filter-sheet': st.ov = 'filters'; reLayer(); break;
    case 'fpop': if (f.kind === 'phone' && v) { st.ov = 'filters'; reLayer(); } else { st.fpop = v && st.fpop !== v ? v : null; reFrame(); } break;
    case 'role': S.role = v; rerenderAll(true); break;
    case 'rtab': st.rtab = v; reFrame(); break;
    case 'approve': { const c = el.closest('.rv'); if (c) c.classList.add('is-done'); toast(f, ic('check') + '已通过并发布 <small>已通知投稿者</small>'); break; }
    case 'reject': st.ov = 'rejectmodal'; reLayer(); break;
    case 'reject-ok': st.ov = null; reLayer(); toast(f, ic('reply') + '已退回 <small>投稿者会看到原因</small>'); break;
    case 'submit-go': {
      // straight to 我的投稿 (no view transition, so the toast survives the re-render)
      S.page = 'me'; FS.forEach((x) => { Object.keys(x).forEach((k) => delete x[k]); x.mtab = 'sub'; });
      try { history.replaceState(null, '', '#me'); } catch (e) {}
      renderNav(); renderNotes(); syncBar(); rerenderAll(false);
      toast(null, ic('check') + '已提交审核 <small>结果会通知你</small>'); break;
    }
    case 'shuffle': st.seed = (st.seed || 1) + 1; reFrame(); toast(f, ic('shuffle') + '换了一批'); break;
    case 'ctab': st.ctab = v; reFrame(); break;
    case 'mtab': st.mtab = v; reFrame(); break;
    case 'qtab': st.qtab = v; reFrame(); break;
    case 'stab': st.stab = v; reFrame(); break;
    case 'auth-reset': st.auth = 'reset'; reFrame(); break;
    case 'auth-sent': st.auth = 'sent'; reFrame(); break;
    case 'auth-sent2': toast(f, ic('mail') + '验证邮件已发送'); break;
    case 'auth-form': st.auth = 'form'; reFrame(); break;
    case 'login': S.user = { n: '今州打工人' }; toast(f, ic('check') + '欢迎回来'); navigate('me'); break;
    case 'ann-close': S.annClosed = true; rerenderAll(true); break;
    case 'report': toast(f, ic('flag') + '已举报 <small>管理员会尽快处理</small>'); break;
    case 'reply': { const t = $('textarea', f.sc); if (t) { t.value = '@' + (el.closest('.cmt').querySelector('.cmt-h b') || {}).textContent + ' '; t.focus({ preventScroll: false }); } break; }
    case 'more': toast(f, '<span class="wave-loader" style="height:14px"><i></i><i></i><i></i></span>正在加载'); break;
    case 'adm-menu': st.ov = 'admmenu'; reLayer(); break;
    case 'merge': toast(f, ic('merge') + '在下方确认合并'); break;
    case 'ripple': break;
    case 'squish-demo': break;
    case 'noop': case 'view': {
      const grp = el.parentElement; if (grp && grp.classList.contains('seg')) $$('button', grp).forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
      if (el.classList.contains('switch')) el.setAttribute('aria-checked', String(el.getAttribute('aria-checked') !== 'true'));
      break;
    }
    default: break;
  }
}
function bindFrame(f) {
  const root = f.fr;
  root.addEventListener('click', (ev) => {
    focusFrame = frames.indexOf(f);
    const t = ev.target.closest('[data-go],[data-act]');
    if (!t || !root.contains(t)) return;
    ev.preventDefault();
    // inside a frame, 打包 opens the tray; the page index still navigates to /batch
    if (t.dataset.go) { if (t.dataset.go === 'bottle' && S.page !== 'bottle') { f.st.ov = 'bottle'; renderLayer(f); return; } navigate(t.dataset.go); return; }
    act(f, t, t.dataset.act, ev);
  });
  root.addEventListener('pointerdown', (ev) => {
    const b = ev.target.closest('.btn');
    if (b) { const r = b.getBoundingClientRect(); b.style.setProperty('--rx', ((ev.clientX - r.left) / (f.s || 1)) + 'px'); b.style.setProperty('--ry', ((ev.clientY - r.top) / (f.s || 1)) + 'px'); b.classList.remove('is-ripple'); void b.offsetWidth; b.classList.add('is-ripple'); }
    const tl = ev.target.closest('.tile');
    if (tl && !ev.target.closest('.tile-acts')) { tl.classList.remove('is-squish'); void tl.offsetWidth; tl.classList.add('is-squish'); }
  });
  root.addEventListener('animationend', (ev) => { if (ev.target.classList.contains('is-squish')) ev.target.classList.remove('is-squish'); });
  root.addEventListener('pointerover', (ev) => {
    const img = ev.target.closest('img[data-anim]');
    if (img && !f.st.autoplay && f.kind !== 'phone') { if (!img.dataset.still) img.dataset.still = img.getAttribute('src'); img.src = img.dataset.anim; }
  });
  root.addEventListener('pointerout', (ev) => {
    const img = ev.target.closest('img[data-anim]');
    if (img && !f.st.autoplay && img.dataset.still && !img.contains(ev.relatedTarget)) img.src = img.dataset.still;
  });
  let lp = null;
  root.addEventListener('pointerdown', (ev) => {
    const tl = ev.target.closest('.tile'); if (!tl || f.kind !== 'phone') return;
    lp = setTimeout(() => { f.st.ov = 'longpress'; f.st.lp = +tl.dataset.i % EMO.length; renderLayer(f); }, 550);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((n) => root.addEventListener(n, () => { clearTimeout(lp); }));
}

// ---------- board controls ----------
function setDevice(dv) { S.device = dv; syncBar(); buildStage(); rerenderAll(false); }
function demo(v) {
  if (v === 'night') { S.theme = S.theme === 'night' ? 'light' : 'night'; syncBar(); rerenderAll(true); return; }
  if (v === 'still') { S.still = !S.still; rerenderAll(true); return; }
  if (v === 'preview-only') { S.previewOnly = !S.previewOnly; frames.forEach((f) => { f.st.ov = null; }); rerenderAll(true); return; }
  if (v === 'zip') S.user = S.user || { n: '今州打工人' };
  if (v === 'char-daniya') { navigate('char:达妮娅'); return; }
  if (v === 'ctab-all') { frames.forEach((f) => { f.st.ctab = 'all'; renderFrame(f, true); }); return; }
  if (v === 'role-manager') { S.role = S.role === 'manager' ? 'admin' : 'manager'; rerenderAll(true); return; }
  if (v === 'submit-go') { act(frames[0], document.body, 'submit-go'); return; }
  if (/^(mtab|qtab|stab|rtab)-/.test(v)) { const [k, val] = v.split('-'); frames.forEach((f) => { f.st[k] = val; renderFrame(f, true); }); return; }
  frames.forEach((f) => {
    const el = document.createElement('span'); el.dataset.v = '';
    if (v === 'lightbox') { f.st.ov = 'lightbox'; f.st.lb = 4; renderLayer(f); }
    else if (v === 'picker') { f.st.picker = true; renderFrame(f, false); const c = $('#comments', f.sc); if (c) f.sc.scrollTop = c.offsetTop - 80; }
    else if (v === 'zip') { f.st.ov = 'bottle'; renderLayer(f); act(f, el, 'zip'); }
    else if (v === 'fpop-char' || v === 'fpop-artist') { el.dataset.v = v.slice(5); act(f, el, 'fpop'); }
    else if (v === 'limit-demo') { f.st.ov = 'limitmodal'; renderLayer(f); }
    else act(f, el, v);
  });
}
function bindBoard() {
  $('#bd-logo').innerHTML = logoMark();
  // brand and page counts follow config.js / PAGES, so renaming the site or adding a page needs no copy edits here
  const cnt = (g) => PAGES.filter((p) => p.group === g).length;
  $('#bd-name').textContent = SITE.name;
  $('#bd-meta').textContent = '鸣潮表情包站重构 · 设计系统 ' + cnt('ds') + ' · 公开页 ' + cnt('pub') + ' · 后台页 ' + cnt('adm') + ' · 2026-10-20';
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-bd]'); if (!t) return;
    const k = t.dataset.bd, v = t.dataset.v;
    if (k === 'go') { navigate(v); $('#bd').classList.remove('is-menu'); }
    else if (k === 'dev') setDevice(v);
    else if (k === 'theme') { S.theme = v; syncBar(); rerenderAll(true); }
    else if (k === 'notes') { S.notes = !S.notes; syncBar(); fit(); rerenderAll(true); }
    else if (k === 'prev' || k === 'next') { const i = PAGES.findIndex((p) => p.id === S.page); navigate(PAGES[(i + (k === 'next' ? 1 : PAGES.length - 1)) % PAGES.length].id); }
    else if (k === 'menu') $('#bd').classList.toggle('is-menu');
    else if (k === 'demo') demo(v);
  });
  $('#bd-find').addEventListener('input', renderNav);
  document.addEventListener('keydown', (ev) => {
    const f = frames[focusFrame] || frames[0];
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); f.st.ov = 'cmdk'; renderLayer(f); return; }
    if (ev.key === 'Escape') { frames.forEach((x) => { if (x.st.ov) { x.st.ov = null; renderLayer(x); } }); return; }
    const typing = /input|textarea/i.test((document.activeElement || {}).tagName || '');
    if (typing) return;
    if (f.st.ov === 'lightbox' && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) { act(f, document.body, ev.key === 'ArrowLeft' ? 'lb-prev' : 'lb-next'); return; }
    if (!f.st.ov && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && ev.altKey) { const i = PAGES.findIndex((p) => p.id === S.page); navigate(PAGES[(i + (ev.key === 'ArrowRight' ? 1 : PAGES.length - 1)) % PAGES.length].id); }
  });
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { const auto = autoDevice(); if (auto === 'phone' && S.device !== 'phone') setDevice('phone'); else fit(); }, 120); });
}
function autoDevice() { const w = $('#bd-canvas').clientWidth; return w < 700 ? 'phone' : w < 1180 ? 'desktop' : 'split'; }
function boot() {
  const h = safe(() => location.hash.replace('#', '')) || '';
  if (h && PAGES.find((p) => p.id === h)) S.page = h;
  bindBoard(); renderNav(); renderNotes();
  S.device = autoDevice(); syncBar(); buildStage(); rerenderAll(false);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => frames.forEach(layoutMasonry));
}
boot();
