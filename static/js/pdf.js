/* PDF reader built on pdf.js (vendored in static/vendor/pdfjs, so it works offline). */
(() => {
const P = document.getElementById('v-pdf');
// Queries are scoped to this viewer's pane so ids/classes never clash with other viewers.
const $ = (s, r = P) => r.querySelector(s), $$ = (s, r = P) => [...r.querySelectorAll(s)];
const VENDOR = '/static/vendor/pdfjs/';
const GAP = 12, PAD = 24, ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

let lib = null, doc = null, rec = null;
let pages = [];                       // {w, h, el, state, token}
let scale = 1, rotation = 0, fit = 'width', cur = 1, tops = [];
let tab = 'thumbs', matches = [], matchI = -1, searchToken = 0, query = '';
let anns = [], tool = 'select', cat = store.get('pdfCat', 'general'), annPanel = null;
let thumbObserver = null, outlineLoaded = false;

async function pdfjs() {
  if (!lib) {
    lib = await import(VENDOR + 'pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = VENDOR + 'pdf.worker.min.mjs';
  }
  return lib;
}
const scroll = $('#pdfScroll'), holder = $('#pdfPages');
const dims = p => rotation % 180 ? {w: p.h, h: p.w} : {w: p.w, h: p.h};   // page size at scale 1 for the current rotation

/* ---------------- open ---------------- */
Viewers.pdf = async f => {
  rec = f; await closeDoc(); anns = []; closePop(); setTool('select');
  $('#pdfMsg').innerHTML = '<span class="spin"></span> Opening…'; holder.innerHTML = '';
  const saved = store.get('pdf:' + f.path, {});
  rotation = saved.rotation || 0; fit = saved.fit === undefined ? 'width' : saved.fit; scale = saved.scale || 1; query = '';
  $('#pdfQ').value = ''; matches = []; $('#pdfQInfo').hidden = true;
  try {
    const L = await pdfjs();
    const task = L.getDocument({url: '/api/asset?path=' + enc(f.path), cMapUrl: VENDOR + 'cmaps/', cMapPacked: true, standardFontDataUrl: VENDOR + 'standard_fonts/'});
    task.onPassword = async (update, reason) => {
      const pw = await UI.prompt(reason === 2 ? 'Incorrect password' : 'This PDF is password protected', '', {message: reason === 2 ? 'Try again.' : 'Enter the password to open it.', label: 'Password', password: true, confirm: 'Open'});
      if (pw === null) task.destroy(); else update(pw);
    };
    doc = await task.promise;
  } catch (e) {
    $('#pdfMsg').innerHTML = `<div class="empty"><h2>Cannot open this PDF</h2><p>${esc(e.message || 'The file may be damaged or password protected.')}</p>
      <button class="btn" id="pdfExt">Open with system app</button></div>`;
    $('#pdfExt').onclick = () => api('/api/fs/external', {json: {path: f.path, action: 'open'}}).catch(er => toast(er.message, true));
    return;
  }
  $('#pdfMsg').innerHTML = '';
  $('#pdfCount').textContent = '/ ' + doc.numPages; $('#pdfPage').max = doc.numPages;
  const first = await doc.getPage(1), v = first.getViewport({scale: 1});
  pages = Array.from({length: doc.numPages}, () => ({w: v.width, h: v.height, state: null, token: 0}));
  buildDom(); applyFit(false); buildThumbs(); outlineLoaded = false; showTab(tab);
  measureAll();
  const jump = App.takeJump(f.path), start = Math.min(doc.numPages, jump?.locator?.page || saved.page || 1);
  setTimeout(() => { goTo(start, false); update(); if (jump) setTimeout(() => flash(jump.id), 500); }, 0);
  loadAnn(f);
  doc.getMetadata().then(m => { const t = m.info?.Title; if (t) $('#pdfCount').title = t; }).catch(() => {});
};
async function closeDoc() { if (doc) { try { await doc.destroy(); } catch {} } doc = null; pages = []; matches = []; tops = []; anns = []; }

/* ---------------- layout ---------------- */
function buildDom() {
  holder.innerHTML = '';
  pages.forEach((p, i) => {
    const el = document.createElement('div'); el.className = 'pg'; el.dataset.n = i + 1;
    el.innerHTML = `<div class="pg-ph">${i + 1}</div>`; holder.appendChild(el); p.el = el;
  });
  layout();
}
function layout() {
  let y = PAD; tops = [];
  pages.forEach(p => {
    const d = dims(p); p.el.style.width = Math.floor(d.w * scale) + 'px'; p.el.style.height = Math.floor(d.h * scale) + 'px';
    tops.push(y); y += Math.floor(d.h * scale) + GAP;
  });
}
async function measureAll() {          // real size of every page (documents can mix page sizes)
  const d = doc;
  for (let i = 1; i < pages.length && d === doc; i += 20) {
    await Promise.all(Array.from({length: Math.min(20, pages.length - i)}, async (_, k) => {
      try { const v = (await d.getPage(i + k + 1)).getViewport({scale: 1}); if (d === doc) { pages[i + k].w = v.width; pages[i + k].h = v.height; } } catch {}
    }));
    if (d !== doc) return;
    const keep = anchor(); layout(); if (fit) applyFit(false); restore(keep);
  }
}
function anchor() { const i = cur - 1, p = pages[i]; return p ? {i, frac: (scroll.scrollTop - tops[i]) / (p.el.offsetHeight || 1)} : null; }
function restore(a) { if (a && tops[a.i] !== undefined) scroll.scrollTop = tops[a.i] + a.frac * pages[a.i].el.offsetHeight; }
function applyFit(redraw = true) {
  if (!pages.length) return;
  if (fit) {
    const d = dims(pages[Math.max(0, cur - 1)] || pages[0]), w = scroll.clientWidth - 2 * PAD, h = scroll.clientHeight - 2 * PAD;
    scale = fit === 'width' ? w / d.w : Math.min(w / d.w, h / d.h);
    scale = Math.max(.2, Math.min(5, scale));
  }
  syncZoomSelect(); if (redraw) setScale(scale, true);
}
function setScale(s, keepFit) {
  const a = anchor(); scale = Math.max(.2, Math.min(5, s)); if (!keepFit) fit = null;
  layout(); restore(a); invalidateAll(); syncZoomSelect(); update(); persist();
}
function syncZoomSelect() {
  const sel = $('#pdfZoom'), pct = Math.round(scale * 100);
  sel.innerHTML = ZOOMS.map(z => `<option value="${z}">${Math.round(z * 100)}%</option>`).join('') + `<option value="cur" selected>${fit === 'width' ? 'Fit width ' : fit === 'page' ? 'Fit page ' : ''}${pct}%</option>`;
}
function persist() { if (rec) store.set('pdf:' + rec.path, {page: cur, scale, rotation, fit}); }

/* ---------------- rendering (only pages near the viewport) ---------------- */
function invalidateAll() { pages.forEach(p => { p.token = (p.token || 0) + 1; if (p.state) { p.el.innerHTML = `<div class="pg-ph">${p.el.dataset.n}</div>`; p.state = null; } }); }
function visibleRange() {
  const top = scroll.scrollTop, bot = top + scroll.clientHeight; let a = 0, b = pages.length - 1;
  for (let i = 0; i < pages.length; i++) { if (tops[i] + pages[i].el.offsetHeight >= top) { a = i; break; } }
  for (let i = a; i < pages.length; i++) { if (tops[i] > bot) { b = i - 1; break; } b = i; }
  return [a, Math.max(a, b)];
}
let raf = 0;
const schedule = () => { if (!raf) raf = setTimeout(() => { raf = 0; update(); }, 16); };   // setTimeout, unlike rAF, still runs when the tab is in the background
function update() {
  if (!doc || P.hidden) return;
  const [a, b] = visibleRange();
  for (let i = Math.max(0, a - 1); i <= Math.min(pages.length - 1, b + 1); i++) renderPage(i);
  pages.forEach((p, i) => { if (p.state && (i < a - 4 || i > b + 4)) { p.token++; p.el.innerHTML = `<div class="pg-ph">${i + 1}</div>`; p.state = null; } });
  // current page = the one covering the upper third of the viewport
  const probe = scroll.scrollTop + scroll.clientHeight / 3; let c = a + 1;
  for (let i = a; i <= b; i++) if (tops[i] <= probe) c = i + 1;
  if (c !== cur) { cur = c; persist(); }
  if (document.activeElement !== $('#pdfPage')) $('#pdfPage').value = cur;
  $('#pdfPrev').disabled = cur <= 1; $('#pdfNext').disabled = cur >= pages.length;
  markThumb(); syncBookmark();
}
async function renderPage(i) {
  const p = pages[i]; if (p.state) return; p.state = 'busy'; const token = ++p.token, d = doc;
  try {
    const page = await d.getPage(i + 1); if (token !== p.token || d !== doc) return;
    const vp = page.getViewport({scale, rotation: (page.rotate + rotation) % 360}), dpr = Math.min(devicePixelRatio || 1, 2.5);
    p.vp = vp;
    p.el.style.width = Math.floor(vp.width) + 'px'; p.el.style.height = Math.floor(vp.height) + 'px';
    p.w = rotation % 180 ? vp.height / scale : vp.width / scale; p.h = rotation % 180 ? vp.width / scale : vp.height / scale;
    const canvas = document.createElement('canvas'); canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = '100%'; canvas.style.height = '100%';
    const text = document.createElement('div'); text.className = 'textLayer'; text.style.setProperty('--scale-factor', vp.scale);
    // the canvas stays hidden (the page-number placeholder shows) until the page has actually been drawn
    canvas.style.visibility = 'hidden'; p.el.append(canvas, text);
    await page.render({canvasContext: canvas.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null}).promise;
    if (token !== p.token) return;
    canvas.style.visibility = ''; $('.pg-ph', p.el)?.remove();
    const tl = new lib.TextLayer({textContentSource: page.streamTextContent(), container: text, viewport: vp});
    await tl.render(); if (token !== p.token) return;
    p.state = 'done'; p.textDivs = tl.textDivs; markMatches(i); drawAnn(i);
  } catch (e) { if (token === p.token) p.state = null; if (e && e.name !== 'RenderingCancelledException') console.warn('PDF render', i + 1, e); }
}

/* ---------------- navigation ---------------- */
function goTo(n, smooth = true) {
  n = Math.max(1, Math.min(pages.length, n)); const y = (tops[n - 1] ?? 0) - 8;
  const near = Math.abs(y - scroll.scrollTop) < scroll.clientHeight * 4;   // long jumps are instant, short ones animate
  scroll.scrollTo({top: Math.max(0, y), behavior: smooth && near ? 'smooth' : 'auto'}); cur = n; $('#pdfPage').value = n; schedule();
}
$('#pdfPrev').onclick = () => goTo(cur - 1); $('#pdfNext').onclick = () => goTo(cur + 1);
$('#pdfPage').onkeydown = e => { if (e.key === 'Enter') { goTo(+e.target.value); scroll.focus(); } };
scroll.addEventListener('scroll', schedule, {passive: true});
new ResizeObserver(debounce(() => { if (doc && !P.hidden && fit) { applyFit(true); } else schedule(); }, 120)).observe(scroll);
$('#pdfZoomIn').onclick = () => setScale(ZOOMS.find(z => z > scale + .01) || scale);
$('#pdfZoomOut').onclick = () => setScale([...ZOOMS].reverse().find(z => z < scale - .01) || scale);
$('#pdfZoom').onchange = e => { if (e.target.value !== 'cur') setScale(+e.target.value); };
$('#pdfFitW').onclick = () => { fit = 'width'; applyFit(true); }; $('#pdfFitP').onclick = () => { fit = 'page'; applyFit(true); };
$('#pdfRotate').onclick = () => { rotation = (rotation + 90) % 360; const a = anchor(); layout(); if (fit) applyFit(false); restore(a); invalidateAll(); update(); persist(); };
$('#pdfNavBtn').onclick = () => { $('#pdfNav').hidden = !$('#pdfNav').hidden; store.set('pdfNavHidden', $('#pdfNav').hidden); };
if (store.get('pdfNavHidden', false)) $('#pdfNav').hidden = true;
scroll.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setScale(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, {passive: false});
$('#pdfPrint').onclick = () => {
  if (!rec) return;
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  f.src = '/api/asset?path=' + enc(rec.path); document.body.appendChild(f);
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { toast('Printing is not supported in this browser. Open the file with your system app instead.', true); } setTimeout(() => f.remove(), 60000); };
};
document.addEventListener('keydown', e => {
  if (P.hidden) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#pdfQ').focus(); $('#pdfQ').select(); return; }
  if (typing() || mod) return;
  if (e.key === '+' || e.key === '=') $('#pdfZoomIn').click(); else if (e.key === '-') $('#pdfZoomOut').click(); else if (e.key === '0') $('#pdfFitW').click();
  else if (e.key === 'r') $('#pdfRotate').click();
  else if (e.key === 'b') $('#pdfBookmark').click();
  else if (e.key === 'Escape') { closePop(); setTool('select'); }
});

/* ---------------- side panel: pages / outline / search results ---------------- */
$('#pdfTabs').onclick = e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.t); };
function showTab(t) {
  tab = t; $$('#pdfTabs button').forEach(b => b.classList.toggle('active', b.dataset.t === t));
  $('#pdfSide').dataset.tab = t; $$('#pdfSide > div').forEach(d => d.hidden = d.dataset.p !== t);
  if (t === 'outline') loadOutline();
  if (t === 'thumbs') markThumb();
}
function buildThumbs() {
  const side = $('#pdfSide'); side.innerHTML = '<div data-p="thumbs"></div><div data-p="outline" hidden></div><div data-p="results" hidden></div>';
  const box = $('[data-p=thumbs]', side); thumbObserver?.disconnect();
  thumbObserver = new IntersectionObserver(entries => entries.forEach(en => { if (en.isIntersecting) { thumbObserver.unobserve(en.target); drawThumb(en.target); } }), {root: $('#pdfSide'), rootMargin: '300px'});
  pages.forEach((p, i) => {
    const t = document.createElement('button'); t.className = 'thumb'; t.dataset.n = i + 1; t.setAttribute('aria-label', 'Go to page ' + (i + 1));
    const h = Math.round(110 * (p.h / p.w)); t.innerHTML = `<span class="tc" style="height:${h}px"></span><span class="tn">${i + 1}</span>`;
    t.onclick = () => goTo(i + 1); box.appendChild(t); thumbObserver.observe(t);
  });
  $('[data-p=results]', side).innerHTML = '<div class="noresult">Search the PDF to see results here.</div>';
}
async function drawThumb(t) {
  const d = doc; if (!d) return; const n = +t.dataset.n;
  try {
    const page = await d.getPage(n), v0 = page.getViewport({scale: 1}), sc = 110 / v0.width, vp = page.getViewport({scale: sc}), c = document.createElement('canvas');
    c.width = Math.floor(vp.width * 2); c.height = Math.floor(vp.height * 2); c.style.width = '110px';
    await page.render({canvasContext: c.getContext('2d'), viewport: page.getViewport({scale: sc * 2})}).promise;
    if (d === doc) { const tc = $('.tc', t); tc.style.height = 'auto'; tc.replaceChildren(c); }
  } catch {}
}
function markThumb() {
  if (tab !== 'thumbs') return;
  const side = $('#pdfSide'); $$('.thumb.on', side).forEach(x => x.classList.remove('on'));
  const t = $(`.thumb[data-n="${cur}"]`, side); if (t) { t.classList.add('on'); const r = t.getBoundingClientRect(), s = side.getBoundingClientRect(); if (r.top < s.top || r.bottom > s.bottom) t.scrollIntoView({block: 'nearest'}); }
}
async function loadOutline() {
  if (outlineLoaded || !doc) return; outlineLoaded = true;
  const box = $('[data-p=outline]'), d = doc; box.innerHTML = '<span class="spin"></span>';
  let items; try { items = await d.getOutline(); } catch { items = null; }
  if (d !== doc) return;
  if (!items || !items.length) { box.innerHTML = '<div class="noresult">This PDF has no outline (table of contents).</div>'; return; }
  const draw = (list, depth) => list.map((it, i) => {
    const id = 'o' + depth + '_' + Math.random().toString(36).slice(2, 7); it._id = id;
    return `<div class="ol" style="padding-left:${depth * 14}px"><button data-id="${id}">${esc(it.title || '(untitled)')}</button></div>` + (it.items?.length ? draw(it.items, depth + 1) : '');
  }).join('');
  box.innerHTML = draw(items, 0);
  const flat = []; (function walk(l) { l.forEach(x => { flat.push(x); if (x.items) walk(x.items); }); })(items);
  box.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return; const it = flat.find(x => x._id === b.dataset.id);
    try {
      let dest = it.dest; if (typeof dest === 'string') dest = await d.getDestination(dest);
      if (Array.isArray(dest)) goTo((await d.getPageIndex(dest[0])) + 1);
    } catch { toast('Could not jump to this section.', true); }
  };
}

/* ---------------- search ---------------- */
async function search(q) {
  const my = ++searchToken; query = q; matches = []; matchI = -1; markAll();
  const info = $('#pdfQInfo'); info.hidden = !q;
  if (!q || !doc) { $('[data-p=results]').innerHTML = '<div class="noresult">Search the PDF to see results here.</div>'; return; }
  const box = $('[data-p=results]'), d = doc, ql = q.toLowerCase(); box.innerHTML = ''; showTab('results');
  for (let i = 1; i <= d.numPages; i++) {
    if (my !== searchToken || d !== doc) return;
    info.textContent = `Searching ${i}/${d.numPages}…`;
    let txt = '';
    try { txt = (await (await d.getPage(i)).getTextContent()).items.map(it => it.str).join(' '); } catch { continue; }
    const low = txt.toLowerCase(); let pos = 0, idx, k = 0;
    while ((idx = low.indexOf(ql, pos)) >= 0 && matches.length < 1000) {
      matches.push({page: i, k: k++, snippet: txt.slice(Math.max(0, idx - 30), idx + q.length + 50)}); pos = idx + q.length;
    }
    if (matches.length >= 1000) break;
    if (i % 5 === 0 || i === d.numPages) paintResults();
  }
  paintResults(true);
  if (matches.length) gotoMatch(0); else info.textContent = 'No matches';
}
function paintResults(done) {
  const box = $('[data-p=results]'), info = $('#pdfQInfo');
  box.innerHTML = matches.length ? matches.map((m, i) => `<button class="res" data-i="${i}"><b>p. ${m.page}</b> ${esc(m.snippet)}</button>`).join('') : (done ? '<div class="noresult">No matches.</div>' : '');
  if (done || matches.length) info.textContent = matches.length ? `${Math.max(matchI, 0) + 1} / ${matches.length}${matches.length >= 1000 ? '+' : ''}` : info.textContent;
  box.onclick = e => { const b = e.target.closest('.res'); if (b) gotoMatch(+b.dataset.i); };
}
function gotoMatch(i) {
  if (!matches.length) return; matchI = (i + matches.length) % matches.length; const m = matches[matchI];
  $('#pdfQInfo').textContent = `${matchI + 1} / ${matches.length}`;
  $$('.res.on').forEach(x => x.classList.remove('on')); $(`.res[data-i="${matchI}"]`)?.classList.add('on');
  goTo(m.page); markMatches(m.page - 1, true);
}
function markAll() { pages.forEach((p, i) => p.state === 'done' && markMatches(i)); }
function markMatches(i, scrollTo) {                  // highlight text spans on a rendered page that contain the query
  const p = pages[i]; if (!p || !p.textDivs) return;
  const q = query.toLowerCase(); let first = null;
  const m = matches[matchI], curPage = m && m.page === i + 1;
  p.textDivs.forEach(d => { d.classList.remove('pm', 'pcur'); if (q && d.textContent.toLowerCase().includes(q)) { d.classList.add('pm'); first ||= d; } });
  if (curPage && first) { first.classList.add('pcur'); if (scrollTo) { const r = first.getBoundingClientRect(), s = scroll.getBoundingClientRect(); if (r.top < s.top + 40 || r.bottom > s.bottom - 40) scroll.scrollTop += r.top - s.top - s.height / 3; } }
}
$('#pdfQ').oninput = debounce(e => search(e.target.value.trim()), 350);
$('#pdfQ').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) gotoMatch(matchI - 1); else gotoMatch(matchI + 1); } if (e.key === 'Escape') { e.target.value = ''; search(''); scroll.focus(); } };
$('#pdfQNext').onclick = () => gotoMatch(matchI + 1); $('#pdfQPrev').onclick = () => gotoMatch(matchI - 1);
/* ---------------- annotations: highlight, underline, strikethrough, comments, notes, pen, bookmarks ---------------- */
const MARKUP = ['highlight', 'underline', 'strikeout'];
annPanel = Ann.panel($('#pdfAnn'), {title: 'Annotations', getItems: () => anns, fileName: () => rec?.name,
  onJump: a => { goTo(a.locator.page); setTimeout(() => flash(a.id), 450); },
  onEdit: a => { goTo(a.locator.page); setTimeout(() => { flash(a.id); openPop({a}); }, 500); },
  onDelete: a => removeAnn(a)});
if (store.get('pdfAnnHidden', false)) $('#pdfAnn').hidden = true;
$('#pdfAnnBtn').onclick = () => { $('#pdfAnn').hidden = !$('#pdfAnn').hidden; store.set('pdfAnnHidden', $('#pdfAnn').hidden); };
const syncCats = () => { const h = Ann.catDots(cat); $('#pdfCats').innerHTML = h; $('#pdfSelCats').innerHTML = h; };
syncCats();
P.addEventListener('click', e => { const d = e.target.closest('.cdot[data-cat]'); if (d && (d.closest('#pdfCats') || d.closest('#pdfSelCats'))) { cat = d.dataset.cat; store.set('pdfCat', cat); syncCats(); } });

async function loadAnn(f) {
  try { const list = await Ann.list(f.path); if (rec === f) { anns = list; annPanel.render(); pages.forEach((p, i) => p.state === 'done' && drawAnn(i)); syncBookmark(); } }
  catch (e) { toast('Could not load annotations: ' + e.message, true); }
}
async function addAnn(body) {
  try { const a = await Ann.create(rec.path, body); anns.push(a); refreshAnn(a); return a; } catch (e) { toast(e.message, true); }
}
async function saveAnn(a, fields) {
  try { Object.assign(a, await Ann.update(a.id, fields)); refreshAnn(a); } catch (e) { toast(e.message, true); }
}
async function removeAnn(a, ask = true) {
  if (ask && (a.text || a.kind === 'drawing') && !await UI.confirm('', {title: 'Delete this annotation?', confirm: 'Delete', danger: true})) return;
  try { await Ann.remove(a.id); anns = anns.filter(x => x.id !== a.id); refreshAnn(a); closePop(); } catch (e) { toast(e.message, true); }
}
function refreshAnn(a) { const i = (a.locator.page || 1) - 1; if (pages[i]?.state === 'done') drawAnn(i); annPanel.render(); syncBookmark(); }
function flash(id) { $$(`[data-id="${id}"]`, holder).forEach(el => { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); }); }

/* drawing the annotation layer of a page */
const vr = (p, rect) => { const [a, b, c, d] = p.vp.convertToViewportRectangle(rect); return {l: Math.min(a, c), t: Math.min(b, d), w: Math.abs(c - a), h: Math.abs(d - b)}; };
function drawAnn(i) {
  const p = pages[i]; if (!p || !p.el || !p.vp) return; p.el.querySelector('.annLayer')?.remove();
  const mine = anns.filter(a => a.locator.page === i + 1); if (!mine.length) return;
  let h = '', paths = '';
  for (const a of mine) {
    const c = Ann.color(a.category), L = a.locator;
    if (MARKUP.includes(a.kind) || a.kind === 'comment') {
      const kind = a.kind === 'comment' ? 'highlight' : a.kind, rs = (L.rects || []).map(r => vr(p, r));
      rs.forEach(r => h += `<div class="am ${kind}" data-id="${a.id}" style="--ac:${c};left:${r.l}px;top:${r.t}px;width:${r.w}px;height:${r.h}px"></div>`);
      if (a.text && rs.length) { const r = rs[0]; h += `<button class="apin" data-id="${a.id}" style="--ac:${c};left:${r.l + r.w + 2}px;top:${r.t}px" aria-label="Open comment">${icon('comment')}</button>`; }
    } else if (a.kind === 'note' && L.rects?.[0]) {
      const [x, y] = p.vp.convertToViewportPoint(L.rects[0][0], L.rects[0][1]); h += `<button class="apin note" data-id="${a.id}" style="--ac:${c};left:${x}px;top:${y}px" aria-label="Open note">${icon('note')}</button>`;
    } else if (a.kind === 'bookmark') h += `<div class="abm" data-id="${a.id}" style="--ac:${c}" title="Bookmark${a.text ? ': ' + esc(a.text) : ''}"></div>`;
    else if (a.kind === 'drawing') (L.points || []).forEach(s => { const pts = s.map(([x, y]) => p.vp.convertToViewportPoint(x, y).map(v => v.toFixed(1)).join(',')).join(' '); paths += `<polyline data-id="${a.id}" points="${pts}" fill="none" stroke="${c}" stroke-width="${(L.width || 2) * p.vp.scale}" stroke-linecap="round" stroke-linejoin="round"/>`; });
  }
  const layer = document.createElement('div'); layer.className = 'annLayer';
  layer.innerHTML = h + (paths ? `<svg class="adraw" width="100%" height="100%">${paths}</svg>` : ''); p.el.appendChild(layer);
}

/* popover for writing / editing a comment */
const pop = $('#pdfPop');
function closePop() { pop.hidden = true; pop.innerHTML = ''; pop._ctx = null; }
function openPop({a, draft, at}) {
  const item = a || draft, page = item.locator.page || item.page, p = pages[page - 1]; if (!p || !p.el) return;
  let c = a ? a.category : cat, kind = item.kind;
  const pr = p.el; let x, y;
  if (at) { x = pr.offsetLeft + at.x; y = pr.offsetTop + at.y; }
  else { const r0 = item.locator.rects?.[0]; const b = r0 ? vr(p, r0) : {l: 10, t: 10, w: 0, h: 0}; x = pr.offsetLeft + b.l; y = pr.offsetTop + b.t + b.h + 6; }
  const isMarkup = MARKUP.includes(kind) || kind === 'comment';
  pop.innerHTML = `<div class="pp-head"><b>${a ? Ann.KIND_NAME[a.kind] : (kind === 'note' ? 'New sticky note' : 'New comment')}</b><span class="spacer"></span><span class="pp-where">p. ${page}</span><button class="icon-btn" data-x="close" aria-label="Close">${icon('x')}</button></div>
    ${item.quote ? `<div class="ap-quote">${esc(item.quote)}</div>` : ''}
    ${a && isMarkup ? `<div class="pp-style">${MARKUP.map(k => `<button class="icon-btn${k === (kind === 'comment' ? 'highlight' : kind) ? ' active' : ''}" data-style="${k}" title="${Ann.KIND_NAME[k]}">${icon(Ann.KIND_ICON[k])}</button>`).join('')}</div>` : ''}
    <div class="pp-cats">${Ann.catDots(c, 'data-pc')}</div>
    <textarea placeholder="${kind === 'bookmark' ? 'Bookmark name' : 'Write your explanation…  (Ctrl+Enter to save)'}">${a ? esc(a.text) : ''}</textarea>
    <div class="pp-act">${a ? '<button class="btn danger" data-x="del">Delete</button>' : ''}<span class="spacer"></span><button class="btn" data-x="close">Cancel</button><button class="btn primary" data-x="save">Save</button></div>`;
  pop.hidden = false; pop._ctx = {a, draft};
  pop.style.left = Math.max(8, Math.min(x, scroll.scrollWidth - 340)) + 'px'; pop.style.top = y + 'px';
  const ta = $('textarea', pop); ta.focus();
  const save = async () => {
    const text = ta.value.trim();
    if (a) { await saveAnn(a, {text, category: c, kind: a.kind === 'comment' ? 'highlight' : a.kind}); }
    else { if (!text && kind === 'note') return toast('Write something in the note first.', true); await addAnn({...draft, text, category: c}); if (kind === 'note') setTool('select'); }
    closePop();
  };
  pop.onclick = async e => {
    const dot = e.target.closest('[data-pc]'); if (dot) { c = dot.dataset.pc; $$('.cdot', pop).forEach(d => d.classList.toggle('on', d.dataset.pc === c)); return; }
    const st = e.target.closest('[data-style]'); if (st && a) { await saveAnn(a, {kind: st.dataset.style, category: c, text: ta.value.trim()}); return openPop({a}); }
    const x2 = e.target.closest('[data-x]')?.dataset.x; if (x2 === 'close') closePop(); else if (x2 === 'save') save(); else if (x2 === 'del') removeAnn(a);
  };
  ta.onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save(); if (e.key === 'Escape') { e.stopPropagation(); closePop(); } };
  if (y > scroll.scrollTop + scroll.clientHeight - 240) scroll.scrollTop = y - 160;
}

/* text selection -> markup */
const selbar = $('#pdfSel');
function pageGroups() {
  const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) return [];
  const range = sel.getRangeAt(0), all = [...range.getClientRects()], out = [];
  pages.forEach((p, i) => {
    if (p.state !== 'done' || !p.vp) return; const pr = p.el.getBoundingClientRect();
    let rs = all.filter(r => r.width > 1 && r.height > 3 && r.left >= pr.left - 2 && r.right <= pr.right + 2 && r.top >= pr.top - 2 && r.bottom <= pr.bottom + 2 && !(r.width > pr.width * .97 && r.height > pr.height * .5));
    if (!rs.length) return;
    rs.sort((a, b) => a.top - b.top || a.left - b.left); const lines = [];
    for (const r of rs) { const l = lines.find(L => Math.abs(L.top - r.top) < r.height * .5 && r.left <= L.right + 6); if (l) { l.left = Math.min(l.left, r.left); l.right = Math.max(l.right, r.right); l.top = Math.min(l.top, r.top); l.bottom = Math.max(l.bottom, r.bottom); } else lines.push({left: r.left, right: r.right, top: r.top, bottom: r.bottom}); }
    const rects = lines.map(L => { const [x1, y1] = p.vp.convertToPdfPoint(L.left - pr.left, L.top - pr.top), [x2, y2] = p.vp.convertToPdfPoint(L.right - pr.left, L.bottom - pr.top); return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)].map(v => +v.toFixed(2)); });
    const quote = (p.textDivs || []).filter(d => sel.containsNode(d, true)).map(d => d.textContent).join(' ').replace(/\s+/g, ' ').trim();
    out.push({page: i + 1, rects, quote: quote.slice(0, 1500)});
  });
  return out;
}
document.addEventListener('selectionchange', () => {
  if (P.hidden || tool !== 'select') return; const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed || !holder.contains(sel.anchorNode)) { selbar.hidden = true; return; }
  const r = sel.getRangeAt(0).getClientRects(); if (!r.length) return; const first = r[0], sr = scroll.getBoundingClientRect();
  selbar.hidden = false; selbar.style.left = Math.max(8, first.left - sr.left + scroll.scrollLeft) + 'px'; selbar.style.top = Math.max(4, first.top - sr.top + scroll.scrollTop - 46) + 'px';
});
selbar.addEventListener('mousedown', e => e.preventDefault());       // keep the text selected while clicking
selbar.addEventListener('click', async e => {
  const b = e.target.closest('button[data-m]'); if (!b) return;
  const groups = pageGroups(); if (!groups.length) { selbar.hidden = true; return toast('Select some text first.', true); }
  const m = b.dataset.m;
  if (m === 'notes') {
    for (const g of groups) await Study.sendToNotes({path: rec.path, quote: g.quote, where: 'p. ' + g.page, locator: {page: g.page}});
    getSelection().removeAllRanges(); selbar.hidden = true; return;
  }
  if (m === 'comment') {
    if (groups.length > 1) return toast('Select text on a single page to add a comment.', true);
    const g = groups[0]; getSelection().removeAllRanges(); selbar.hidden = true;
    return openPop({draft: {kind: 'highlight', quote: g.quote, locator: {page: g.page, rects: g.rects}, page: g.page}});
  }
  for (const g of groups) await addAnn({kind: m, category: cat, text: '', quote: g.quote, locator: {page: g.page, rects: g.rects}});
  getSelection().removeAllRanges(); selbar.hidden = true;
});

/* clicking an existing annotation (the text layer sits on top, so hit-test by position) */
scroll.addEventListener('click', e => {
  if (tool !== 'select') return;
  const pin = e.target.closest('.apin'); if (pin) { const a = anns.find(x => x.id === pin.dataset.id); if (a) openPop({a}); return; }
  if (e.target.closest('#pdfPop,#pdfSel') || !getSelection().isCollapsed) return;
  const pgEl = e.target.closest('.pg'); if (!pgEl) { closePop(); return; }
  const i = +pgEl.dataset.n - 1, p = pages[i]; if (!p.vp) return; const pr = pgEl.getBoundingClientRect(), x = e.clientX - pr.left, y = e.clientY - pr.top;
  for (const a of anns.filter(q => q.locator.page === i + 1).reverse()) {
    if (a.kind === 'bookmark' || a.kind === 'note') continue;
    if (a.kind === 'drawing') { if ((a.locator.points || []).some(s => s.some(([px, py], k) => { const [vx, vy] = p.vp.convertToViewportPoint(px, py); return Math.hypot(vx - x, vy - y) < 7; }))) return openPop({a}); continue; }
    if ((a.locator.rects || []).some(r => { const b = vr(p, r); return x >= b.l && x <= b.l + b.w && y >= b.t - 2 && y <= b.t + b.h + 2; })) return openPop({a});
  }
  closePop();
});

/* tools: select / pen / sticky note */
function setTool(t) {
  tool = t; $$('#pdfTools .tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  holder.classList.toggle('pen', t === 'pen'); holder.classList.toggle('note', t === 'note'); selbar.hidden = true; if (t !== 'select') getSelection().removeAllRanges();
}
$('#pdfTools').addEventListener('click', e => { const b = e.target.closest('.tool'); if (b) setTool(tool === b.dataset.tool && tool !== 'select' ? 'select' : b.dataset.tool); });
holder.addEventListener('pointerdown', e => {
  const pgEl = e.target.closest('.pg'); if (!pgEl || e.button !== 0) return; const i = +pgEl.dataset.n - 1, p = pages[i]; if (!p.vp) return;
  const pr = pgEl.getBoundingClientRect();
  if (tool === 'note') { e.preventDefault(); const [x, y] = p.vp.convertToPdfPoint(e.clientX - pr.left, e.clientY - pr.top); openPop({draft: {kind: 'note', quote: '', locator: {page: i + 1, rects: [[+x.toFixed(2), +y.toFixed(2), +x.toFixed(2), +y.toFixed(2)]]}, page: i + 1}, at: {x: e.clientX - pr.left, y: e.clientY - pr.top + 14}}); return; }
  if (tool !== 'pen') return;
  e.preventDefault(); try { pgEl.setPointerCapture(e.pointerId); } catch {}
  const pts = [[e.clientX - pr.left, e.clientY - pr.top]], c = Ann.color(cat);
  let svg = $('.live', pgEl); if (!svg) { svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'live'); pgEl.appendChild(svg); }
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); line.setAttribute('fill', 'none'); line.setAttribute('stroke', c); line.setAttribute('stroke-width', 2.2); line.setAttribute('stroke-linecap', 'round'); line.setAttribute('stroke-linejoin', 'round'); svg.appendChild(line);
  const move = ev => { const q = [ev.clientX - pr.left, ev.clientY - pr.top], l = pts[pts.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) < 1.2) return; pts.push(q); line.setAttribute('points', pts.map(v => v.join(',')).join(' ')); };
  const up = async () => {
    pgEl.removeEventListener('pointermove', move); pgEl.removeEventListener('pointerup', up); pgEl.removeEventListener('pointercancel', up); line.remove();
    if (pts.length < 2) return;
    const stroke = pts.map(([x, y]) => p.vp.convertToPdfPoint(x, y).map(v => +v.toFixed(2)));
    await addAnn({kind: 'drawing', category: cat, text: '', quote: '', locator: {page: i + 1, points: [stroke], width: +(2.2 / p.vp.scale).toFixed(2)}});
  };
  pgEl.addEventListener('pointermove', move); pgEl.addEventListener('pointerup', up); pgEl.addEventListener('pointercancel', up);
});

/* bookmarks and export */
const bookmarkOf = n => anns.find(a => a.kind === 'bookmark' && a.locator.page === n);
function syncBookmark() { $('#pdfBookmark').classList.toggle('active', !!bookmarkOf(cur)); }
$('#pdfBookmark').onclick = async () => {
  if (!doc) return; const b = bookmarkOf(cur);
  if (b) { await removeAnn(b, false); toast('Bookmark removed'); } else { await addAnn({kind: 'bookmark', category: 'general', text: '', quote: '', locator: {page: cur}}); toast('Page ' + cur + ' bookmarked'); }
};
$('#pdfExport').onclick = () => { if (!rec) return; if (!anns.length) toast('You have no annotations yet, so the copy matches the original.'); location.href = '/api/pdf/export?path=' + enc(rec.path); };
})();
