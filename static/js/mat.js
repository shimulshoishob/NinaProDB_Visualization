(() => {
const P = document.getElementById('v-mat');
// Queries are scoped to this viewer's pane so ids/classes never clash with other viewers.
const $ = (s, r = P) => r.querySelector(s), $$ = (s, r = P) => [...r.querySelectorAll(s)];
const ROW_H = 24, COL_W = 96, RN_W = 60, BLOCK = 100, MAX_H = 10_000_000;
const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#be185d', '#65a30d'];
const viewer = $('#grid'), spacer = $('#spacer'), layer = $('#layer');

let file = null, sheet = null, cache = new Map(), sel = {r: 0, c: 0}, scaled = false, virtH = 0;
let panelOpen = store.get('matPanel', false), ptab = 'chart';
let chart = {cols: [0], range: null, data: null};

const colName = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
const setStatus = t => $('#status').textContent = t;
const color = c => PALETTE[c % PALETTE.length];
function fmt(v) {
  if (v === null) return '';
  const d = $('#dec').value;
  return typeof v === 'number' && d !== '' && !Number.isInteger(v) ? v.toFixed(+d) : String(v);
}

/* ---------------- open ---------------- */
Viewers.mat = async f => {
  setStatus(`Reading ${f.name}… (large files can take a while)`);
  $('#matName').textContent = f.name; $('#matMeta').textContent = fmtSize(f.size);
  const m = await api('/api/mat/open', {json: {path: f.path}});
  file = m;
  const tabs = $('#tabs'); tabs.innerHTML = '';
  m.sheets.forEach(s => {
    const t = document.createElement('div'); t.className = 'tab'; t.dataset.name = s.name;
    t.innerHTML = `${esc(s.name)}<small>${s.rows}×${s.cols}</small>`; t.onclick = () => showSheet(s.name); tabs.appendChild(t);
  });
  showSheet((m.sheets.find(s => s.name === 'emg') || m.sheets[0]).name);
};
function showSheet(name) {
  sheet = file.sheets.find(s => s.name === name);
  cache = new Map(); sel = {r: 0, c: 0}; chart = {cols: [0], range: null, data: null};
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.name === name));
  applyPanel(false);
  const total = sheet.rows * ROW_H;
  scaled = total > MAX_H; virtH = Math.min(total, MAX_H) + ROW_H;
  spacer.style.height = virtH + 'px';
  spacer.style.width = Math.max(RN_W + sheet.cols * COL_W, viewer.clientWidth) + 'px';
  viewer.scrollTop = 0; viewer.scrollLeft = 0;
  setStatus(`${file.name} › ${name} — ${sheet.rows.toLocaleString()} rows × ${sheet.cols} cols (${sheet.dtype})` + (sheet.note ? ` — ${sheet.note}` : ''));
  $('#matMeta').textContent = `${file.sheets.length} sheets`;
  render(); updateFormula(); if (panelOpen) drawPanel();
}

/* ---------------- virtual grid ---------------- */
const visibleRows = () => Math.ceil((viewer.clientHeight - ROW_H) / ROW_H) + 1;
function firstRow() {
  const vis = visibleRows(), maxFirst = Math.max(0, sheet.rows - vis + 1);
  if (!scaled) return Math.min(maxFirst, Math.floor(viewer.scrollTop / ROW_H));
  return Math.min(maxFirst, Math.round(viewer.scrollTop / Math.max(1, virtH - viewer.clientHeight) * maxFirst));
}
function scrollToRow(r) {
  const maxFirst = Math.max(1, sheet.rows - visibleRows() + 1);
  viewer.scrollTop = scaled ? r / maxFirst * (virtH - viewer.clientHeight) : r * ROW_H;
}
function getCell(r, c) {
  const b = cache.get(Math.floor(r / BLOCK)); if (!b || b === 'loading') return undefined;
  const row = b[r % BLOCK]; return row ? row[c] : undefined;
}
function ensure(first, last) {
  for (let b = Math.floor(first / BLOCK); b <= Math.floor(last / BLOCK); b++) {
    if (cache.has(b)) continue; cache.set(b, 'loading');
    const name = sheet.name, id = file.id;
    fetch(`/api/mat/rows/${id}/${encodeURIComponent(name)}?start=${b * BLOCK}&count=${BLOCK}`)
      .then(r => r.json()).then(j => { if (sheet.name !== name || file.id !== id) return; cache.set(b, j.rows || []); render(); })
      .catch(() => cache.delete(b));
  }
  if (cache.size > 60) { const mid = Math.floor(first / BLOCK); for (const k of [...cache.keys()]) if (Math.abs(k - mid) > 20) cache.delete(k); }
}
let raf = 0;
const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
function render() {
  if (!sheet || P.hidden) return;
  const vis = visibleRows(), f = firstRow(), l = Math.min(sheet.rows - 1, f + vis);
  layer.style.height = viewer.clientHeight + 'px'; layer.style.width = viewer.clientWidth + 'px';
  const sl = viewer.scrollLeft, frac = scaled ? 0 : viewer.scrollTop % ROW_H;
  let h = `<div class="mx-hdr"><div class="mx-corner"></div><div class="mx-cs" style="transform:translateX(${-sl}px)">`;
  for (let c = 0; c < sheet.cols; c++) h += `<div class="mx-h${chart.cols.includes(c) && panelOpen ? ' on' : c === sel.c ? ' on' : ''}" data-c="${c}">${colName(c)}</div>`;
  h += '</div></div>';
  for (let r = f; r <= l; r++) {
    h += `<div class="mx-row" style="top:${ROW_H + (r - f) * ROW_H - frac}px"><div class="mx-rn${r === sel.r ? ' sel' : ''}">${r + 1}</div><div class="mx-cs" style="transform:translateX(${-sl}px)">`;
    for (let c = 0; c < sheet.cols; c++) {
      const v = getCell(r, c);
      h += `<div class="mx-c${typeof v === 'string' ? ' t' : ''}${r === sel.r && c === sel.c ? ' sel' : ''}" data-r="${r}" data-c="${c}">${v === undefined ? '' : esc(fmt(v))}</div>`;
    }
    h += '</div></div>';
  }
  layer.innerHTML = h; ensure(f, l);
}
function updateFormula() {
  $('#nameBox').value = sheet ? colName(sel.c) + (sel.r + 1) : '';
  const v = sheet ? getCell(sel.r, sel.c) : ''; $('#formulaBox').value = v == null ? '' : String(v);
}
function select(r, c, scroll = true) {
  r = Math.max(0, Math.min(sheet.rows - 1, r)); c = Math.max(0, Math.min(sheet.cols - 1, c)); sel = {r, c};
  if (scroll) {
    const f = firstRow(), vis = visibleRows() - 1;
    if (r < f) scrollToRow(r); else if (r >= f + vis - 1) scrollToRow(r - vis + 2);
    const x = c * COL_W, w = viewer.clientWidth - RN_W;
    if (x < viewer.scrollLeft) viewer.scrollLeft = x; else if (x + COL_W > viewer.scrollLeft + w) viewer.scrollLeft = x + COL_W - w;
  }
  render(); updateFormula(); drawCursor();
}

/* ---------------- events ---------------- */
viewer.addEventListener('scroll', schedule);
new ResizeObserver(() => { if (sheet && !P.hidden) { spacer.style.width = Math.max(RN_W + sheet.cols * COL_W, viewer.clientWidth) + 'px'; render(); } }).observe(viewer);
viewer.addEventListener('mousedown', e => {
  const h = e.target.closest('.mx-h');
  if (h && sheet) {
    const c = +h.dataset.c; sel.c = c;
    if (e.shiftKey || e.ctrlKey || e.metaKey) chart.cols = chart.cols.includes(c) ? chart.cols.filter(x => x !== c) : [...chart.cols, c]; else chart.cols = [c];
    if (!chart.cols.length) chart.cols = [c];
    if (!panelOpen) applyPanel(true); else { ptab = 'chart'; syncTabs(); drawPanel(); }
    render(); return;
  }
  const t = e.target.closest('.mx-c'); if (!t || !sheet) return;
  select(+t.dataset.r, +t.dataset.c, false); viewer.focus();
});
viewer.addEventListener('keydown', e => {
  if (!sheet) return; const page = visibleRows() - 2;
  const k = {ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], PageUp: [-page, 0], PageDown: [page, 0],
    Tab: [0, e.shiftKey ? -1 : 1], Enter: [e.shiftKey ? -1 : 1, 0]}[e.key];
  if (k) { e.preventDefault(); select(sel.r + k[0], sel.c + k[1]); }
  else if (e.key === 'Home' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); select(0, 0); }
  else if (e.key === 'End' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); select(sheet.rows - 1, sheet.cols - 1); }
  else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) { const v = getCell(sel.r, sel.c); if (v != null) copyText(String(v)); }
});
$('#gotoRow').addEventListener('keydown', e => { if (e.key === 'Enter' && sheet) { select(+e.target.value - 1, sel.c); viewer.focus(); } });
$('#dec').onchange = render;
$('#csvBtn').onclick = () => {
  if (!sheet) return; const a = $('#rFrom').value, b = $('#rTo').value;
  location.href = `/api/mat/export/${file.id}/${encodeURIComponent(sheet.name)}.csv?` + new URLSearchParams({...(a && {from: a}), ...(b && {to: b})});
};
$('#zipBtn').onclick = () => { if (file) location.href = `/api/mat/export-all/${file.id}.zip`; };

/* ---------------- chart & statistics panel ---------------- */
function applyPanel(open) {
  if (open !== undefined && open !== false) { panelOpen = true; store.set('matPanel', true); }
  if (open === false) { /* keep user's preference */ }
  $('#panel').hidden = !panelOpen; $('#panelBtn').classList.toggle('active', panelOpen);
  if (panelOpen && sheet) drawPanel(); if (sheet) setTimeout(render, 0);
}
$('#panelBtn').onclick = () => { panelOpen = !panelOpen; store.set('matPanel', panelOpen); applyPanel(); };
const syncTabs = () => $$('#ptabs button').forEach(b => b.classList.toggle('active', b.dataset.p === ptab));
$('#ptabs').onclick = e => { const b = e.target.closest('button'); if (b) { ptab = b.dataset.p; syncTabs(); drawPanel(); } };
$('#resetZoom').onclick = () => { chart.range = null; drawPanel(); };

function drawChips() {
  const el = $('#chips2');
  if (ptab !== 'chart' || !sheet.numeric || sheet.cols > 24) { el.innerHTML = ''; return; }
  el.innerHTML = Array.from({length: sheet.cols}, (_, c) => `<button class="chip${chart.cols.includes(c) ? ' on' : ''}" style="--cc:${color(c)}" data-c="${c}">${colName(c)}</button>`).join('');
  $$('.chip', el).forEach(b => b.onclick = () => {
    const c = +b.dataset.c; chart.cols = chart.cols.includes(c) ? chart.cols.filter(x => x !== c) : [...chart.cols, c];
    if (!chart.cols.length) chart.cols = [c]; drawPanel(); render();
  });
}
async function drawPanel() {
  if (!panelOpen || !sheet) return;
  drawChips(); $('#resetZoom').hidden = ptab !== 'chart'; $('#range').hidden = ptab !== 'chart';
  const body = $('#pbody');
  if (!sheet.numeric) { body.innerHTML = '<div class="empty"><h2>Not numeric</h2><p>Charts and statistics need a numeric sheet.</p></div>'; return; }
  if (ptab === 'stats') return drawStats(body);
  body.innerHTML = '<canvas></canvas>';
  const cv = $('canvas', body), W = body.clientWidth;
  const r = chart.range || [0, sheet.rows];
  try {
    const d = await api(`/api/mat/series/${file.id}/${encodeURIComponent(sheet.name)}?start=${r[0]}&end=${r[1]}&points=${Math.max(200, W - 80)}&cols=${chart.cols.join(',')}`);
    chart.data = d; $('#range').textContent = `rows ${(d.start + 1).toLocaleString()}–${d.end.toLocaleString()}`;
    paint(cv);
  } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
const M = {l: 58, r: 14, t: 12, b: 26};
function paint(cv, hoverX) {
  const d = chart.data; if (!d) return;
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const cs = getComputedStyle(P), fg2 = cs.getPropertyValue('--fg2').trim() || '#888', line = cs.getPropertyValue('--line').trim() || '#ddd';
  let lo = Infinity, hi = -Infinity;
  for (const s of d.series) for (let i = 0; i < d.x.length; i++) { const a = s.min[i], b = s.max[i]; if (a != null && a < lo) lo = a; if (b != null && b > hi) hi = b; }
  if (!isFinite(lo)) { g.fillStyle = fg2; g.fillText('No finite data in this range', 20, 30); return; }
  if (lo === hi) { lo -= 1; hi += 1; } const pad = (hi - lo) * .05; lo -= pad; hi += pad;
  const x0 = d.start, x1 = d.end - 1 || 1, X = v => M.l + (v - x0) / (x1 - x0 || 1) * (w - M.l - M.r), Y = v => M.t + (1 - (v - lo) / (hi - lo)) * (h - M.t - M.b);
  g.font = '11px ui-monospace,Menlo,monospace'; g.fillStyle = fg2; g.strokeStyle = line; g.lineWidth = 1;
  for (let i = 0; i <= 5; i++) { const v = lo + (hi - lo) * i / 5, y = Y(v); g.beginPath(); g.moveTo(M.l, y); g.lineTo(w - M.r, y); g.stroke(); g.textAlign = 'right'; g.fillText(Math.abs(v) >= 1000 || (v && Math.abs(v) < .01) ? v.toExponential(1) : v.toFixed(3).replace(/\.?0+$/, ''), M.l - 6, y + 4); }
  g.textAlign = 'center'; for (let i = 0; i <= 6; i++) { const v = x0 + (x1 - x0) * i / 6; g.fillText(Math.round(v + 1).toLocaleString(), X(v), h - 8); }
  d.series.forEach(s => {
    g.fillStyle = color(s.col) + '55'; g.strokeStyle = color(s.col); g.lineWidth = 1.2; g.beginPath(); let started = false;
    for (let i = 0; i < d.x.length; i++) { if (s.max[i] == null) continue; const x = X(d.x[i]), y = Y(s.max[i]); started ? g.lineTo(x, y) : g.moveTo(x, y); started = true; }
    g.stroke();
    if (d.x.length > 1 && s.min !== s.max) { g.beginPath(); started = false; for (let i = 0; i < d.x.length; i++) { if (s.max[i] == null) continue; const x = X(d.x[i]), y = Y(s.max[i]); started ? g.lineTo(x, y) : g.moveTo(x, y); started = true; }
      for (let i = d.x.length - 1; i >= 0; i--) if (s.min[i] != null) g.lineTo(X(d.x[i]), Y(s.min[i])); g.closePath(); g.fill(); g.beginPath(); started = false; for (let i = 0; i < d.x.length; i++) { if (s.min[i] == null) continue; const x = X(d.x[i]), y = Y(s.min[i]); started ? g.lineTo(x, y) : g.moveTo(x, y); started = true; } g.stroke(); }
  });
  // selected row marker
  if (sel.r >= x0 && sel.r <= x1) { g.strokeStyle = fg2; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(X(sel.r), M.t); g.lineTo(X(sel.r), h - M.b); g.stroke(); g.setLineDash([]); }
  if (hoverX != null) { g.strokeStyle = fg2; g.beginPath(); g.moveTo(hoverX, M.t); g.lineTo(hoverX, h - M.b); g.stroke(); }
  if (chart.drag) { const [a, b] = chart.drag; g.fillStyle = 'rgba(80,120,255,.18)'; g.fillRect(Math.min(a, b), M.t, Math.abs(b - a), h - M.t - M.b); }
  cv._map = {X, inv: px => x0 + (px - M.l) / (w - M.l - M.r) * (x1 - x0)};
}
function drawCursor() { const cv = $('#pbody canvas'); if (panelOpen && ptab === 'chart' && cv) paint(cv); }
P.addEventListener('mousedown', e => {
  const cv = e.target.closest('canvas'); if (!cv || !cv._map) return;
  const x0 = e.offsetX; chart.drag = [x0, x0]; chart.moved = false;
  const move = ev => { const r = cv.getBoundingClientRect(); chart.drag[1] = ev.clientX - r.left; chart.moved = Math.abs(chart.drag[1] - x0) > 4; paint(cv); };
  const up = ev => {
    removeEventListener('mousemove', move); removeEventListener('mouseup', up);
    const [a, b] = chart.drag, m = cv._map; chart.drag = null;
    if (chart.moved) { const r0 = Math.max(0, Math.round(m.inv(Math.min(a, b)))), r1 = Math.min(sheet.rows, Math.round(m.inv(Math.max(a, b))) + 1); if (r1 - r0 > 5) { chart.range = [r0, r1]; drawPanel(); return; } }
    else { const row = Math.max(0, Math.min(sheet.rows - 1, Math.round(m.inv(a)))); select(row, sel.c); }
    paint(cv);
  };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
});
P.addEventListener('mousemove', e => {
  const cv = e.target.closest('canvas'); if (!cv || !cv._map || chart.drag) return;
  paint(cv, e.offsetX);
  const d = chart.data, row = Math.round(cv._map.inv(e.offsetX)); if (!d || row < d.start || row >= d.end) return;
  const body = $('#pbody'); let tip = $('.mtip', body) || body.appendChild(Object.assign(document.createElement('div'), {className: 'mtip'}));
  tip.textContent = `row ${row + 1}\n` + d.series.map(s => { const i = Math.min(d.x.length - 1, Math.max(0, Math.round((row - d.start) / ((d.end - d.start) / d.x.length)))); const a = s.min[i], b = s.max[i]; return `${colName(s.col)}: ${a === b ? a : (a == null ? '' : a.toPrecision(4)) + ' … ' + (b == null ? '' : b.toPrecision(4))}`; }).join('\n');
  tip.style.left = Math.min(e.offsetX + 12, body.clientWidth - 160) + 'px'; tip.style.top = '8px';
});
P.addEventListener('mouseleave', () => { $$('.mtip').forEach(t => t.remove()); });
P.addEventListener('mouseout', e => { if (e.target.closest && e.target.closest('canvas') && !e.relatedTarget?.closest?.('canvas')) { $$('.mtip').forEach(t => t.remove()); const cv = $('#pbody canvas'); if (cv) paint(cv); } });
document.addEventListener('themechange', () => { if (!P.hidden && panelOpen) drawPanel(); });

async function drawStats(body) {
  body.innerHTML = '<div style="padding:16px"><span class="spin"></span> Computing…</div>';
  try {
    const d = await api(`/api/mat/stats/${file.id}/${encodeURIComponent(sheet.name)}`);
    const n = v => v === null ? '–' : Math.abs(v) >= 1e5 || (v && Math.abs(v) < 1e-3) ? v.toExponential(3) : +v.toPrecision(6);
    body.innerHTML = `<table class="st"><thead><tr><th>Column</th><th>Min</th><th>Max</th><th>Mean</th><th>Std</th><th>RMS</th><th>Median</th><th>NaN</th></tr></thead><tbody>` +
      d.cols.map(c => `<tr data-c="${c.col}"><td><span style="color:${color(c.col)}">●</span> ${colName(c.col)} (col${c.col + 1})</td><td>${n(c.min)}</td><td>${n(c.max)}</td><td>${n(c.mean)}</td><td>${n(c.std)}</td><td>${n(c.rms)}</td><td>${n(c.median)}</td><td>${c.nan}</td></tr>`).join('') + '</tbody></table>';
    $$('tr[data-c]', body).forEach(tr => tr.onclick = () => { chart.cols = [+tr.dataset.c]; ptab = 'chart'; syncTabs(); drawPanel(); render(); });
  } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
new ResizeObserver(debounce(() => { if (panelOpen && !P.hidden && ptab === 'chart') drawPanel(); }, 200)).observe($('#pbody'));
})();
