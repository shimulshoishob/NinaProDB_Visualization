(() => {
const P = document.getElementById('v-json');
// Queries are scoped to this viewer's pane so ids/classes never clash with other viewers.
const $ = (s, r = P) => r.querySelector(s), $$ = (s, r = P) => [...r.querySelectorAll(s)];
const MAX_CHILDREN = 200, EXPAND_LIMIT = 2000;
let data, rawText = '', mode = 'tree', fileName = '', hits = [], hitIdx = -1;

const type = v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
const pathStr = p => '$' + p.map(k => typeof k === 'number' ? `[${k}]` : /^[A-Za-z_]\w*$/.test(k) ? '.' + k : `["${k.replace(/"/g, '\\"')}"]`).join('');
const preview = (v) => type(v) === 'array' ? `[${v.length}]` : `{${Object.keys(v).length}}`;
const isCont = v => v !== null && typeof v === 'object';

function parse(text, name) {
  if (/\.(jsonl|ndjson)$/i.test(name)) {
    return text.split(/\r?\n/).filter(l => l.trim()).map((l, i) => {
      try { return JSON.parse(l); } catch (e) { throw new Error(`Line ${i + 1}: ${e.message}`); }
    });
  }
  return JSON.parse(text);
}
function errorPos(text, e) {
  const m = /position (\d+)/.exec(e.message); if (!m) return e.message;
  const pos = +m[1], before = text.slice(0, pos).split('\n');
  return `${e.message}\n\n→ line ${before.length}, column ${before.at(-1).length + 1}`;
}

/* ---------- tree ---------- */
function hl(text, q) {
  text = esc(text);
  if (!q) return text;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;'), 'gi');
  return text.replace(re, m => `<mark>${m}</mark>`);
}
function valueHtml(v, q) {
  const t = type(v);
  if (t === 'string') return `<span class="s">"${hl(v.length > 400 ? v.slice(0, 400) + '…' : v, q)}"</span>`;
  if (t === 'number') return `<span class="num">${hl(String(v), q)}</span>`;
  if (t === 'boolean') return `<span class="b">${v}</span>`;
  return `<span class="nl">null</span>`;
}
function renderNode(key, v, path, q, openAll) {
  const el = document.createElement('div'); el.className = 'n';
  const row = document.createElement('div'); row.className = 'row'; row.dataset.path = pathStr(path);
  const kh = key === undefined ? '' : `<span class="k">${typeof key === 'number' ? key : '"' + hl(String(key), q) + '"'}</span>: `;
  if (isCont(v)) {
    const n = Array.isArray(v) ? v.length : Object.keys(v).length;
    const [o, c] = Array.isArray(v) ? ['[', ']'] : ['{', '}'];
    row.innerHTML = `<span class="tg">▸</span>${kh}<span>${o}</span><span class="cnt">${n ? n + (Array.isArray(v) ? ' items' : ' keys') : ''}</span><span class="close" hidden>${c}</span>${n ? '' : `<span>${c}</span>`}`;
    el.appendChild(row);
    if (!n) { row.firstChild.style.visibility = 'hidden'; return el; }
    const kids = document.createElement('div'); kids.hidden = true; el.appendChild(kids);
    let built = false;
    const build = (limit) => {
      const entries = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
      kids.innerHTML = '';
      let shown = entries.slice(0, limit);
      if (q) {                                  // while searching, also show matching items that are beyond the first page
        const ql = q.toLowerCase(), extra = [];
        for (let i = limit; i < entries.length && extra.length < 300; i++) { const [k, x] = entries[i]; if ((!Array.isArray(v) && String(k).toLowerCase().includes(ql)) || deepHas(x, ql)) extra.push(entries[i]); }
        shown = shown.concat(extra);
      }
      kids._entries = shown;
      shown.forEach(([k, x]) => kids.appendChild(renderNode(k, x, [...path, k], q, openAll)));
      if (entries.length > shown.length) {
        const m = document.createElement('div'); m.className = 'more';
        m.textContent = `… ${entries.length - shown.length} more (click to show ${Math.min(MAX_CHILDREN * 5, entries.length - shown.length)} more)`;
        m.onclick = () => build(limit + MAX_CHILDREN * 5); kids.appendChild(m);
      }
      built = true;
    };
    const toggle = (open) => {
      if (open && !built) build(MAX_CHILDREN);
      kids.hidden = !open; row.querySelector('.tg').classList.toggle('open', open);
      row.querySelector('.cnt').hidden = open; row.querySelector('.close').hidden = !open;
      row.querySelector('.close').textContent = '';
    };
    el._toggle = toggle; el._open = () => !kids.hidden;
    row.querySelector('.tg').onclick = e => { e.stopPropagation(); toggle(kids.hidden); };
    row.ondblclick = () => toggle(kids.hidden);
    if (openAll) toggle(true);
  } else {
    row.innerHTML = `<span class="tg"></span>${kh}${valueHtml(v, q)}`; el.appendChild(row);
  }
  row.onclick = () => { $$('.row.cur').forEach(r => r.classList.remove('cur')); row.classList.add('cur'); $('#pathText').textContent = row.dataset.path; selected = {path, v}; };
  return el;
}
let selected = null;

function showTree(q = '') {
  const body = $('#body'); body.innerHTML = ''; body.style.whiteSpace = '';
  const root = renderNode(undefined, data, [], q, false);
  root.style.paddingLeft = '0'; body.appendChild(root);
  if (root._toggle) root._toggle(true);
  if (q) expandMatches(q);
}
function expandMatches(q) {
  // Walk data; open every ancestor of a match so highlights are visible.
  const ql = q.toLowerCase(); let budget = EXPAND_LIMIT;
  const body = $('#body');
  const rec = (node, v) => {
    if (!isCont(v) || budget <= 0) return false;
    let any = false; const kidsWrap = node.children[1]; if (!kidsWrap) return false;
    const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x]) : Object.entries(v);
    const hit = entries.some(([k, x]) => (!Array.isArray(v) && k.toLowerCase().includes(ql)) || (!isCont(x) && String(x).toLowerCase().includes(ql)));
    if (hit) any = true;
    // open lazily to inspect children
    const descend = entries.some(([k, x]) => isCont(x) && deepHas(x, ql));
    if (any || descend) { budget--; node._toggle(true); }
    const childEls = [...kidsWrap.children].filter(c => c.classList.contains('n')), shown = kidsWrap._entries || [];
    shown.forEach(([k, x], i) => { if (isCont(x) && childEls[i] && deepHas(x, ql)) rec(childEls[i], x); });
    return any || descend;
  };
  rec(body.firstChild, data);
  hits = $$('mark', body); hitIdx = -1; updateInfo(); gotoHit(1);
}
const hasCache = new WeakMap();
function deepHas(v, ql, depth = 0) {
  if (!isCont(v)) return String(v).toLowerCase().includes(ql);
  if (hasCache.has(v) && hasCache.get(v).q === ql) return hasCache.get(v).r;
  let r = false, n = 0;
  for (const [k, x] of Array.isArray(v) ? v.entries() : Object.entries(v)) {
    if ((!Array.isArray(v) && k.toLowerCase().includes(ql)) || deepHas(x, ql, depth + 1)) { r = true; break; }
    if (++n > 5000) break;
  }
  hasCache.set(v, {q: ql, r}); return r;
}
function updateInfo() {
  const i = $('#qInfo'); i.hidden = !$('#q').value;
  i.textContent = hits.length ? `${Math.max(hitIdx, 0) + 1} / ${hits.length}` : 'no matches';
}
function gotoHit(d) {
  if (!hits.length) return updateInfo();
  hits[hitIdx]?.classList.remove('on');
  hitIdx = (hitIdx + d + hits.length) % hits.length;
  const m = hits[hitIdx]; m.classList.add('on'); m.scrollIntoView({block: 'center'}); updateInfo();
}

/* ---------- table (array of objects) ---------- */
function showTable(q = '') {
  const body = $('#body');
  let rows = Array.isArray(data) ? data : null;
  if (!rows) { const arr = isCont(data) && Object.values(data).find(x => Array.isArray(x) && x.length && isCont(x[0])); rows = arr || null; }
  if (!rows || !rows.length) { body.innerHTML = '<div class="empty"><h2>No table view</h2><p>Table view needs a list of objects, e.g. <code>[{"a":1},{"a":2}]</code>.</p></div>'; return; }
  const cols = [...new Set(rows.slice(0, 500).flatMap(r => isCont(r) && !Array.isArray(r) ? Object.keys(r) : ['value']))];
  let order = null, desc = false;
  const draw = () => {
    let idx = rows.map((r, i) => i);
    if (q) idx = idx.filter(i => JSON.stringify(rows[i]).toLowerCase().includes(q.toLowerCase()));
    if (order !== null) idx.sort((a, b) => { const x = cellv(rows[a], order), y = cellv(rows[b], order); return (x > y ? 1 : x < y ? -1 : 0) * (desc ? -1 : 1); });
    const shown = idx.slice(0, 2000);
    body.innerHTML = `<table class="t"><thead><tr><th>#</th>${cols.map((c, i) => `<th data-i="${i}">${esc(c)}${order === i ? (desc ? ' ▼' : ' ▲') : ''}</th>`).join('')}</tr></thead><tbody>` +
      shown.map(i => `<tr><td class="rn">${i + 1}</td>${cols.map(c => { const v = cellv(rows[i], cols.indexOf(c)); return `<td title="${esc(String(v))}">${esc(isCont(v) ? JSON.stringify(v) : String(v ?? ''))}</td>`; }).join('')}</tr>`).join('') +
      `</tbody></table>` + (idx.length > 2000 ? `<p class="cnt">Showing first 2000 of ${idx.length} rows.</p>` : '');
    $$('th[data-i]', body).forEach(th => th.onclick = () => { const i = +th.dataset.i; desc = order === i ? !desc : false; order = i; draw(); });
    $('#qInfo').hidden = !q; $('#qInfo').textContent = idx.length + ' rows';
  };
  const cellv = (r, i) => isCont(r) && !Array.isArray(r) ? r[cols[i]] : (cols[i] === 'value' ? r : undefined);
  draw();
}

/* ---------- raw ---------- */
function showRaw(q = '') {
  const pretty = JSON.stringify(data, null, 2);
  const body = $('#body');
  if (pretty.length > 1_500_000) { body.innerHTML = `<pre class="raw">${esc(pretty.slice(0, 1_500_000))}\n… (truncated for display; Copy/Download give the full text)</pre>`; return; }
  let h = esc(pretty).replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+\.?\d*(?:[eE][+-]?\d+)?/g,
    (m, s, colon, bool) => s ? (colon ? `<span class="k">${s}</span>${colon}` : `<span class="s">${s}</span>`) : bool ? `<span class="b">${m}</span>` : m === 'null' ? `<span class="nl">null</span>` : `<span class="num">${m}</span>`);
  if (q) { const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); h = h.replace(/(<[^>]*>)|([^<]+)/g, (m, tag, txt) => tag ? tag : txt.replace(re, x => `<mark>${x}</mark>`)); }
  body.innerHTML = `<pre class="raw">${h}</pre>`;
  hits = $$('mark', body); hitIdx = -1; updateInfo(); if (q) gotoHit(1);
}

function render() {
  if (data === undefined) return;
  const q = $('#q').value.trim();
  hits = []; hitIdx = -1;
  ({tree: showTree, table: showTable, raw: showRaw})[mode](q);
  $('#qInfo').hidden = !q;
  if (mode === 'tree' && !q) $('#qInfo').hidden = true;
}

/* ---------- open ---------- */
Viewers.json = async f => {
  
  $('#jsonName').textContent = f.name; fileName = f.name; $('#jsonMeta').textContent = fmtSize(f.size);
  $('#body').innerHTML = '<span class="spin"></span> Loading…'; data = undefined;
  try {
    const r = await api('/api/json/text?path=' + encodeURIComponent(f.path));
    rawText = r.text;
    try { data = parse(rawText, f.name); }
    catch (e) {
      $('#body').innerHTML = `<div class="err"><b>Invalid JSON</b><pre style="white-space:pre-wrap">${esc(errorPos(rawText, e))}</pre></div><pre class="raw" style="margin-top:12px">${esc(rawText.slice(0, 100000))}</pre>`;
      $('#jsonMeta').textContent += ' · invalid'; return;
    }
    const t = type(data);
    $('#jsonMeta').textContent = `${fmtSize(f.size)} · ${t === 'array' ? data.length + ' items' : t === 'object' ? Object.keys(data).length + ' keys' : t}`;
    $('#pathText').textContent = '$'; $('#q').value = '';
    render();
  } catch (e) { $('#body').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
};

$('#jsonModes').onclick = e => { const b = e.target.closest('button'); if (!b) return; mode = b.dataset.m; $$('#jsonModes button').forEach(x => x.classList.toggle('active', x === b)); render(); };
$('#q').oninput = debounce(render, 250);
$('#q').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); gotoHit(e.shiftKey ? -1 : 1); } };
$('#qNext').onclick = () => gotoHit(1); $('#qPrev').onclick = () => gotoHit(-1);
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !P.hidden) { e.preventDefault(); $('#q').focus(); $('#q').select(); } });
$('#expandBtn').onclick = () => {
  if (mode !== 'tree') return; let budget = EXPAND_LIMIT;
  const rec = el => { if (budget <= 0 || !el._toggle) return; if (!el._open()) { el._toggle(true); budget--; } [...(el.children[1]?.children || [])].forEach(c => c.classList?.contains('n') && rec(c)); };
  rec($('#body').firstChild); if (budget <= 0) toast('Expanded first ' + EXPAND_LIMIT + ' nodes');
};
$('#collapseBtn').onclick = () => { if (mode === 'tree') showTree(''); };
$('#copyBtn').onclick = () => copyText(JSON.stringify(selected && selected.v !== undefined && !P.hidden && selected ? selected.v : data, null, 2));
$('#copyBtn').title = 'Copies the selected node (or the whole document if none selected)';
$('#copyPath').onclick = () => copyText($('#pathText').textContent);
$('#dlBtn').onclick = e => {
  if (data === undefined) return;
  const save = indent => download(fileName.replace(/\.(jsonl|ndjson)$/, '.json'), JSON.stringify(data, null, indent), 'application/json');
  UI.menu(e.currentTarget, [{label: 'Pretty-printed (readable)', onClick: () => save(2)}, {label: 'Minified (smallest)', onClick: () => save(0)}], {align: 'left'});
};
})();
