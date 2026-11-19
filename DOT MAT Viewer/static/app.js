(() => {
const ROW_H = 24, COL_W = 90, RN_W = 60, BLOCK = 100, MAX_H = 10_000_000;
const $ = id => document.getElementById(id);
const viewer = $('viewer'), spacer = $('spacer'), layer = $('layer');

let file = null;          // {id,name,sheets}
let sheet = null;         // current sheet meta
let cache = new Map();    // blockIndex -> rows | 'loading'
let sel = {r: 0, c: 0};
let scaled = false, virtH = 0;

const colName = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
const setStatus = t => $('status').textContent = t;
const fmt = v => v === null ? '' : (typeof v === 'number' ? String(v) : String(v));

// ------------------------------------------------------------- loading
async function post(url, body, isJson) {
  const r = await fetch(url, {method: 'POST', body: isJson ? JSON.stringify(body) : body,
    headers: isJson ? {'Content-Type': 'application/json'} : {}});
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
async function openFile(f) {
  setStatus(`Reading ${f.name}… (large files can take a while)`);
  const fd = new FormData(); fd.append('file', f);
  try { loadMeta(await post('/api/upload', fd)); } catch (e) { setStatus(e.message); alert(e.message); }
}
async function openLocal(name) {
  setStatus(`Reading ${name}…`);
  try { loadMeta(await post('/api/open-local', {name}, true)); } catch (e) { setStatus(e.message); alert(e.message); }
}
function loadMeta(m) {
  file = m;
  $('csvBtn').disabled = $('zipBtn').disabled = false;
  $('empty').hidden = true; spacer.hidden = false;
  const tabs = $('tabs'); tabs.innerHTML = '';
  m.sheets.forEach(s => {
    const t = document.createElement('div');
    t.className = 'tab'; t.dataset.name = s.name;
    t.innerHTML = `${s.name}<small>${s.rows}×${s.cols}</small>`;
    t.onclick = () => showSheet(s.name);
    tabs.appendChild(t);
  });
  const first = m.sheets.find(s => s.name === 'emg') || m.sheets[0];
  showSheet(first.name);
}
function showSheet(name) {
  sheet = file.sheets.find(s => s.name === name);
  cache = new Map(); sel = {r: 0, c: 0};
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.name === name));
  const total = sheet.rows * ROW_H;
  scaled = total > MAX_H; virtH = Math.min(total, MAX_H) + ROW_H;
  spacer.style.height = virtH + 'px';
  spacer.style.width = Math.max(RN_W + sheet.cols * COL_W, viewer.clientWidth) + 'px';
  viewer.scrollTop = 0; viewer.scrollLeft = 0;
  setStatus(`${file.name} › ${name} — ${sheet.rows.toLocaleString()} rows × ${sheet.cols} cols (${sheet.dtype})` + (sheet.note ? ` — ${sheet.note}` : ''));
  render(); updateFormula();
}

// ------------------------------------------------------------- virtual grid
function visibleRows() { return Math.ceil((viewer.clientHeight - ROW_H) / ROW_H) + 1; }
function firstRow() {
  const vis = visibleRows(), maxFirst = Math.max(0, sheet.rows - vis + 1);
  if (!scaled) return Math.min(maxFirst, Math.floor(viewer.scrollTop / ROW_H));
  const maxScroll = Math.max(1, virtH - viewer.clientHeight);
  return Math.min(maxFirst, Math.round(viewer.scrollTop / maxScroll * maxFirst));
}
function scrollToRow(r) {
  const vis = visibleRows(), maxFirst = Math.max(1, sheet.rows - vis + 1);
  viewer.scrollTop = scaled ? r / maxFirst * (virtH - viewer.clientHeight) : r * ROW_H;
}
function getCell(r, c) {
  const b = cache.get(Math.floor(r / BLOCK));
  if (!b || b === 'loading') return undefined;
  const row = b[r % BLOCK]; return row ? row[c] : undefined;
}
async function ensure(first, last) {
  for (let b = Math.floor(first / BLOCK); b <= Math.floor(last / BLOCK); b++) {
    if (cache.has(b)) continue;
    cache.set(b, 'loading');
    const name = sheet.name, id = file.id;
    fetch(`/api/rows/${id}/${encodeURIComponent(name)}?start=${b * BLOCK}&count=${BLOCK}`)
      .then(r => r.json()).then(j => {
        if (sheet.name !== name) return;
        cache.set(b, j.rows); render();
      }).catch(() => cache.delete(b));
  }
  if (cache.size > 60) { // trim far-away blocks
    const mid = Math.floor(first / BLOCK);
    for (const k of [...cache.keys()]) if (Math.abs(k - mid) > 20) cache.delete(k);
  }
}
let raf = 0;
const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };

function render() {
  if (!sheet) return;
  const vis = visibleRows(), f = firstRow(), l = Math.min(sheet.rows - 1, f + vis);
  layer.style.height = viewer.clientHeight + 'px';
  layer.style.width = viewer.clientWidth + 'px';
  const sl = viewer.scrollLeft;
  const frac = scaled ? 0 : viewer.scrollTop % ROW_H;
  let h = `<div class="hdr"><div class="ch"></div><div class="cs" style="transform:translateX(${-sl}px)">`;
  for (let c = 0; c < sheet.cols; c++) h += `<div class="h">${colName(c)}</div>`;
  h += '</div></div>';
  for (let r = f; r <= l; r++) {
    const y = ROW_H + (r - f) * ROW_H - frac;
    h += `<div class="row" style="top:${y}px"><div class="rn${r === sel.r ? ' sel' : ''}">${r + 1}</div>` +
         `<div class="cs" style="transform:translateX(${-sl}px)">`;
    for (let c = 0; c < sheet.cols; c++) {
      const v = getCell(r, c);
      h += `<div class="c${typeof v === 'string' ? ' t' : ''}${r === sel.r && c === sel.c ? ' sel' : ''}" data-r="${r}" data-c="${c}">${v === undefined ? '' : fmt(v)}</div>`;
    }
    h += '</div></div>';
  }
  layer.innerHTML = h;
  ensure(f, l);
}

function updateFormula() {
  $('nameBox').value = sheet ? colName(sel.c) + (sel.r + 1) : '';
  const v = sheet ? getCell(sel.r, sel.c) : '';
  $('formulaBox').value = v === undefined || v === null ? '' : String(v);
}
function select(r, c, scroll = true) {
  r = Math.max(0, Math.min(sheet.rows - 1, r)); c = Math.max(0, Math.min(sheet.cols - 1, c));
  sel = {r, c};
  if (scroll) {
    const f = firstRow(), vis = visibleRows() - 1;
    if (r < f) scrollToRow(r); else if (r >= f + vis - 1) scrollToRow(r - vis + 2);
    const x = c * COL_W, w = viewer.clientWidth - RN_W;
    if (x < viewer.scrollLeft) viewer.scrollLeft = x;
    else if (x + COL_W > viewer.scrollLeft + w) viewer.scrollLeft = x + COL_W - w;
  }
  render(); updateFormula();
}

// ------------------------------------------------------------- events
viewer.addEventListener('scroll', schedule);
window.addEventListener('resize', () => { if (sheet) showSheet(sheet.name); });
viewer.addEventListener('mousedown', e => {
  const t = e.target.closest('.c'); if (!t || !sheet) return;
  select(+t.dataset.r, +t.dataset.c, false); viewer.focus();
});
viewer.addEventListener('keydown', e => {
  if (!sheet) return;
  const page = visibleRows() - 2;
  const k = {ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
             PageUp: [-page, 0], PageDown: [page, 0], Tab: [0, e.shiftKey ? -1 : 1], Enter: [e.shiftKey ? -1 : 1, 0]}[e.key];
  if (k) { e.preventDefault(); select(sel.r + k[0], sel.c + k[1]); }
  else if (e.key === 'Home' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); select(0, 0); }
  else if (e.key === 'End' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); select(sheet.rows - 1, sheet.cols - 1); }
  else if ((e.key === 'c') && (e.ctrlKey || e.metaKey)) {
    const v = getCell(sel.r, sel.c); if (v != null) navigator.clipboard?.writeText(String(v));
  }
});
$('gotoRow').addEventListener('keydown', e => {
  if (e.key === 'Enter' && sheet) { select(+e.target.value - 1, sel.c); viewer.focus(); }
});
$('fileInput').onchange = e => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; };
$('localSelect').onchange = e => { if (e.target.value) openLocal(e.target.value); e.target.value = ''; };
$('csvBtn').onclick = () => { if (sheet) location.href = `/api/export/${file.id}/${encodeURIComponent(sheet.name)}.csv`; };
$('zipBtn').onclick = () => { if (file) location.href = `/api/export-all/${file.id}.zip`; };
['dragover', 'dragenter'].forEach(ev => viewer.addEventListener(ev, e => { e.preventDefault(); viewer.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => viewer.addEventListener(ev, e => { e.preventDefault(); viewer.classList.remove('drag'); }));
viewer.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) openFile(f); });

fetch('/api/local-files').then(r => r.json()).then(list => {
  const s = $('localSelect');
  list.forEach(n => { const o = document.createElement('option'); o.value = o.textContent = n; s.appendChild(o); });
});
})();
