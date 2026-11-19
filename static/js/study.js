/* Study workspace pages: Notes, Subjects, Library, plus the "organize this file" popover and "send to notes". */
const SA = {                                   // tiny wrapper around /api/study/<resource>
  list: (res, params = {}) => api('/api/study/' + res + (Object.keys(params).length ? '?' + new URLSearchParams(params) : '')),
  add: (res, body) => api('/api/study/' + res, {json: body}),
  upd: (res, id, body) => api(`/api/study/${res}/${id}`, {method: 'PATCH', json: body}),
  del: (res, id) => api(`/api/study/${res}/${id}`, {method: 'DELETE'}),
};

const Study = {
  _subjects: null,
  async subjects(force) { if (!this._subjects || force) this._subjects = await SA.list('subjects'); return this._subjects; },
  subjectName(id) { return (this._subjects || []).find(s => s.id === id)?.name || ''; },
  subjectOptions(selected, blank = 'No subject') {
    return `<option value="">${esc(blank)}</option>` + (this._subjects || []).map(s => `<option value="${s.id}"${s.id === selected ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  },
  where(locator) { return Ann.where({locator: locator || {}}); },

  /* "Send to notes": append a quote (with its source) to the note kept for this file */
  async sendToNotes({path, quote, where, locator, text, fence}) {
    try {
      const n = await api('/api/study/notes/append', {json: {path, quote, where, locator, text, fence}});
      toast(`Added to “${n.title}”`);
    } catch (e) { toast(e.message, true); }
  },

  /* ---------------- organize popover (subject, tags, collections, pin, revision) ---------------- */
  async organize(rec, anchor) {
    const old = $('#orgPop'); if (old) { old.remove(); return; }
    await this.subjects();
    let meta, cols, remind;
    try { [meta, cols] = await Promise.all([api('/api/study/file?path=' + enc(rec.path)), SA.list('collections')]); } catch (e) { return toast(e.message, true); }
    const pop = document.createElement('div'); pop.id = 'orgPop'; pop.className = 'orgpop';
    const paint = () => {
      pop.innerHTML = `<div class="op-row"><label>Subject</label><select id="opSub">${this.subjectOptions(meta.subject_id)}</select></div>
        <div class="op-row"><label>Tags</label><input id="opTags" type="text" placeholder="e.g. exam, recursion" value="${esc(meta.tags.join(', '))}"></div>
        <div class="op-row"><label>Pinned</label><label class="chk"><input id="opPin" type="checkbox" ${meta.pinned ? 'checked' : ''}> Show on the dashboard</label></div>
        <div class="op-sec">Collections</div>
        <div class="op-cols">${cols.map(c => `<label class="chk"><input type="checkbox" data-col="${c.id}" ${meta.collections.includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('') || '<span class="muted">No collections yet.</span>'}</div>
        <div class="op-row"><input id="opNewCol" type="text" placeholder="New collection name"><button class="btn" id="opAddCol">Add</button></div>
        <div class="op-sec">Revision</div>
        <div class="op-row"><input id="opDue" type="date" value="${new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10)}"><button class="btn" id="opRemind">Remind me to revise</button></div>
        <div class="op-sec">Notes about this file</div>
        <div class="op-notes">${meta.notes.map(n => `<a href="#/notes/${n.id}">${esc(n.title || 'Untitled note')}</a>`).join('') || '<span class="muted">None yet.</span>'}</div>
        <div class="op-row"><button class="btn" id="opNewNote">${icon('plus')}New note about this file</button></div>`;
      const save = async body => { try { const r = await api('/api/study/file', {method: 'PUT', json: {path: rec.path, ...body}}); Object.assign(meta, r); return r; } catch (e) { toast(e.message, true); } };
      $('#opSub', pop).onchange = e => save({subject_id: e.target.value || ''});
      $('#opTags', pop).onchange = e => save({tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean)}).then(r => r && ($('#opTags', pop).value = r.tags.join(', ')));
      $('#opPin', pop).onchange = e => save({pinned: e.target.checked});
      $$('[data-col]', pop).forEach(c => c.onchange = () => save({collection: c.dataset.col, member: c.checked}));
      $('#opAddCol', pop).onclick = async () => { const name = $('#opNewCol', pop).value.trim(); if (!name) return; try { const c = await SA.add('collections', {name}); cols.push(c); await save({collection: c.id, member: true}); paint(); } catch (e) { toast(e.message, true); } };
      $('#opRemind', pop).onclick = async () => { try { await SA.add('reminders', {title: 'Revise ' + rec.name, due: $('#opDue', pop).value, subject_id: meta.subject_id || '', file_id: rec.id}); toast('Added to your revision list'); } catch (e) { toast(e.message, true); } };
      $('#opNewNote', pop).onclick = async () => {
        try { const n = await SA.add('notes', {title: 'Notes: ' + rec.name, body: '', subject_id: meta.subject_id || ''}); await api(`/api/study/notes/${n.id}/links`, {json: {path: rec.path}}); pop.remove(); location.hash = '#/notes/' + n.id; } catch (e) { toast(e.message, true); }
      };
    };
    paint(); document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect(); pop.style.top = r.bottom + 6 + 'px'; pop.style.right = Math.max(8, innerWidth - r.right) + 'px';
    setTimeout(() => { const off = ev => { if (!pop.contains(ev.target) && !anchor.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', off); } }; document.addEventListener('mousedown', off); }, 0);
  },
};

addEventListener('hashchange', () => $('#orgPop')?.remove());   // the popover belongs to the file you were viewing

/* ======================================================================== NOTES */
const NS = {q: '', subject: '', tag: '', notes: [], tags: [], mode: store.get('noteMode', 'split'), timer: 0, dirty: false};
App.pages.notes = async (rest) => {
  const page = $('#page'); await Study.subjects();
  page.innerHTML = `<div class="page wide notes-page">
    <div class="bhead"><h1>Notes</h1><div class="seg" id="nSeg"><button class="active">My notes</button><button data-go="#/annotations">Annotations</button></div><span class="spacer"></span>
      <button class="btn primary" id="nNew">${icon('plus')}New note</button></div>
    <div class="nsplit"><aside class="nlist"><div class="ntools2"><input id="nQ" data-search type="search" placeholder="Search notes   ( / )" value="${esc(NS.q)}" aria-label="Search notes">
      <select id="nSubFilter" aria-label="Filter by subject">${Study.subjectOptions(NS.subject, 'All subjects')}</select></div><div class="ap-chips" id="nTags"></div><div id="nItems"></div></aside>
      <section class="neditor" id="nEditor"></section></div></div>`;
  $('#nSeg').onclick = e => { const b = e.target.closest('[data-go]'); if (b) App.go(b.dataset.go); };
  $('#nNew').onclick = newNote;
  $('#nQ').oninput = debounce(e => { NS.q = e.target.value.trim(); loadNotes(); }, 200);
  $('#nSubFilter').onchange = e => { NS.subject = e.target.value; loadNotes(); };
  $('#nTags').onclick = e => { const c = e.target.closest('.chip'); if (c) { NS.tag = NS.tag === c.dataset.t ? '' : c.dataset.t; loadNotes(); } };
  $('#nItems').onclick = e => { const it = e.target.closest('.nitem'); if (it) App.go('#/notes/' + it.dataset.id); };
  NS.tags = await api('/api/study/tags').catch(() => []);
  await loadNotes();
  if (rest[0]) openNote(rest[0]); else $('#nEditor').innerHTML = `<div class="empty"><h2>${NS.notes.length ? 'Select a note' : 'Write your first note'}</h2><p>Notes support Markdown, code blocks, tags and links to your files. They save automatically.</p><button class="btn primary" id="nNew2">${icon('plus')}New note</button></div>`, $('#nNew2')?.addEventListener('click', newNote);
};
async function loadNotes() {
  try { NS.notes = await api('/api/study/notes?' + new URLSearchParams({q: NS.q, subject: NS.subject, tag: NS.tag})); } catch (e) { return toast(e.message, true); }
  $('#nTags').innerHTML = NS.tags.slice(0, 10).map(t => `<button class="chip${NS.tag === t.tag ? ' on' : ''}" data-t="${esc(t.tag)}">#${esc(t.tag)}</button>`).join('');
  paintNoteList();
}
function paintNoteList() {
  if (!$('#nItems')) return;
  const cur = NS.open?.id;
  $('#nItems').innerHTML = NS.notes.length ? NS.notes.map(n => `<div class="nitem${n.id === cur ? ' on' : ''}" data-id="${n.id}"><div class="nt">${n.pinned ? icon('pin') : ''}${esc(n.title || 'Untitled note')}</div>
    <div class="np2">${esc((n.body || '').replace(/[#>*`\-\[\]]/g, '').replace(/\s+/g, ' ').slice(0, 110)) || '<i>Empty</i>'}</div>
    <div class="nm2">${n.subject_id ? esc(Study.subjectName(n.subject_id)) + ' · ' : ''}${timeAgo(n.updated)}</div></div>`).join('') : '<div class="noresult">No notes match.</div>';
}
async function newNote(subject) {
  try { const n = await SA.add('notes', {title: '', body: '', subject_id: typeof subject === 'string' ? subject : NS.subject}); App.go('#/notes/' + n.id); }
  catch (e) { toast(e.message, true); }
}
async function openNote(id) {
  clearTimeout(NS.timer); const box = $('#nEditor'); if (!box) return;
  let note;
  try { note = await api('/api/study/notes/' + id).catch(() => null); } catch (e) { return toast(e.message, true); }
  if (!note) { box.innerHTML = '<div class="empty"><h2>Note not found</h2><p>It may have been deleted.</p></div>'; return; }
  NS.open = note; paintNoteList();
  const snippets = await SA.list('snippets').catch(() => []);
  box.innerHTML = `<input id="nTitle" class="ntitle" placeholder="Untitled note" value="${esc(note.title)}" aria-label="Note title">
    <div class="ntools"><select id="nSubject" aria-label="Subject">${Study.subjectOptions(note.subject_id)}</select>
      <input id="nTagIn" type="text" placeholder="tags, comma separated" value="${esc(note.tags.join(', '))}" aria-label="Tags"><span class="spacer"></span>
      <span class="saved" id="nSaved">Saved</span><button class="icon-btn${note.pinned ? ' star-on' : ''}" id="nPin" title="Pin to the top" aria-label="Pin note">${icon('pin')}</button>
      <div class="seg" id="nMode"><button data-m="write">Write</button><button data-m="split">Split</button><button data-m="preview">Preview</button></div></div>
    <div class="ninsert"><button class="btn ghost" data-i="h">Heading</button><button class="btn ghost" data-i="b"><b>B</b></button><button class="btn ghost" data-i="i"><i>I</i></button>
      <button class="btn ghost" data-i="ul">List</button><button class="btn ghost" data-i="task">Checklist</button><button class="btn ghost" data-i="code">Code block</button><button class="btn ghost" data-i="link">Link</button><button class="btn ghost" data-i="table">Table</button>
      <select id="nSnip" aria-label="Insert a saved snippet"><option value="">Insert snippet…</option>${snippets.map(s => `<option value="${s.id}">${esc(s.title || 'Snippet')} (${esc(s.language || 'text')})</option>`).join('')}</select>
      <span class="spacer"></span><button class="btn ghost" id="nLinkFile">${icon('plus')}Link a file…</button><button class="btn ghost" id="nMd">${icon('download')}.md</button><button class="btn ghost" id="nPrint">${icon('print')}PDF</button><button class="btn ghost danger" id="nDel">${icon('trash')}Delete</button></div>
    <div class="nbody" data-mode="${NS.mode}"><textarea id="nText" spellcheck="true" placeholder="Write in Markdown…  # Heading, **bold**, - list, \`\`\`code\`\`\`">${esc(note.body)}</textarea><article id="nPrev" class="markdown-body np"></article></div>
    <div class="nlinks" id="nLinks"></div>`;
  const ta = $('#nText'), saved = $('#nSaved');
  const setSaved = t => saved.textContent = t;
  const titleEl = $('#nTitle'), subEl = $('#nSubject'), tagEl = $('#nTagIn');    // keep references so a late autosave still works after you leave the page
  const collect = () => ({title: titleEl.value.trim(), body: ta.value, subject_id: subEl.value, tags: tagEl.value.split(',').map(t => t.trim()).filter(Boolean)});
  const save = async () => {
    try { const n = await SA.upd('notes', id, collect()); Object.assign(note, n); NS.dirty = false; setSaved('Saved'); const i = NS.notes.findIndex(x => x.id === id); if (i >= 0) NS.notes[i] = n; paintNoteList(); }
    catch (e) { setSaved('Not saved'); toast(e.message, true); }
  };
  const later = () => { NS.dirty = true; setSaved('Saving…'); clearTimeout(NS.timer); NS.timer = setTimeout(save, 700); };
  const preview = debounce(async () => { try { $('#nPrev').innerHTML = (await api('/api/render', {json: {text: ta.value}})).html || '<p class="muted">Nothing to preview yet.</p>'; } catch {} }, 250);
  ['#nTitle', '#nText', '#nTagIn'].forEach(s => $(s).oninput = () => { later(); if (s === '#nText') preview(); });
  $('#nSubject').onchange = later;
  $('#nPin').onclick = async () => { try { const n = await SA.upd('notes', id, {pinned: !note.pinned}); Object.assign(note, n); $('#nPin').classList.toggle('star-on', n.pinned); loadNotes(); } catch (e) { toast(e.message, true); } };
  $('#nMode').onclick = e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); };
  const setMode = m => { NS.mode = m; store.set('noteMode', m); $('.nbody').dataset.mode = m; $$('#nMode button').forEach(b => b.classList.toggle('active', b.dataset.m === m)); if (m !== 'write') preview(); };
  setMode(NS.mode);
  const wrap = (before, after = before, placeholder = '') => { const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || placeholder; ta.setRangeText(before + sel + after, s, e, 'select'); ta.focus(); ta.dispatchEvent(new Event('input')); };
  const prefix = p => { const s = ta.selectionStart, lineStart = ta.value.lastIndexOf('\n', s - 1) + 1; ta.setRangeText(p, lineStart, lineStart, 'end'); ta.focus(); ta.dispatchEvent(new Event('input')); };
  $('.ninsert').onclick = e => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    ({h: () => prefix('## '), b: () => wrap('**', '**', 'bold'), i: () => wrap('*', '*', 'italic'), ul: () => prefix('- '), task: () => prefix('- [ ] '), code: () => wrap('\n```python\n', '\n```\n', 'code'),
      link: () => wrap('[', '](https://)', 'text'), table: () => wrap('\n| Column A | Column B |\n|---|---|\n| ', ' |  |\n', 'value')})[b.dataset.i]();
  };
  $('#nSnip').onchange = e => { const s = snippets.find(x => x.id === e.target.value); if (s) wrap('\n```' + (s.language || '') + '\n' + s.code.replace(/\n$/, '') + '\n```\n', '', ''); e.target.value = ''; };
  $('#nMd').onclick = () => download((note.title || 'note').replace(/[^\w.-]+/g, '_') + '.md', (note.title ? '# ' + note.title + '\n\n' : '') + ta.value, 'text/markdown');
  $('#nPrint').onclick = async () => {
    const html = (await api('/api/render', {json: {text: (note.title ? '# ' + note.title + '\n\n' : '') + ta.value}})).html;
    const area = document.createElement('div'); area.id = 'notePrint'; area.className = 'markdown-body'; area.innerHTML = html; document.body.appendChild(area);
    const theme = document.documentElement.dataset.theme; document.documentElement.dataset.theme = 'light';
    toast('Choose “Save as PDF” in the print dialog.'); setTimeout(() => { print(); area.remove(); document.documentElement.dataset.theme = theme; }, 250);
  };
  $('#nDel').onclick = async () => { if (!await UI.confirm('This cannot be undone.', {title: 'Delete this note?', confirm: 'Delete', danger: true})) return; try { await SA.del('notes', id); NS.open = null; await loadNotes(); App.go('#/notes'); } catch (e) { toast(e.message, true); } };
  const paintLinks = async () => {
    const links = await api(`/api/study/notes/${id}/links`).catch(() => []);
    $('#nLinks').innerHTML = links.length ? '<b>Linked files</b>' + links.map(l => `<span class="lk${l.exists ? '' : ' missing'}"><a href="#" data-p="${esc(l.file.path)}" data-l='${esc(JSON.stringify(l.locator))}'>${icon(fileIcon(l.file.category))}${esc(l.file.name)}${l.locator.page || l.locator.start ? ' · ' + esc(Study.where(l.locator)) : ''}</a><button class="icon-btn" data-rm='${esc(JSON.stringify({path: l.file.path, locator: l.locator}))}' aria-label="Remove link">${icon('x')}</button></span>`).join('') : '';
  };
  $('#nLinks').onclick = async e => {
    const a = e.target.closest('a[data-p]'); if (a) { e.preventDefault(); const loc = JSON.parse(a.dataset.l || '{}'); return App.openAt(a.dataset.p, {locator: loc}); }
    const rm = e.target.closest('[data-rm]'); if (rm) { await api(`/api/study/notes/${id}/links`, {method: 'DELETE', json: JSON.parse(rm.dataset.rm)}); paintLinks(); }
  };
  $('#nLinkFile').onclick = async () => { try { const r = await api('/api/fs/native', {json: {mode: 'file'}}); if (r.paths[0]) { await api(`/api/study/notes/${id}/links`, {json: {path: r.paths[0]}}); paintLinks(); } } catch (e) { toast(e.message, true); } };
  paintLinks();
  if (!note.title && !note.body) $('#nTitle').focus();
}
window.addEventListener('beforeunload', e => { if (NS.dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ======================================================================== SUBJECTS */
App.pages.subjects = async (rest) => {
  const page = $('#page'); page.innerHTML = '<div class="page"><span class="spin"></span></div>';
  const [subjects, counts] = await Promise.all([Study.subjects(true), api('/api/study/subject-counts').catch(() => ({}))]);
  if (rest[0]) return subjectDetail(rest[0], subjects, counts);
  page.innerHTML = `<div class="page"><div class="page-title"><h1>Subjects</h1><span class="spacer"></span></div>
    <p class="sub" style="color:var(--fg2);margin:-8px 0 16px">Group files, notes, snippets and practice questions by course.</p>
    <div class="cards">${subjects.map(s => { const c = counts[s.id] || {}; return `<div class="card subj" data-id="${s.id}"><span class="tile">${icon('book')}</span><b>${esc(s.name)}</b>
      <span class="meta">${c.notes || 0} notes · ${c.files || 0} files · ${c.questions || 0} questions${c.minutes ? ' · ' + c.minutes + ' min studied' : ''}</span></div>`; }).join('')}</div>
    <div class="set-row" style="margin-top:22px;padding:0"><input id="subNew" type="text" placeholder="Add your own subject, e.g. Compiler Design" style="width:320px"><button class="btn primary" id="subAdd">${icon('plus')}Add subject</button></div></div>`;
  page.onclick = e => { const c = e.target.closest('.subj'); if (c) App.go('#/subjects/' + c.dataset.id); };
  $('#subAdd').onclick = async () => { const name = $('#subNew').value.trim(); if (!name) return; try { await SA.add('subjects', {name, position: subjects.length}); App.pages.subjects([]); } catch (e) { toast(e.message, true); } };
  $('#subNew').onkeydown = e => { if (e.key === 'Enter') $('#subAdd').click(); };
};
async function subjectDetail(id, subjects, counts) {
  const s = subjects.find(x => x.id === id), page = $('#page');
  if (!s) { page.innerHTML = '<div class="page"><div class="empty"><h2>Subject not found</h2><a class="btn" href="#/subjects">Back to subjects</a></div></div>'; return; }
  const [notes, files, snippets, due] = await Promise.all([api('/api/study/notes?subject=' + id), api('/api/study/files?subject=' + id), SA.list('snippets', {subject_id: id}), api('/api/study/practice/due?subject=' + id)]);
  const c = counts[id] || {};
  page.innerHTML = `<div class="page"><div class="page-title"><a class="icon-btn" href="#/subjects" aria-label="Back">${icon('back')}</a><h1>${esc(s.name)}</h1><span class="spacer"></span>
      <button class="btn" id="sdRename">${icon('edit')}Rename</button><button class="btn danger" id="sdDelete">${icon('trash')}Delete</button></div>
    <div class="strip static"><div><b>${notes.length}</b><span>notes</span></div><div><b>${files.length}</b><span>files</span></div><div><b>${snippets.length}</b><span>snippets</span></div>
      <div><b>${due.length}</b><span>to review</span></div><div><b>${c.minutes || 0}</b><span>minutes studied</span></div></div>
    <div class="sec-head"><h2>Notes</h2><button class="btn" id="sdNote">${icon('plus')}New note</button></div>
    ${notes.length ? `<div class="rows">${notes.map(n => `<div class="row" data-go="#/notes/${n.id}">${icon('note', 'kind')}<span class="nm">${esc(n.title || 'Untitled note')}</span><span class="where">${esc((n.body || '').replace(/\s+/g, ' ').slice(0, 90))}</span><span class="when">${timeAgo(n.updated)}</span></div>`).join('')}</div>` : '<div class="rows"><div class="noresult">No notes for this subject yet.</div></div>'}
    <div class="sec-head"><h2>Files</h2><button class="btn" id="sdFiles">${icon('plus')}Add files…</button></div>
    ${files.length ? `<div class="rows">${files.map(f => App.rowHtml(f)).join('')}</div>` : '<div class="rows"><div class="noresult">Add files from your computer, or use the tag button in any open file.</div></div>'}
    <div class="sec-head"><h2>Study</h2></div>
    <div class="rows"><div class="row" data-go="#/toolkit/practice">${icon('comment', 'kind')}<span class="nm">Practice questions</span><span class="where">${due.length} due for review</span></div>
      <div class="row" data-go="#/toolkit/snippets">${icon('code', 'kind')}<span class="nm">Code snippets</span><span class="where">${snippets.length} saved</span></div></div></div>`;
  page.onclick = e => { const g = e.target.closest('[data-go]'); if (g) return App.go(g.dataset.go); App.rowClick(e); };
  $('#sdNote').onclick = () => newNote(id);
  $('#sdRename').onclick = async () => { const name = await UI.prompt('Rename subject', s.name, {label: 'Subject name', confirm: 'Rename'}); if (name && name.trim()) { try { await SA.upd('subjects', id, {name}); App.pages.subjects([id]); } catch (e) { toast(e.message, true); } } };
  $('#sdDelete').onclick = async () => { if (!await UI.confirm('Its notes, files and questions are kept; they just lose this subject.', {title: `Delete the subject “${s.name}”?`, confirm: 'Delete', danger: true})) return; try { await SA.del('subjects', id); App.go('#/subjects'); } catch (e) { toast(e.message, true); } };
  $('#sdFiles').onclick = async () => {
    try { const r = await api('/api/fs/native', {json: {mode: 'files'}}); for (const p of r.paths) await api('/api/study/file', {method: 'PUT', json: {path: p, subject_id: id}}); if (r.paths.length) { toast(r.paths.length + ' file(s) added'); App.pages.subjects([id]); } }
    catch (e) { toast(e.message, true); }
  };
}

/* ======================================================================== LIBRARY */
App.pages.library = async (rest) => {
  const tab = rest[0] || 'favorites', page = $('#page'); page.innerHTML = '<div class="page"><span class="spin"></span></div>';
  const tabs = [['favorites', 'Favorites'], ['collections', 'Collections'], ['tags', 'Tags'], ['modified', 'Recently modified']];
  const head = `<div class="page-title"><h1>Library</h1><div class="seg" id="libSeg">${tabs.map(([k, n]) => `<button data-t="${k}" class="${k === tab ? 'active' : ''}">${n}</button>`).join('')}</div></div>`;
  const shell = body => { page.innerHTML = `<div class="page">${head}${body}</div>`; $('#libSeg').onclick = e => { const b = e.target.closest('button'); if (b) App.go('#/library/' + b.dataset.t); }; page.onclick = e => { const g = e.target.closest('[data-go]'); if (g) return App.go(g.dataset.go); App.rowClick(e); }; };
  const rows = (list, empty) => list.length ? `<div class="rows">${list.map(f => App.rowHtml(f)).join('')}</div>` : `<div class="empty"><h2>${empty[0]}</h2><p>${empty[1]}</p></div>`;
  try {
    if (tab === 'favorites') { const l = await api('/api/library/favorites'); shell(rows(l, ['No favorites yet', 'Open a file and click the star in the top bar.'])); }
    else if (tab === 'modified') { const l = await api('/api/study/modified'); shell(rows(l.map(f => ({...f, last_opened: f.mtime})), ['Nothing here yet', 'Files you have opened appear here, newest change first.'])); }
    else if (tab === 'tags') {
      const tags = await api('/api/study/tags'), cur = rest[1] ? decodeURIComponent(rest[1]) : '';
      let body = tags.length ? `<div class="chips" style="padding:0 0 14px">${tags.map(t => `<button class="chip${t.tag === cur ? ' on' : ''}" data-go="#/library/tags/${enc(t.tag)}">#${esc(t.tag)} <small>${t.count}</small></button>`).join('')}</div>` : '<div class="empty"><h2>No tags yet</h2><p>Tag files with the tag button in the top bar of any open file, or tag your notes.</p></div>';
      if (cur) { const [f, n] = await Promise.all([api('/api/study/files?tag=' + enc(cur)), api('/api/study/notes?tag=' + enc(cur))]); body += `<div class="sec-head"><h2>Files tagged #${esc(cur)}</h2></div>${rows(f, ['No files', ''])}<div class="sec-head"><h2>Notes</h2></div>${n.length ? `<div class="rows">${n.map(x => `<div class="row" data-go="#/notes/${x.id}">${icon('note', 'kind')}<span class="nm">${esc(x.title || 'Untitled note')}</span></div>`).join('')}</div>` : '<div class="rows"><div class="noresult">No notes with this tag.</div></div>'}`; }
      shell(body);
    } else {
      const [cols, counts] = await Promise.all([SA.list('collections'), api('/api/study/collection-counts')]), cur = rest[1] || '';
      let body = `<div class="chips" style="padding:0 0 14px">${cols.map(c => `<button class="chip${c.id === cur ? ' on' : ''}" data-go="#/library/collections/${c.id}">${esc(c.name)} <small>${counts[c.id] || 0}</small></button>`).join('')}</div>
        <div class="set-row" style="padding:0 0 14px"><input id="colNew" type="text" placeholder="New collection, e.g. Midterm revision" style="width:280px"><button class="btn" id="colAdd">${icon('plus')}Create</button></div>`;
      if (cur) { const f = await api(`/api/study/collections/${cur}/files`); body += `<div class="sec-head"><h2>${esc(cols.find(c => c.id === cur)?.name || '')}</h2><button class="btn danger" id="colDel">${icon('trash')}Delete collection</button></div>${rows(f, ['Empty collection', 'Add files with the tag button in the top bar of any open file.'])}`; }
      else if (!cols.length) body += '<div class="empty"><h2>No collections yet</h2><p>Collections group files from different folders, for example for one exam.</p></div>';
      shell(body);
      $('#colAdd').onclick = async () => { const name = $('#colNew').value.trim(); if (!name) return; try { const c = await SA.add('collections', {name}); App.go('#/library/collections/' + c.id); } catch (e) { toast(e.message, true); } };
      $('#colDel')?.addEventListener('click', async () => { if (await UI.confirm('The files themselves are not touched.', {title: 'Delete this collection?', confirm: 'Delete', danger: true})) { await SA.del('collections', cur); App.go('#/library/collections'); } });
    }
  } catch (e) { page.innerHTML = `<div class="page"><div class="empty"><h2>Something went wrong</h2><p>${esc(e.message)}</p></div></div>`; }
};
