/* Code viewer: syntax highlighting, folding, outline, find & replace (working copy), line highlights and comments. */
(() => {
const P = document.getElementById('v-code');
// Queries are scoped to this viewer's pane so ids/classes never clash with other viewers.
const $ = (s, r = P) => r.querySelector(s), $$ = (s, r = P) => [...r.querySelectorAll(s)];
let file = null, lang = '', data = null, original = '', anns = [], sel = null, anchor = null;
let cat = store.get('codeCat', 'general'), style = 'highlight', fontSize = store.get('fs', 13), sideTab = null;
let matches = [], hits = [], hitI = -1, matchCase = false;
let folds = new Map(), folded = new Set(), replaced = 0;
const code = $('#codeBody');

P.style.setProperty('--fs', fontSize + 'px');
if (store.get('wrap', false)) { code.classList.add('wrap'); $('#wrapBtn').classList.add('active'); }
api('/api/languages').then(l => $('#langs').innerHTML = l.map(x => `<option value="${esc(x.alias)}">${esc(x.name)}</option>`).join('')).catch(() => {});

/* ---------------- loading ---------------- */
async function load(f, language) {
  file = f; lang = language || ''; sel = anchor = null; updateSel(); folded.clear(); replaced = 0; setModified();
  code.innerHTML = '<div style="padding:20px"><span class="spin"></span></div>';
  try {
    data = await api('/api/code?path=' + enc(f.path) + (lang ? '&lang=' + enc(lang) : ''));
    original = joined();
    $('#lang').textContent = data.language; $('#langIn').value = lang;
    $('#codeMeta').textContent = `${data.lines.length.toLocaleString()} lines · ${fmtSize(f.size)}` + (data.truncated ? ' · truncated at 2 MB' : '');
    const wrap = store.get('wrap', false) || data.alias === 'text';     // plain text reads better wrapped
    code.classList.toggle('wrap', wrap); $('#wrapBtn').classList.toggle('active', wrap);
    anns = await Ann.list(f.path);
    computeFolds(); drawCode(); decorate(); renderOutline();
    showSide(sideTab || (data.outline.length ? 'outline' : 'notes'));
    const j = App.takeJump(f.path); if (j) setTimeout(() => jump(j.locator.start), 150);
  } catch (e) { code.innerHTML = `<div style="padding:20px;color:var(--danger)">${esc(e.message)}</div>`; }
}
Viewers.code = f => { closeFind(); return load(f); };
const joined = () => data.raw.join('\n') + (data.eol ? '\n' : '');
function drawCode() {
  code.innerHTML = data.lines.map((h, i) => `<div class="ln" data-n="${i + 1}"><b title="Click to select · Shift+click for a range">${i + 1}</b><u class="fd${folds.has(i + 1) ? ' on' : ''}" ${folds.has(i + 1) ? `data-f="${i + 1}" title="Fold / unfold"` : ''}></u><span class="t">${h || ' '}</span></div>`).join('');
  applyFolds(); if ($('#find').value && !$('#findBar').hidden) runFind(false);
}

/* ---------------- folding (by indentation, works for any language) ---------------- */
function computeFolds() {
  folds = new Map(); const raw = data.raw, n = raw.length; if (n > 20000) return;
  const ind = raw.map(l => l.trim() ? l.match(/^[\t ]*/)[0].replace(/\t/g, '    ').length : -1);
  for (let i = 0; i < n; i++) {
    if (ind[i] < 0) continue; let j = i + 1; while (j < n && ind[j] < 0) j++;
    if (j >= n || ind[j] <= ind[i]) continue;
    let k = j, last = j; while (k < n && (ind[k] < 0 || ind[k] > ind[i])) { if (ind[k] >= 0) last = k; k++; }
    if (last > j) folds.set(i + 1, last + 1);       // at least two lines inside
  }
}
function hiddenSet() { const h = new Set(); for (const s of folded) { const e = folds.get(s); if (e) for (let i = s + 1; i <= e; i++) h.add(i); } return h; }
function applyFolds() {
  const hid = hiddenSet(); let prevHidden = false;
  for (const el of code.children) {
    if (el.classList.contains('ln')) { const n = +el.dataset.n; prevHidden = hid.has(n); el.classList.toggle('hid', prevHidden); el.classList.toggle('folded', folded.has(n)); el.querySelector('.fd')?.classList.toggle('closed', folded.has(n)); }
    else if (el.classList.contains('cmt')) el.classList.toggle('hid', prevHidden);
  }
}
function toggleFold(n) { folded.has(n) ? folded.delete(n) : folded.add(n); applyFolds(); }
function reveal(n) { let changed = false; for (const [s, e] of folds) if (folded.has(s) && n > s && n <= e) { folded.delete(s); changed = true; } if (changed) applyFolds(); }
$('#foldAll').onclick = () => { folded = new Set(folds.keys()); applyFolds(); };
$('#unfoldAll').onclick = () => { folded.clear(); applyFolds(); };

/* ---------------- outline & side panel ---------------- */
function renderOutline() {
  $('#outlineList').innerHTML = data.outline.length ? data.outline.map(o => `<button class="ol" data-l="${o.line}" style="padding-left:${10 + Math.min(Math.floor(o.indent / 2), 4) * 10}px"><span class="k ${o.kind}">${o.kind === 'class' ? 'C' : 'ƒ'}</span><span class="nm">${esc(o.name)}</span><small>${o.line}</small></button>`).join('')
    : '<div class="noresult">No functions or classes detected in this file.</div>';
}
$('#outlineList').onclick = e => { const b = e.target.closest('.ol'); if (b) jump(+b.dataset.l); };
function showSide(t) { sideTab = t; $$('#sideTabs button').forEach(b => b.classList.toggle('active', b.dataset.t === t)); $$('#notes [data-p]').forEach(d => d.hidden = d.dataset.p !== t); }
$('#sideTabs').onclick = e => { const b = e.target.closest('button'); if (b) showSide(b.dataset.t); };

/* ---------------- annotations (shared store: highlights, underlines, comments, bookmarks) ---------------- */
const annPanel = Ann.panel($('#annPanel'), {title: 'Annotations', getItems: () => anns, fileName: () => file?.name,
  onJump: a => jump(a.locator.start), onEdit: a => { jump(a.locator.start); setTimeout(() => composer(a), 60); }, onDelete: a => removeAnn(a)});
const renderPanel = () => { $('#nCount').textContent = anns.length; annPanel.render(); };
const lineEl = n => code.querySelector(`.ln[data-n="${n}"]`);
const movedNote = a => a.quote && data.raw[a.locator.start - 1] !== undefined && data.raw[a.locator.start - 1].trim() !== a.quote.split('\n')[0].trim();
function decorate() {
  $$('.cmt', code).forEach(e => e.remove());
  $$('.ln', code).forEach(e => { e.className = 'ln' + ['sel', 'hid', 'folded'].filter(c => e.classList.contains(c)).map(c => ' ' + c).join(''); e.style.removeProperty('--ac'); });
  for (const a of anns) {
    const {start, end} = a.locator, c = Ann.color(a.category);
    if (a.kind === 'bookmark') { const el = lineEl(start); if (el) { el.classList.add('bm'); el.style.setProperty('--bmc', c); } continue; }
    const cls = a.kind === 'underline' ? 'mku' : 'mkh';
    for (let i = start; i <= end; i++) { const el = lineEl(i); if (el) { el.classList.add(cls); el.style.setProperty('--ac', c); } }
    const endEl = lineEl(Math.min(end, data.lines.length));
    if (a.text && endEl) {
      endEl.classList.add('has');
      const div = document.createElement('div'); div.className = 'cmt'; div.dataset.id = a.id; div.style.setProperty('--cc', c);
      div.innerHTML = `<div class="cm-h"><span>${esc(Ann.where(a))}</span><span>${esc(Ann.name(a.category))}</span><span>${timeAgo(a.updated)}</span>${movedNote(a) ? '<span title="The text on this line has changed since you annotated it">line text changed</span>' : ''}<span class="spacer"></span><span class="cm-a"><button data-a="edit">Edit</button><button data-a="del">Delete</button></span></div><div class="cm-t">${esc(a.text)}</div>`;
      endEl.after(div);
    }
  }
  applyFolds(); renderPanel();
}
function jump(n) { reveal(n); const el = lineEl(n); if (!el) return; el.scrollIntoView({block: 'center'}); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); }

async function addAnn(kind, category, text, range = sel) {
  try {
    const quote = data.raw.slice(range.a - 1, range.b).join('\n').slice(0, 600);
    const a = await Ann.create(file.path, {kind, category, text, quote, locator: {start: range.a, end: range.b}});
    anns.push(a); decorate(); return a;
  } catch (e) { toast(e.message, true); }
}
async function removeAnn(a, ask = true) {
  if (ask && a.text && !await UI.confirm('The comment will be removed too.', {title: 'Delete this annotation?', confirm: 'Delete', danger: true})) return;
  try { await Ann.remove(a.id); anns = anns.filter(x => x.id !== a.id); decorate(); } catch (e) { toast(e.message, true); }
}
async function applyMark(category) {                      // one click: mark the selected lines (click again to remove)
  if (!sel) return; cat = category; store.set('codeCat', cat); $('#selCats').innerHTML = Ann.catDots(cat);
  const same = anns.find(a => a.kind === style && a.category === cat && a.locator.start === sel.a && a.locator.end === sel.b && !a.text);
  if (same) await removeAnn(same, false); else await addAnn(style, cat, '');
  clearSel();
}
async function toggleBookmark() {
  if (!sel) return; const n = sel.a, b = anns.find(a => a.kind === 'bookmark' && a.locator.start === n);
  if (b) { await removeAnn(b, false); toast('Bookmark removed'); } else { await addAnn('bookmark', 'general', '', {a: n, b: n}); toast('Line ' + n + ' bookmarked'); }
  clearSel();
}
function composer(a) {
  $$('.cmt.edit').forEach(e => e.remove());
  const editing = !!a, rng = editing ? {a: a.locator.start, b: a.locator.end} : sel; if (!rng) return;
  let c = editing ? a.category : cat;
  const div = document.createElement('div'); div.className = 'cmt edit'; div.style.setProperty('--cc', Ann.color(c));
  div.innerHTML = `<textarea placeholder="Write your explanation… (Ctrl+Enter to save)">${editing ? esc(a.text) : ''}</textarea><div class="row"><span class="pcats">${Ann.catDots(c, 'data-pc')}</span><span class="spacer" style="flex:1"></span><button class="btn" data-a="cancel">Cancel</button><button class="btn primary" data-a="save">Save</button></div>`;
  const old = editing && $(`.cmt[data-id="${a.id}"]`, code);
  (old || lineEl(rng.b)).after(div); if (old) old.hidden = true; reveal(rng.b);
  const ta = $('textarea', div); ta.focus();
  const doSave = async () => {
    const text = ta.value.trim();
    if (!editing && !text) return toast('Write something first, or use a colour to highlight only.', true);
    if (editing) { try { Object.assign(a, await Ann.update(a.id, {text, category: c})); } catch (e) { return toast(e.message, true); } decorate(); }
    else { await addAnn('highlight', c, text, rng); cat = c; store.set('codeCat', c); clearSel(); }
  };
  div.onclick = e => {
    const dot = e.target.closest('[data-pc]'); if (dot) { c = dot.dataset.pc; $$('.cdot', div).forEach(x => x.classList.toggle('on', x === dot)); div.style.setProperty('--cc', Ann.color(c)); return; }
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.a === 'save') doSave(); else { div.remove(); decorate(); }
  };
  ta.onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doSave(); if (e.key === 'Escape') { e.stopPropagation(); div.remove(); decorate(); } };
  div.scrollIntoView({block: 'nearest'});
}
code.addEventListener('click', async e => {
  const fd = e.target.closest('.fd[data-f]'); if (fd) return toggleFold(+fd.dataset.f);
  const b = e.target.closest('.ln > b');
  if (b) {
    const n = +b.parentElement.dataset.n;
    if (e.shiftKey && anchor) setSel(anchor, n); else if (sel && sel.a === n && sel.b === n) clearSel(); else { anchor = n; setSel(n, n); }
    return;
  }
  const btn = e.target.closest('.cmt .cm-a button'); if (!btn) return;
  const a = anns.find(x => x.id === btn.closest('.cmt').dataset.id);
  if (btn.dataset.a === 'edit') composer(a); else removeAnn(a);
});

/* ---------------- line selection ---------------- */
function setSel(a, b) { sel = {a: Math.min(a, b), b: Math.max(a, b)}; updateSel(); }
function clearSel() { sel = anchor = null; updateSel(); }
function updateSel() {
  $$('.ln.sel', code).forEach(e => e.classList.remove('sel'));
  $('#selBar').hidden = !sel; if (!sel) return;
  for (let i = sel.a; i <= sel.b; i++) lineEl(i)?.classList.add('sel');
  $('#selRange').textContent = sel.a === sel.b ? sel.a : sel.a + '–' + sel.b;
  $('#selCats').innerHTML = Ann.catDots(cat);
  $$('#selStyle button').forEach(b => b.classList.toggle('active', b.dataset.s === style));
}
$('#selCats').onclick = e => { const d = e.target.closest('.cdot[data-cat]'); if (d) applyMark(d.dataset.cat); };
$('#selStyle').onclick = e => { const b = e.target.closest('button'); if (b) { style = b.dataset.s; updateSel(); } };
$('#addCmt').onclick = () => sel && composer();
$('#bmBtn').onclick = toggleBookmark;
$('#toNotes').onclick = async () => { if (!sel) return; await Study.sendToNotes({path: file.path, quote: data.raw.slice(sel.a - 1, sel.b).join('\n'), where: Ann.where({locator: {start: sel.a, end: sel.b}}), locator: {start: sel.a, end: sel.b}, fence: data.alias}); clearSel(); };
$('#copySel').onclick = () => sel && copyText(data.raw.slice(sel.a - 1, sel.b).join('\n'));
$('#clearSel').onclick = clearSel;

/* ---------------- find and replace ---------------- */
const MAX_HITS = 3000;
function findAll(q) {
  const out = [], needle = matchCase ? q : q.toLowerCase();
  for (let i = 0; i < data.raw.length && out.length < MAX_HITS; i++) {
    const hay = matchCase ? data.raw[i] : data.raw[i].toLowerCase(); let pos = 0, idx;
    while ((idx = hay.indexOf(needle, pos)) >= 0 && out.length < MAX_HITS) { out.push({line: i, s: idx, e: idx + q.length}); pos = idx + q.length; }
  }
  return out;
}
function markLine(i, ranges) {
  const span = $('.t', lineEl(i + 1)); if (!span) return;
  for (const [s, e] of [...ranges].reverse()) {
    const nodes = [], w = document.createTreeWalker(span, NodeFilter.SHOW_TEXT); while (w.nextNode()) nodes.push(w.currentNode);
    let off = 0;
    for (const n of nodes) {
      const ns = off, ne = off + n.data.length; off = ne; const a = Math.max(s, ns), b = Math.min(e, ne); if (a >= b) continue;
      const mid = n.splitText(a - ns); mid.splitText(b - a); const m = document.createElement('mark'); m.className = 'fm'; mid.replaceWith(m); m.appendChild(mid);
    }
  }
}
function runFind(jumpToFirst = true) {
  $$('mark.fm', code).forEach(m => m.replaceWith(document.createTextNode(m.textContent))); $$('.t', code).forEach(t => t.normalize());
  const q = $('#find').value; matches = []; hits = []; hitI = -1;
  if (q) {
    matches = findAll(q); const byLine = new Map();
    matches.forEach(m => { if (!byLine.has(m.line)) byLine.set(m.line, []); byLine.get(m.line).push([m.s, m.e]); });
    byLine.forEach((r, i) => markLine(i, r)); hits = $$('mark.fm', code);
  }
  $('#findInfo').textContent = q ? (matches.length ? `${matches.length}${matches.length >= MAX_HITS ? '+' : ''}` : 'no matches') : '';
  if (matches.length && jumpToFirst) stepFind(1);
}
function stepFind(d) {
  if (!matches.length) return; hits[hitI]?.classList.remove('on');
  hitI = (hitI + d + matches.length) % matches.length; reveal(matches[hitI].line + 1);
  const m = hits[hitI]; if (m) { m.classList.add('on'); m.scrollIntoView({block: 'center'}); }
  $('#findInfo').textContent = `${hitI + 1} / ${matches.length}`;
}
function openFind(focusReplace) { $('#findBar').hidden = false; (focusReplace ? $('#repl') : $('#find')).focus(); (focusReplace ? $('#repl') : $('#find')).select(); }
function closeFind() { if ($('#findBar').hidden) return; $('#find').value = ''; runFind(false); $('#findBar').hidden = true; }
$('#findBtn').onclick = () => openFind(); $('#findClose').onclick = closeFind;
$('#caseBtn').onclick = () => { matchCase = !matchCase; $('#caseBtn').classList.toggle('active', matchCase); runFind(); };
$('#find').oninput = debounce(() => runFind(), 200);
$('#find').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') closeFind(); };
$('#repl').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#replOne').click(); } if (e.key === 'Escape') closeFind(); };
$('#fNext').onclick = () => stepFind(1); $('#fPrev').onclick = () => stepFind(-1);

async function applyEdit(newRaw, count) {
  const oldLen = data.raw.length;
  try {
    const r = await api('/api/code/highlight', {json: {text: newRaw.join('\n') + (data.eol ? '\n' : ''), name: file.name, lang: lang || data.alias}});
    data.raw = newRaw; data.lines = r.lines; data.outline = r.outline; replaced += count;
    computeFolds(); folded.clear(); drawCode(); decorate(); renderOutline(); setModified();
    if (newRaw.length !== oldLen && anns.length) toast('The number of lines changed, so existing comments may no longer line up.', true);
    $('#codeMeta').textContent = `${data.lines.length.toLocaleString()} lines · working copy`;
  } catch (e) { toast(e.message, true); }
}
function setModified() {
  const mod = !!data && joined() !== original;
  $('#codeMod').hidden = !mod; $('#modBar').hidden = !mod;
}
$('#replOne').onclick = async () => {
  if (!matches.length) return toast('Nothing to replace. Type something in Find first.', true);
  const i = hitI < 0 ? 0 : hitI, m = matches[i], repl = $('#repl').value, raw = [...data.raw];
  raw[m.line] = raw[m.line].slice(0, m.s) + repl + raw[m.line].slice(m.e);
  await applyEdit(raw, 1); runFind(false); hitI = Math.min(i, matches.length) - 1; stepFind(1);
};
$('#replAll').onclick = async () => {
  const q = $('#find').value; if (!q || !matches.length) return toast('Nothing to replace. Type something in Find first.', true);
  const repl = $('#repl').value, n = matches.length;
  if (n > 50 && !await UI.confirm('The original file is not changed until you save.', {title: `Replace ${n} matches in the working copy?`, confirm: 'Replace all'})) return;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
  await applyEdit(data.raw.map(l => l.replace(re, () => repl)), n); runFind(false); toast(`Replaced ${n} match${n === 1 ? '' : 'es'} in the working copy.`);
};
$('#modRevert').onclick = async () => { if (await UI.confirm('The text goes back to what is saved on disk.', {title: 'Discard all changes made in the viewer?', confirm: 'Discard changes', danger: true})) load(file, lang); };
$('#modDownload').onclick = () => download(file.name, joined());
$('#modSave').onclick = async () => {
  if (!await UI.confirm(`A backup copy (${file.name}.bak-<timestamp>) is saved next to it first.`, {title: `Overwrite “${file.name}” with the changed text?`, confirm: 'Save to file', danger: true})) return;
  try { const r = await api('/api/code/save', {json: {path: file.path, text: joined(), confirm: true}}); toast('Saved. Backup: ' + r.backup.split('/').pop()); await load(file, lang); }
  catch (e) { toast(e.message, true); }
};

/* ---------------- view options, export, shortcuts ---------------- */
async function gotoLine() { const v = await UI.prompt('Go to line', '', {message: 'Enter a line number from 1 to ' + data.lines.length + '.', label: 'Line number', confirm: 'Go'}); if (v && +v > 0) jump(Math.min(+v, data.lines.length)); }
$('#gotoBtn').onclick = () => data && gotoLine();
$('#langIn').onchange = e => file && load(file, e.target.value.trim());
$('#copyAll').onclick = () => data && copyText(data.raw.join('\n'));
const setFont = d => { fontSize = Math.max(10, Math.min(26, fontSize + d)); store.set('fs', fontSize); P.style.setProperty('--fs', fontSize + 'px'); };
$('#fontUp').onclick = () => setFont(1); $('#fontDn').onclick = () => setFont(-1);
$('#wrapBtn').onclick = () => { code.classList.toggle('wrap'); const on = code.classList.contains('wrap'); $('#wrapBtn').classList.toggle('active', on); store.set('wrap', on); };
$('#exportPdf').onclick = () => { if (!data) return; const had = code.classList.contains('wrap'); code.classList.add('wrap'); folded.clear(); applyFolds(); toast('Choose “Save as PDF” in the print dialog.'); setTimeout(() => { print(); if (!had) code.classList.remove('wrap'); }, 300); };
document.addEventListener('keydown', e => {
  if (!file || P.hidden) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 'f') { e.preventDefault(); openFind(); }
  else if (mod && k === 'h') { e.preventDefault(); openFind(true); }
  else if (mod && k === 'g') { e.preventDefault(); gotoLine(); }
  else if (e.key === 'Escape' && !typing()) { if (sel) clearSel(); else closeFind(); }
  else if (k === 'c' && !typing() && sel && !mod) composer();
  else if (k === 'b' && !typing() && sel && !mod) toggleBookmark();
});

})();
