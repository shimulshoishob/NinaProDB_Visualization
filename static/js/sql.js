(() => {
const P = document.getElementById('v-sql');
// Queries are scoped to this viewer's pane so ids/classes never clash with other viewers.
const $ = (s, r = P) => r.querySelector(s), $$ = (s, r = P) => [...r.querySelectorAll(s)];
let script = null, handle = null, objects = [], cur = null, tab = 'data', sort = null, desc = false, offset = 0, total = 0, cameFrom = null, lastSql = '';
const show = id => ['scriptView', 'dbView'].forEach(x => $('#' + x).hidden = x !== id);

function lineHtml(lines, from = 1) { return lines.map((h, i) => `<div class="ln" id="L${i + from}"><b>${i + from}</b><span>${h || ' '}</span></div>`).join(''); }

Viewers.sql = async f => {
  cameFrom = null;
  if (f.ext === '.sql') return openScript(f);
  handle = 'file:' + f.path; show('dbView'); $('#dName').textContent = f.name; $('#backScript').hidden = true;
  await loadDb(f.size);
};

/* ---------------- script ---------------- */
async function openScript(f) {
  show('scriptView'); $('#sName').textContent = f.name; $('#sBanner').hidden = true;
  $$('#fmtSeg button').forEach(b => b.classList.toggle('active', b.dataset.f === 'orig'));
  try {
    script = await api('/api/sql/script?path=' + encodeURIComponent(f.path)); script.path = f.path;
    $('#sqlCode').innerHTML = lineHtml(script.lines);
    const kinds = {}; script.statements.forEach(s => kinds[s.type] = (kinds[s.type] || 0) + 1);
    $('#sMeta').textContent = `${fmtSize(f.size)} · ${script.lines.length} lines · ${script.statements.length} statements`;
    $('#outline').innerHTML = '<h4>Outline</h4>' + script.statements.map(s => `<div class="st" data-l="${s.line}"><span class="ty ${s.type}">${esc(s.type)}</span><span class="nm">${esc(s.name || '')}</span><small>${s.line}</small></div>`).join('');
  } catch (e) { $('#sqlCode').innerHTML = `<div class="pad err">${esc(e.message)}</div>`; }
}
$('#outline').onclick = e => {
  const s = e.target.closest('.st'); if (!s) return;
  const el = $('#L' + s.dataset.l); el.scrollIntoView({block: 'center'}); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200);
};
$('#fmtSeg').onclick = async e => {
  const b = e.target.closest('button'); if (!b || !script) return;
  $$('#fmtSeg button').forEach(x => x.classList.toggle('active', x === b));
  if (b.dataset.f === 'orig') { $('#sqlCode').innerHTML = lineHtml(script.lines); return; }
  try { const d = await api('/api/sql/format', {json: {text: script.text}}); script.pretty = d.text; $('#sqlCode').innerHTML = lineHtml(d.lines); } catch (er) { toast(er.message, true); }
};
$('#sCopy').onclick = () => copyText(script?.pretty && $('#fmtSeg .active').dataset.f === 'pretty' ? script.pretty : script?.text || '');
$('#sRun').onclick = async () => {
  const b = $('#sRun'); b.disabled = true; b.textContent = 'Running…';
  try {
    const r = await api('/api/sql/sandbox', {json: {path: script.path}});
    const ban = $('#sBanner'); ban.hidden = false;
    ban.className = r.errors.length ? 'bad' : 'ok';
    ban.innerHTML = `Executed <b>${r.ok}</b> statements in a temporary in-memory database` + (r.errors.length ? ` · <b>${r.errors.length} failed</b> (this viewer uses SQLite; other dialects may not run):<ul>${r.errors.map(x => `<li>line ${x.line}: ${esc(x.error)}</li>`).join('')}</ul>` : ' · no errors') + ` · <a href="#" id="seeDb">Open results →</a>`;
    $('#seeDb').onclick = ev => { ev.preventDefault(); cameFrom = script.path; handle = r.handle; show('dbView'); $('#dName').textContent = 'Sandbox: ' + $('#sName').textContent; $('#backScript').hidden = false; loadDb(); };
  } catch (e) { toast(e.message, true); } finally { b.disabled = false; b.textContent = '▶ Run in sandbox'; }
};
$('#backScript').onclick = () => show('scriptView');

/* ---------------- database ---------------- */
async function loadDb(size) {
  $('#dBody').innerHTML = '<div class="pad"><span class="spin"></span></div>';
  try {
    objects = (await api('/api/db/info?handle=' + encodeURIComponent(handle))).objects;
    $('#dMeta').textContent = (size ? fmtSize(size) + ' · ' : '') + `${objects.filter(o => o.type === 'table').length} tables, ${objects.filter(o => o.type === 'view').length} views`;
    $('#objs').innerHTML = objects.map(o => `<span class="obj ${o.type}" data-n="${esc(o.name)}">${esc(o.name)}<small>${o.rows ?? ''}</small></span>`).join('') || '<span class="badge">empty database</span>';
    tab = 'data'; $$('#dTabs button').forEach(b => b.classList.toggle('active', b.dataset.t === 'data'));
    if (objects.length) selectObj(objects[0].name); else $('#dBody').innerHTML = '<div class="empty">No tables found.</div>';
  } catch (e) { $('#dBody').innerHTML = `<div class="pad err">${esc(e.message)}</div>`; }
}
function selectObj(name) {
  cur = objects.find(o => o.name === name); sort = null; desc = false; offset = 0; $('#dFilter').value = '';
  $$('.obj').forEach(o => o.classList.toggle('active', o.dataset.n === name)); renderTab();
}
$('#objs').onclick = e => { const o = e.target.closest('.obj'); if (o) selectObj(o.dataset.n); };
$('#dTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; tab = b.dataset.t; $$('#dTabs button').forEach(x => x.classList.toggle('active', x === b)); renderTab(); };
function renderTab() {
  $('#dataTools').style.display = tab === 'data' ? 'contents' : 'none';
  $('#dExport').hidden = tab === 'structure';
  ({data: renderData, structure: renderStructure, query: renderQuery})[tab]();
}
const cellHtml = v => v === null ? '<td class="nul">NULL</td>' : typeof v === 'number' ? `<td class="num">${v}</td>` : `<td title="${esc(String(v))}">${esc(String(v))}</td>`;
function gridHtml(cols, rows, start = 0) {
  return `<table class="g"><thead><tr><th style="cursor:default">#</th>${cols.map(c => `<th data-c="${esc(c)}">${esc(c)}${sort === c ? (desc ? ' ▼' : ' ▲') : ''}</th>`).join('')}</tr></thead><tbody>` +
    rows.map((r, i) => `<tr><td class="rn">${start + i + 1}</td>${r.map(cellHtml).join('')}</tr>`).join('') + '</tbody></table>';
}
async function renderData() {
  if (!cur) return;
  const limit = +$('#pageSize').value, q = $('#dFilter').value;
  try {
    const d = await api(`/api/db/rows?handle=${encodeURIComponent(handle)}&table=${encodeURIComponent(cur.name)}&limit=${limit}&offset=${offset}&q=${encodeURIComponent(q)}` + (sort ? `&sort=${encodeURIComponent(sort)}&desc=${desc ? 1 : 0}` : ''));
    total = d.total;
    $('#dBody').innerHTML = d.rows.length ? gridHtml(d.columns, d.rows, d.offset) : '<div class="empty"><h2>No rows</h2></div>';
    $$('#dBody th[data-c]').forEach(th => th.onclick = () => { desc = sort === th.dataset.c ? !desc : false; sort = th.dataset.c; offset = 0; renderData(); });
    $('#pInfo').textContent = total ? `${offset + 1}–${Math.min(offset + limit, total)} of ${total.toLocaleString()}` : '0 rows';
    $('#pPrev').disabled = offset <= 0; $('#pNext').disabled = offset + limit >= total;
  } catch (e) { $('#dBody').innerHTML = `<div class="pad err">${esc(e.message)}</div>`; }
}
$('#pPrev').onclick = () => { offset = Math.max(0, offset - +$('#pageSize').value); renderData(); };
$('#pNext').onclick = () => { offset += +$('#pageSize').value; renderData(); };
$('#pageSize').onchange = () => { offset = 0; renderData(); };
$('#dFilter').oninput = debounce(() => { offset = 0; if (tab === 'data') renderData(); }, 250);

function renderStructure() {
  if (!cur) return;
  $('#dBody').innerHTML = `<div class="pad"><h3>${esc(cur.name)} <span class="badge">${cur.type}</span> <span class="badge">${cur.rows ?? '?'} rows</span></h3>
  <table class="g" style="min-width:0"><thead><tr><th>Column</th><th>Type</th><th>Not null</th><th>Default</th><th>Key</th></tr></thead><tbody>${cur.columns.map(c =>
    `<tr><td>${esc(c.name)}</td><td>${esc(c.type || '')}</td><td>${c.notnull ? '✓' : ''}</td><td>${c.default === null ? '' : esc(String(c.default))}</td><td>${c.pk ? '<span class="pk">PK</span>' : ''}${cur.fks.filter(f => f.from === c.name).map(f => ` → ${esc(f.table)}.${esc(f.to || '')}`).join('')}</td></tr>`).join('')}</tbody></table>
  <h3 style="margin-top:20px">DDL</h3><pre>${esc(cur.ddl || '')}${cur.indexes.length ? '\n\n' + esc(cur.indexes.join(';\n\n')) + ';' : ''}</pre></div>`;
}
function renderQuery() {
  $('#dBody').innerHTML = `<div class="pad"><textarea id="editor" spellcheck="false" placeholder="SELECT * FROM ...">${esc(lastSql || (cur ? `SELECT * FROM "${cur.name}" LIMIT 100` : ''))}</textarea>
  <div style="margin:8px 0;display:flex;gap:8px;align-items:center"><button class="btn primary" id="runQ">▶ Run <kbd>Ctrl</kbd>+<kbd>Enter</kbd></button><span class="badge">read-only</span><span id="qMsg" class="badge" hidden></span></div><div id="qOut"></div></div>`;
  $('#runQ').onclick = runQuery;
  $('#editor').onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runQuery(); } };
}
async function runQuery() {
  lastSql = $('#editor').value; const out = $('#qOut'), msg = $('#qMsg');
  out.innerHTML = '<span class="spin"></span>';
  try {
    const d = await api('/api/db/query', {json: {handle, sql: lastSql}});
    msg.hidden = false; msg.textContent = `${d.rows.length}${d.truncated ? '+' : ''} rows · ${d.ms} ms`;
    out.innerHTML = d.columns.length ? gridHtml(d.columns, d.rows) + (d.truncated ? '<p class="badge">Showing first 1000 rows — use Export CSV for everything.</p>' : '') : '<p class="badge">Statement ran with no result set.</p>';
  } catch (e) { msg.hidden = true; out.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
$('#dExport').onclick = () => {
  const base = '/api/db/export.csv?handle=' + encodeURIComponent(handle);
  if (tab === 'query') { const s = $('#editor')?.value; if (!s) return; location.href = base + '&sql=' + encodeURIComponent(s); }
  else if (cur) location.href = base + '&table=' + encodeURIComponent(cur.name);
};
})();
