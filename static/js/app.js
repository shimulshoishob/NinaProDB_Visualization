/* App shell: hash router, dashboard, category file browser, recent/favourites, settings, document bar. */
const Viewers = {};   // each viewer script registers Viewers.<name> = async file => { ... }
const enc = encodeURIComponent;

const App = {
  queue: [],          // files the user selected together (or siblings), for [ and ] navigation
  viewAs: {},         // per-file viewer override: path -> 'code'
  current: null,      // record of the open file
  lastPage: '#/',     // where "Back" returns to
  jump: null,         // {path, ann}: where a viewer should scroll to after opening (set by the Annotations page)
  bs: null,           // browser state
  pages: {},          // extra pages registered by other scripts: pages.name = (rest, params) => ...

  init() {
    Theme.apply(); hydrateIcons();
    $('#navToggle').onclick = () => this.toggleNav();
    $('.brand').onclick = () => { location.hash = '#/'; };
    if (store.get('navMin', false)) document.body.classList.add('nav-min');
    addEventListener('hashchange', () => this.route());
    document.addEventListener('keydown', e => this.keys(e));
    UI.initTips();
    $('#skipBtn').onclick = () => { const t = $('#page').hidden ? $('#main') : $('#page'); t.focus(); };
    A11y.start(); this.route();
  },
  /* highlight the sidebar entry whose route matches best (the longest matching prefix wins) */
  markNav(path) {
    const hits = $$('.nav-item').map(a => {
      const m = a.dataset.match || a.getAttribute('href').slice(1), also = a.dataset.also;
      const ok = m === '/' ? (path === '/' || path === '' || (also && path.startsWith(also))) : (path === m || path.startsWith(m + '/'));
      return ok ? [a, m.length] : null;
    }).filter(Boolean).sort((x, y) => y[1] - x[1]);
    $$('.nav-item').forEach(a => { const on = !!hits[0] && hits[0][0] === a; a.classList.toggle('on', on); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  },
  toggleNav() { document.body.classList.toggle('nav-min'); store.set('navMin', document.body.classList.contains('nav-min')); },

  /* ------------------------------------------------ routing */
  route() {
    const [path, qs] = (location.hash.slice(1) || '/').split('?');
    const params = new URLSearchParams(qs || '');
    this.markNav(path);
    const parts = path.split('/').filter(Boolean);
    if (parts[0] === 'open') return this.routeOpen(params.get('path'));
    this.lastPage = location.hash || '#/';
    this.showPage();
    if (parts[0] === 'browse') return this.browse(parts[1], params.get('path'));
    if (parts[0] === 'recent') return this.listPage('recent');
    if (parts[0] === 'favorites') return this.go('#/library');
    if (this.pages[parts[0]]) return this.pages[parts[0]](parts.slice(1), params);
    if (parts[0] === 'annotations') return this.annotationsPage(parts.slice(1));
    if (parts[0] === 'settings') return this.settings();
    return this.dashboard();
  },
  showPage() {
    $('#page').hidden = false; $('#docbar').hidden = true; $$('.vpane').forEach(p => p.hidden = true);
    const names = {'': 'Dashboard', browse: 'Browse files', recent: 'Recent files', library: 'Library', subjects: 'Subjects', notes: 'Notes', planner: 'Planner', toolkit: 'Toolkit', annotations: 'Annotations', settings: 'Settings'};
    document.title = (names[location.hash.slice(2).split(/[/?]/)[0]] || 'Study Workspace') + ' - Study Workspace';
    if (!typing()) $('#page').focus({preventScroll: true});          // keyboard and screen-reader users start at the new page
  },
  showPane(name) { $('#page').hidden = true; $('#docbar').hidden = false; $$('.vpane').forEach(p => p.hidden = p.id !== 'v-' + name); },
  go(hash) { location.hash = hash; },
  back() { location.hash = this.lastPage; },

  /* ------------------------------------------------ opening files */
  open(path, queue) {
    if (queue) this.queue = queue; else if (!this.queue.includes(path)) this.queue = [path];
    if (location.hash === '#/open?path=' + enc(path)) this.routeOpen(path); else location.hash = '#/open?path=' + enc(path);
  },
  openAt(path, ann) { this.jump = {path, ann}; this.open(path); },
  takeJump(path) { const j = this.jump; if (j && j.path === path) { this.jump = null; return j.ann; } return null; },
  step(d) {
    const i = this.queue.indexOf(this.current?.path), n = i + d;
    if (i >= 0 && n >= 0 && n < this.queue.length) this.open(this.queue[n]);
  },
  async routeOpen(path) {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (!path) return this.go('#/');
    let rec;
    try { rec = await api('/api/library/open', {json: {path}}); }
    catch (e) { toast(e.message, true); return this.back(); }
    this.current = rec; document.title = rec.name + ' - Study Workspace';
    let v = rec.viewer;
    if (this.viewAs[rec.path] === 'code' && ['json', 'md', 'sql'].includes(v)) v = 'code';
    this.showPane(v); this.paintDocbar(rec, v);
    try { await Viewers[v](rec); } catch (e) { toast(e.message, true); }
  },
  paintDocbar(rec, v) {
    const i = this.queue.indexOf(rec.path), multi = this.queue.length > 1 && i >= 0;
    const canSwitch = ['json', 'md', 'sql'].includes(rec.viewer);
    $('#docbar').innerHTML =
      `<button class="icon-btn" id="dbBack" title="Back (Esc)" aria-label="Back">${icon('back')}</button>` +
      `<span class="name" title="${esc(rec.name)}">${esc(rec.name)}</span><span class="badge">${esc(rec.category)}</span>` +
      `<span class="path" title="${esc(rec.path)}">${esc(rec.path.replace(/[^/\\]+$/, ''))}</span>` +
      (multi ? `<button class="icon-btn" id="dbPrev" title="Previous file ( [ )" aria-label="Previous file" ${i === 0 ? 'disabled' : ''}>${icon('back')}</button><span class="badge">${i + 1} / ${this.queue.length}</span><button class="icon-btn" id="dbNext" title="Next file ( ] )" aria-label="Next file" ${i === this.queue.length - 1 ? 'disabled' : ''}>${icon('next')}</button>` : '') +
      `<button class="icon-btn" id="dbFull" title="Full screen" aria-label="Full screen">${icon('full')}</button>` +
      (canSwitch ? `<select id="dbView" title="How to display this file"><option value="auto">Default viewer</option><option value="code" ${v === 'code' ? 'selected' : ''}>Source code</option></select>` : '') +
      `<button class="icon-btn" id="dbOrg" title="Subject, tags, collections and revision" aria-label="Organize this file">${icon('tag')}</button>` +
      `<button class="icon-btn ${rec.favorite ? 'star-on' : ''}" id="dbStar" title="${rec.favorite ? 'Remove from favorites' : 'Add to favorites'}" aria-label="Toggle favorite">${icon(rec.favorite ? 'star-fill' : 'star')}</button>`;
    $('#dbBack').onclick = () => this.back();
    $('#dbFull').onclick = () => { const el = $('#v-' + v) || $('#main'); (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.())?.catch(() => toast('Full screen is not available in this browser.', true)); };
    $('#dbPrev')?.addEventListener('click', () => this.step(-1)); $('#dbNext')?.addEventListener('click', () => this.step(1));
    $('#dbView')?.addEventListener('change', e => { this.viewAs[rec.path] = e.target.value; this.routeOpen(rec.path); });
    $('#dbOrg').onclick = e => Study.organize(rec, e.currentTarget);
    $('#dbStar').onclick = async () => {
      try { const r = await api('/api/library/favorite', {json: {path: rec.path, value: !rec.favorite}}); Object.assign(rec, r); this.paintDocbar(rec, v); toast(r.favorite ? 'Added to favorites' : 'Removed from favorites'); }
      catch (e) { toast(e.message, true); }
    };
  },

  /* ------------------------------------------------ dashboard */
  async dashboard() {
    const page = $('#page'); page.innerHTML = '<div class="page"><span class="spin"></span></div>';
    let s, st = null;
    try { [s, st] = await Promise.all([api('/api/library/summary'), api('/api/study/summary').catch(() => null)]); }
    catch (e) { page.innerHTML = `<div class="page"><div class="empty"><h2>Cannot load the workspace</h2><p>${esc(e.message)}</p></div></div>`; return; }
    const pct = st && st.goal_minutes ? Math.min(100, Math.round(100 * st.today_minutes / st.goal_minutes)) : 0;
    page.innerHTML = `<div class="page dash">
      <h1>What would you like to study today?</h1>
      <p class="sub">Choose a category, or search your files, notes and annotations.</p>
      <div class="searchbox"><i data-icon="search"></i><input id="gsearch" data-search type="search" placeholder="Search files, notes, annotations   ( / )" autocomplete="off" aria-label="Search"><div class="results" id="gresults" hidden></div></div>
      <div class="cards">${s.categories.map(c => `<button class="card" data-cat="${c.id}">
        <span class="tile">${icon(c.icon)}</span><b>${esc(c.name)}</b><span class="desc">${esc(c.description)}</span>
        <span class="meta">${c.recent ? c.recent + ' recent' : 'No recent files'}${c.available ? '' : ' · opens in system app'}</span></button>`).join('')}</div>
      ${st ? `<a class="strip" href="#/planner"><div><b>${st.today_minutes}</b><span>of ${st.goal_minutes} min today</span><div class="bar"><i style="width:${pct}%"></i></div></div>
        <div><b>${st.streak}</b><span>day streak</span></div><div><b>${st.due_questions}</b><span>questions to review</span></div>
        <div><b>${st.todos_open}</b><span>open to-dos</span></div>${st.next_exam ? `<div><b>${esc(st.next_exam.name)}</b><span>${esc(st.next_exam.date)}</span></div>` : ''}</a>` : ''}
      ${s.pinned && s.pinned.length ? `<div class="sec-head"><h2>Pinned</h2></div><div class="rows">${s.pinned.map(r => this.rowHtml(r)).join('')}</div>` : ''}
      <div class="sec-head"><h2>Recently opened</h2><a href="#/recent">View all</a></div>
      ${s.recents.length ? `<div class="rows">${s.recents.map(r => this.rowHtml(r)).join('')}</div>` : `<div class="rows"><div class="noresult">Nothing yet. Pick a category above to open your first file.</div></div>`}
    </div>`;
    hydrateIcons(page);
    page.onclick = e => {
      const c = e.target.closest('.card'); if (c) return this.go(c.dataset.cat === 'recent' ? '#/recent' : '#/browse/' + c.dataset.cat);
      const hit = e.target.closest('[data-go]'); if (hit) { $('#gresults').hidden = true; return this.go(hit.dataset.go); }
      this.rowClick(e);
    };
    const input = $('#gsearch'), box = $('#gresults');
    const run = debounce(async () => {
      const q = input.value.trim(); if (q.length < 2) { box.hidden = true; return; }
      try {
        const [files, all] = await Promise.all([api('/api/library/search?q=' + enc(q)), api('/api/search?q=' + enc(q))]);
        const sec = (title, rows) => rows ? `<div class="res-h">${title}</div>${rows}` : '';
        const notes = (all.notes || []).map(n => `<div class="row" data-go="#/notes/${n.id}">${icon('note', 'kind')}<span class="nm">${esc(n.title || 'Untitled note')}</span><span class="where">${esc((n.body || '').replace(/\s+/g, ' ').slice(0, 80))}</span></div>`).join('');
        const anns = (all.annotations || []).map(a => `<div class="row ann-hit" data-path="${esc(a.file.path)}" data-ann="${a.id}" data-exists="${a.file.exists}">${icon(Ann.KIND_ICON[a.kind], 'kind')}<span class="nm">${esc((a.text || a.quote).slice(0, 70))}</span><span class="where">${esc(a.file.name)} · ${esc(Ann.where(a))}</span></div>`).join('');
        const snips = (all.snippets || []).map(n => `<div class="row" data-go="#/toolkit/snippets">${icon('code', 'kind')}<span class="nm">${esc(n.title || 'Snippet')}</span><span class="where">${esc(n.language)}</span></div>`).join('');
        const qs = (all.questions || []).map(n => `<div class="row" data-go="#/toolkit/practice">${icon('comment', 'kind')}<span class="nm">${esc(n.question.slice(0, 80))}</span></div>`).join('');
        const html = sec('Files', files.map(r => this.rowHtml(r, true)).join('')) + sec('Notes', notes) + sec('Annotations', anns) + sec('Snippets', snips) + sec('Practice questions', qs);
        box.innerHTML = html || '<div class="noresult">No matches.</div>'; box.hidden = false;
        $$('.ann-hit', box).forEach(el => el.onclick = e => { e.stopPropagation(); const a = all.annotations.find(x => x.id === el.dataset.ann); if (el.dataset.exists === 'false') return toast('This file no longer exists.', true); box.hidden = true; this.openAt(a.file.path, a); });
      } catch (er) { toast(er.message, true); }
    }, 220);
    input.oninput = run;
    input.onkeydown = e => { if (e.key === 'Enter') { const r = box.querySelector('.row:not(.missing)'); if (r) r.click(); } if (e.key === 'Escape') { box.hidden = true; input.blur(); } };
  },
  rowHtml(r, search) {
    const dir = r.path.replace(/[/\\][^/\\]+$/, '');
    return `<div class="row${r.exists === false ? ' missing' : ''}" data-path="${esc(r.path)}" data-exists="${r.exists !== false}" tabindex="0">
      ${icon(fileIcon(r.category), 'kind')}<span class="nm">${esc(r.name)}</span><span class="where" title="${esc(dir)}">${esc(dir)}</span>
      ${r.exists === false ? '<span class="badge">missing</span>' : (search ? `<span class="badge">${esc(r.category)}</span>` : `<span class="when">${r.last_opened ? timeAgo(r.last_opened) : ''}</span>`)}
      ${r.favorite ? `<span class="star-on" title="Favorite">${icon('star-fill')}</span>` : ''}</div>`;
  },
  rowClick(e) {
    const row = e.target.closest('.row'); if (!row || !row.dataset.path) return;
    if (row.dataset.exists === 'false') return toast('This file no longer exists at its old location.', true);
    const rows = $$('.row[data-path]', row.parentElement).filter(r => r.dataset.exists !== 'false').map(r => r.dataset.path);
    this.open(row.dataset.path, rows);
  },

  /* ------------------------------------------------ recent / favourites */
  async listPage(kind) {
    const page = $('#page'); page.innerHTML = '<div class="page"><span class="spin"></span></div>';
    let items;
    try { items = await api('/api/library/' + kind); } catch (e) { page.innerHTML = `<div class="page"><div class="empty"><h2>Something went wrong</h2><p>${esc(e.message)}</p></div></div>`; return; }
    const title = kind === 'recent' ? 'Recent files' : 'Favorites';
    let cat = 'all';
    const paint = () => {
      const list = items.filter(i => cat === 'all' || i.category === cat);
      const cats = [...new Set(items.map(i => i.category))];
      page.innerHTML = `<div class="page"><div class="page-title"><h1>${title}</h1><span class="spacer"></span>
        ${kind === 'recent' && items.length ? `<button class="btn danger" id="clearBtn">${icon('trash')}Clear history</button>` : ''}</div>
        ${cats.length > 1 ? `<div class="chips" style="padding:0 0 12px">${['all', ...cats].map(c => `<button class="chip${c === cat ? ' on' : ''}" data-c="${c}">${c === 'all' ? 'All' : esc(c)}</button>`).join('')}</div>` : ''}
        ${list.length ? `<div class="rows">${list.map(r => this.rowHtml(r)).join('')}</div>` :
          `<div class="empty"><h2>${kind === 'recent' ? 'No recent files' : 'No favorites yet'}</h2><p>${kind === 'recent' ? 'Files you open will appear here.' : 'Open a file and click the star in the top bar to keep it here.'}</p><a class="btn primary" href="#/">Choose a category</a></div>`}</div>`;
      $('#clearBtn') && ($('#clearBtn').onclick = async () => {
        if (!await UI.confirm('Your files are not deleted, and favorites are kept.', {title: 'Clear recent history?', confirm: 'Clear history', danger: true})) return;
        try { await api('/api/library/forget', {json: {}}); items = items.filter(i => i.favorite).map(i => ({...i, last_opened: null})); if (kind === 'recent') items = []; paint(); toast('History cleared'); } catch (e) { toast(e.message, true); }
      });
      $$('.chip', page).forEach(c => c.onclick = () => { cat = c.dataset.c; paint(); });
      page.onclick = e => this.rowClick(e);
    };
    paint();
  },

  /* ------------------------------------------------ annotations overview (all files) */
  async annotationsPage(rest = []) {
    const page = $('#page'); page.innerHTML = '<div class="page"><span class="spin"></span></div>';
    const st = this.annState ||= {q: '', kind: 'all', cat: '', group: 'file'};
    st.kind = rest[0] === 'bookmarks' ? 'bookmarks' : 'all';        // arriving from Bookmarks or Annotations in the sidebar
    let items = [];
    const shown = () => items.filter(a => st.kind === 'all' || Ann.group(a) === st.kind);
    const paint = () => {
      const filt = shown(), groups = new Map();
      for (const a of filt) {
        const key = st.group === 'file' ? a.file.name : st.group === 'category' ? Ann.name(a.category) : st.group === 'date' ? fmtDate(a.created) : 'All annotations';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(a);
      }
      $('#annBody').innerHTML = filt.length ? [...groups].map(([k, list]) => `<div class="sec-head" style="margin:22px 0 8px"><h2>${esc(k)}</h2><span class="badge">${list.length}</span></div><div class="rows">${list.map(a => `
        <div class="row ann-row${a.file.exists ? '' : ' missing'}" data-id="${a.id}" style="align-items:flex-start;--ac:${Ann.color(a.category)};border-left:4px solid var(--ac)">
          <span style="color:var(--ac);padding-top:2px">${icon(Ann.KIND_ICON[a.kind])}</span>
          <div style="flex:1;min-width:0"><div style="color:var(--fg2);font-size:12.5px">${st.group !== 'file' ? esc(a.file.name) + ' · ' : ''}<b style="color:var(--fg)">${esc(Ann.where(a))}</b> · ${esc(Ann.name(a.category))} · ${timeAgo(a.created)}${a.file.exists ? '' : ' · file missing'}</div>
          ${a.quote ? `<div class="ap-quote">${esc(a.quote)}</div>` : ''}${a.text ? `<div class="ap-text">${esc(a.text)}</div>` : ''}</div></div>`).join('')}</div>`).join('')
        : '<div class="empty"><h2>No annotations found</h2><p>Highlight text in a PDF, or select lines in a code file, to start building your study notes.</p></div>';
      $('#annCount').textContent = filt.length + ' annotation' + (filt.length === 1 ? '' : 's');
    };
    const load = async () => {
      try { items = (await api('/api/annotations/all?' + new URLSearchParams({q: st.q, category: st.cat}))).items; paint(); } catch (e) { toast(e.message, true); }
    };
    page.innerHTML = `<div class="page"><div class="page-title"><h1>Annotations</h1><span class="badge" id="annCount"></span><span class="spacer"></span>
        <button class="btn" id="annMd">${icon('download')}Markdown</button><button class="btn" id="annJson">${icon('download')}JSON</button></div>
      <div class="btools" style="padding:0 0 10px"><input id="annQ" data-search type="search" placeholder="Search comments, quotes and file names   ( / )" style="flex:1;min-width:220px" value="${esc(st.q)}">
        <select id="annGroup" aria-label="Group by"><option value="file">Group by file</option><option value="category">Group by category</option><option value="date">Group by date</option><option value="none">No grouping</option></select></div>
      <div class="chips" style="padding:0 0 4px">${[['all', 'All'], ['marks', 'Marks'], ['comments', 'Comments'], ['bookmarks', 'Bookmarks']].map(([k, n]) => `<button class="chip${st.kind === k ? ' on' : ''}" data-k="${k}">${n}</button>`).join('')}<span class="sepv"></span><span id="annCats">${Ann.catDots(st.cat, 'data-c')}</span></div>
      <div id="annBody"></div></div>`;
    $('#annGroup').value = st.group;
    page.onclick = e => {
      const chip = e.target.closest('.chip[data-k]');
      if (chip) { st.kind = chip.dataset.k; $$('.chip[data-k]', page).forEach(c => c.classList.toggle('on', c === chip)); return paint(); }
      const dot = e.target.closest('.cdot[data-c]');
      if (dot) { st.cat = st.cat === dot.dataset.c ? '' : dot.dataset.c; $('#annCats').innerHTML = Ann.catDots(st.cat, 'data-c'); return load(); }
      const row = e.target.closest('.ann-row'); if (!row) return;
      const a = items.find(x => x.id === row.dataset.id);
      if (!a.file.exists) return toast('This file no longer exists at its old location.', true);
      this.openAt(a.file.path, a);
    };
    $('#annQ').oninput = debounce(e => { st.q = e.target.value.trim(); load(); }, 250);
    $('#annGroup').onchange = e => { st.group = e.target.value; paint(); };
    $('#annMd').onclick = () => {
      if (!shown().length) return toast('Nothing to export yet');
      download('annotations.md', '# Annotations\n\n' + shown().map(a => `## ${a.file.name} · ${Ann.where(a)}\n\n` + Ann.markdown([a], '').split('\n\n').slice(2).join('\n\n')).join('\n'), 'text/markdown');
    };
    $('#annJson').onclick = () => shown().length ? download('annotations.json', JSON.stringify(shown(), null, 2), 'application/json') : toast('Nothing to export yet');
    await load();
  },

  /* ------------------------------------------------ category file browser */
  async browse(catId, path) {
    const cats = (this._cats ||= (await api('/api/library/summary')).categories);
    const cat = cats.find(c => c.id === catId);
    if (!cat || catId === 'recent') return this.go('#/');
    const meta = {multi: ['code', 'pdf', 'text', 'word', 'slides', 'images'].includes(catId)};
    if (!this.bs || this.bs.cat !== catId) this.bs = {cat: catId, q: '', sort: 'name', order: 'asc', ext: null, sel: new Set(), active: null, data: null};
    const bs = this.bs; bs.multi = meta.multi;
    path = path || store.get('lastDir:' + catId, '');
    const page = $('#page');
    page.innerHTML = `<div class="page wide">
      <div class="bhead"><h1>${icon(cat.icon)}${esc(cat.name)}</h1><span class="spacer"></span>
        <button class="btn" id="nativeBtn" title="Use your operating system's file chooser">${icon('external')}Choose from computer…</button></div>
      <div class="btools"><div class="crumbs" id="crumbs"></div>
        <input id="bq" data-search type="search" placeholder="Search in this folder   ( / )" style="width:230px" aria-label="Search in this folder">
        <select id="bsort" aria-label="Sort by"><option value="name">Sort: Name</option><option value="date">Sort: Date modified</option><option value="size">Sort: Size</option></select>
        <button class="icon-btn" id="border" title="Reverse sort order" aria-label="Reverse sort order"></button></div>
      <div class="chips" id="bchips"></div>
      <div class="bsplit"><div class="blist" id="blist"></div><aside class="bprev" id="bprev"><div class="noresult">Select a file to preview it.</div></aside></div>
      <div class="bfoot"><span class="info" id="binfo"></span><button class="btn primary" id="bopen" disabled>${icon('check')}Open File</button></div></div>`;
    hydrateIcons(page);
    $('#bq').value = bs.q; $('#bsort').value = bs.sort; $('#border').innerHTML = icon(bs.order === 'asc' ? 'asc' : 'desc');
    $('#bq').oninput = debounce(e => { bs.q = e.target.value; this.loadDir(bs.data?.path); }, 200);
    $('#bsort').onchange = e => { bs.sort = e.target.value; this.loadDir(bs.data?.path); };
    $('#border').onclick = () => { bs.order = bs.order === 'asc' ? 'desc' : 'asc'; $('#border').innerHTML = icon(bs.order === 'asc' ? 'asc' : 'desc'); this.loadDir(bs.data?.path); };
    $('#bopen').onclick = () => this.openSelection();
    $('#nativeBtn').onclick = () => this.nativePick(catId, meta.multi);
    $('#blist').onclick = e => this.browserClick(e);
    $('#blist').ondblclick = e => { const r = e.target.closest('tr[data-path]'); if (r) { if (r.dataset.dir) this.go('#/browse/' + catId + '?path=' + enc(r.dataset.path)); else this.openSelection(r.dataset.path); } };
    $('#bchips').onclick = e => { const c = e.target.closest('.chip'); if (c) { bs.ext = c.dataset.e || null; this.paintList(); } };
    $('#crumbs').onclick = e => { const b = e.target.closest('button'); if (b) this.go('#/browse/' + catId + '?path=' + enc(b.dataset.p)); };
    await this.loadDir(path);
  },
  async loadDir(path) {
    const bs = this.bs;
    try {
      const qs = new URLSearchParams({path: path || '', category: bs.cat, q: bs.q, sort: bs.sort, order: bs.order});
      bs.data = await api('/api/fs/list?' + qs);
    } catch (e) {
      if (path) { store.set('lastDir:' + bs.cat, ''); toast(e.message, true); return this.go('#/browse/' + bs.cat); }
      $('#blist').innerHTML = `<div class="empty"><h2>Cannot open this folder</h2><p>${esc(e.message)}</p></div>`; return;
    }
    store.set('lastDir:' + bs.cat, bs.data.path);
    const ph = '#/browse/' + bs.cat + '?path=' + enc(bs.data.path);
    if (location.hash !== ph && !location.hash.startsWith('#/open')) history.replaceState(null, '', ph);
    this.lastPage = ph;
    bs.sel = new Set([...bs.sel].filter(p => bs.data.files.some(f => f.path === p)));
    if (!bs.data.files.some(f => f.path === bs.active)) bs.active = null;
    $('#crumbs').innerHTML = bs.data.crumbs.map((c, i) => (i ? '<span class="sep">/</span>' : '') + `<button data-p="${esc(c.path)}">${esc(c.name)}</button>`).join('');
    this.paintList(); this.paintPreview();
  },
  visibleFiles() { const bs = this.bs; return bs.data.files.filter(f => !bs.ext || f.ext === bs.ext); },
  paintList() {
    const bs = this.bs, d = bs.data, files = this.visibleFiles();
    const counts = {}; d.files.forEach(f => counts[f.ext] = (counts[f.ext] || 0) + 1);
    const exts = Object.keys(counts).sort();
    $('#bchips').innerHTML = exts.length > 1 ? `<button class="chip${bs.ext ? '' : ' on'}">All types</button>` + exts.map(e => `<button class="chip${bs.ext === e ? ' on' : ''}" data-e="${e}">${e}<small style="opacity:.7;margin-left:4px">${counts[e]}</small></button>`).join('') : '';
    const up = d.parent ? `<tr class="f dir" data-path="${esc(d.parent)}" data-dir="1"><td></td><td class="name" colspan="4">${icon('up')}..</td></tr>` : '';
    const rowsD = d.dirs.map(x => `<tr class="f dir" data-path="${esc(x.path)}" data-dir="1"><td></td><td class="name">${icon('folder')}${esc(x.name)}</td><td class="ex"></td><td class="sz"></td><td class="dt">${fmtDate(x.mtime)}</td></tr>`).join('');
    const rowsF = files.map(f => `<tr class="f${bs.active === f.path ? ' active' : ''}" data-path="${esc(f.path)}">
      <td>${bs.multi ? `<input type="checkbox" aria-label="Select ${esc(f.name)}" ${bs.sel.has(f.path) ? 'checked' : ''}>` : ''}</td>
      <td class="name" title="${esc(f.name)}">${icon(fileIcon(f.category))}${esc(f.name)}</td><td class="ex">${esc(f.ext.slice(1))}</td><td class="sz">${fmtSize(f.size)}</td><td class="dt">${fmtDate(f.mtime)}</td></tr>`).join('');
    $('#blist').innerHTML = `<table class="files"><thead><tr><th style="width:36px"></th><th>Name</th><th>Type</th><th>Size</th><th>Modified</th></tr></thead><tbody>${up}${rowsD}${rowsF}</tbody></table>` +
      (!d.dirs.length && !files.length ? `<div class="empty"><h2>${bs.q ? 'No matching files' : 'No supported files here'}</h2><p>${bs.q ? 'Try a different search.' : 'Open a sub-folder, go up, or use “Choose from computer…”.'}</p></div>` : '') +
      (d.truncated ? '<div class="noresult">Showing the first 3000 files. Use search to narrow down.</div>' : '');
    $$('th', $('#blist')).forEach((th, i) => { const k = ['', 'name', '', 'size', 'date'][i]; if (k) th.onclick = () => { if (bs.sort === k) bs.order = bs.order === 'asc' ? 'desc' : 'asc'; else { bs.sort = k; bs.order = 'asc'; } $('#bsort').value = k; $('#border').innerHTML = icon(bs.order === 'asc' ? 'asc' : 'desc'); this.loadDir(d.path); }; });
    this.paintFoot();
  },
  paintFoot() {
    const bs = this.bs, n = bs.sel.size, btn = $('#bopen');
    const total = this.visibleFiles().length;
    $('#binfo').textContent = n ? `${n} file${n > 1 ? 's' : ''} selected` : bs.active ? '1 file highlighted' : `${total} file${total === 1 ? '' : 's'} in this folder`;
    btn.disabled = !(n || bs.active); btn.lastChild.textContent = n > 1 ? `Open ${n} Files` : 'Open File';
  },
  browserClick(e) {
    const bs = this.bs, tr = e.target.closest('tr[data-path]'); if (!tr) return;
    if (tr.dataset.dir) return this.go('#/browse/' + bs.cat + '?path=' + enc(tr.dataset.path));
    const path = tr.dataset.path, cb = e.target.closest('input[type=checkbox]');
    if (cb) { cb.checked ? bs.sel.add(path) : bs.sel.delete(path); }
    else if (!bs.multi) { bs.sel = new Set([path]); }
    else if (e.metaKey || e.ctrlKey) { bs.sel.has(path) ? bs.sel.delete(path) : bs.sel.add(path); }
    bs.active = path; this.paintList(); this.paintPreview();
  },
  async paintPreview() {
    const bs = this.bs, box = $('#bprev'); if (!box) return;
    if (!bs.active) { box.innerHTML = '<div class="noresult">Select a file to preview it.</div>'; return; }
    const path = bs.active; box.innerHTML = '<span class="spin"></span>';
    try {
      const r = await api('/api/fs/preview?path=' + enc(path));
      if (bs.active !== path) return;
      const i = r.info, p = r.preview;
      let body = '';
      if (p.kind === 'code') body = `<div class="badge accent" style="margin-bottom:8px">${esc(p.language)}</div><div class="pcode hl">${p.lines.map((l, n) => `<div><span class="n">${n + 1}</span>${l || ' '}</div>`).join('')}</div>`;
      else if (p.kind === 'image') body = `<img src="${p.url}" alt="Preview of ${esc(i.name)}">`;
      else if (p.kind === 'list') body = `<b style="font-size:12.5px">${p.title}</b><ul>${p.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
      else body = '<div class="noresult">No preview available for this file type.</div>';
      box.innerHTML = `<h3>${esc(i.name)}</h3><div class="facts">${fmtSize(i.size)} · modified ${fmtDate(i.mtime)}</div>${body}`;
    } catch (e) { box.innerHTML = `<div class="noresult">${esc(e.message)}</div>`; }
  },
  openSelection(single) {
    const bs = this.bs, vis = this.visibleFiles().map(f => f.path);
    let paths = single ? [single] : bs.sel.size ? vis.filter(p => bs.sel.has(p)) : bs.active ? [bs.active] : [];
    if (!paths.length) return toast('Select a file first.', true);
    this.open(paths[0], paths.length > 1 ? paths : vis);
  },
  async nativePick(catId, multi) {
    const btn = $('#nativeBtn'); btn.disabled = true;
    try {
      const r = await api('/api/fs/native', {json: {mode: multi ? 'files' : 'file', category: catId}});
      if (r.skipped) toast(r.skipped + ' file(s) skipped: outside your home folder.', true);
      if (r.paths.length) this.open(r.paths[0], r.paths.length > 1 ? r.paths : undefined);
    } catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
  },

  /* ------------------------------------------------ settings */
  async settings() {
    const page = $('#page'); const s = await api('/api/settings').catch(e => { toast(e.message, true); return {effective_start_folder: ''}; });
    page.innerHTML = `<div class="page"><div class="page-title"><h1>Settings</h1></div>
      <div class="set-sec"><h2>Appearance</h2><div class="set-row"><div class="lbl">Theme<small>System follows your operating system.</small></div>
        <div class="seg" id="themeSeg">${['system', 'light', 'dark'].map(t => `<button data-t="${t}" class="${Theme.pref() === t ? 'active' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div></div>
      <div class="set-sec"><h2>Files</h2>
        <div class="set-row"><div class="lbl">Start folder<small>Where the file browser opens the first time.</small></div>
          <input id="startIn" aria-label="Start folder" type="text" style="width:300px" value="${esc(s.effective_start_folder)}" spellcheck="false"><button class="btn" id="startPick">Choose…</button><button class="btn primary" id="startSave">Save</button></div>
        <div class="set-row"><div class="lbl">Daily study goal<small>Minutes per day, used by the planner and dashboard.</small></div>
          <input id="goalIn" aria-label="Daily goal in minutes" type="number" min="0" max="1440" style="width:90px" value="${s.daily_goal_minutes ?? 60}"><span>min</span></div>
        <div class="set-row"><div class="lbl">Pomodoro timer<small>Focus, short break and long break lengths in minutes.</small></div>
          <input id="pFocus" aria-label="Focus minutes" type="number" min="1" max="180" style="width:70px" value="${s.pomo_focus ?? 25}"><input id="pShort" aria-label="Short break minutes" type="number" min="1" max="60" style="width:70px" value="${s.pomo_short ?? 5}"><input id="pLong" aria-label="Long break minutes" type="number" min="1" max="120" style="width:70px" value="${s.pomo_long ?? 15}">
          <button class="btn primary" id="planSave">Save</button></div>
        <div class="set-row"><div class="lbl">Recent history<small>Removes the list of recently opened files. Files themselves are never touched.</small></div><button class="btn danger" id="clearHist">Clear history</button></div></div>
      <div class="set-sec"><h2>Backup and restore</h2>
        <div class="set-row"><div class="lbl">Back up your study data<small>Notes, annotations, planner, practice questions, tags and collections as one JSON file. Your original files are not included.</small></div><a class="btn" href="/api/backup" download>Download backup</a></div>
        <div class="set-row"><div class="lbl">Restore from a backup<small>Merges the backup into what you already have. Nothing is deleted, and restoring twice does not create duplicates.</small></div><input id="restoreFile" type="file" accept=".json,application/json" hidden><button class="btn" id="restoreBtn">Choose a backup file…</button></div></div>
      <div class="set-sec"><h2>Keyboard shortcuts</h2><table class="keys" style="width:100%;border-collapse:collapse">
        ${[['Ctrl/⌘ + K', 'Command palette: jump anywhere, run actions, search everything'], ['/', 'Focus the search box'], ['Esc', 'Go back from a document'], ['[  and  ]', 'Previous / next file in the current selection'], ['Ctrl/⌘ + B', 'Collapse the navigation'], ['Ctrl/⌘ + F', 'Search inside JSON and code files'], ['Ctrl/⌘ + G', 'Go to line (code)'], ['↑ ↓  Enter', 'Move and open in the file browser']].map(([k, d]) => `<tr><td><kbd>${k}</kbd></td><td>${d}</td></tr>`).join('')}</table></div></div>`;
    $('#themeSeg').onclick = e => { const b = e.target.closest('button'); if (!b) return; Theme.set(b.dataset.t); $$('#themeSeg button').forEach(x => x.classList.toggle('active', x === b)); };
    $('#startSave').onclick = async () => { try { await api('/api/settings', {method: 'PUT', json: {start_folder: $('#startIn').value.trim()}}); this._cats = null; store.set('lastDir:code', ''); toast('Start folder saved'); } catch (e) { toast(e.message, true); } };
    $('#startPick').onclick = async () => { try { const r = await api('/api/fs/native', {json: {mode: 'folder'}}); if (r.paths[0]) $('#startIn').value = r.paths[0]; } catch (e) { toast(e.message, true); } };
    $('#restoreBtn').onclick = () => $('#restoreFile').click();
    $('#restoreFile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return; e.target.value = '';
      if (!await UI.confirm('Nothing will be deleted. Items you already have are skipped.', {title: `Merge “${f.name}” into your study data?`, confirm: 'Merge'})) return;
      try { const r = await api('/api/backup/restore', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: await f.text()}); const n = Object.values(r.added).reduce((a, b) => a + b, 0); toast(n ? `Restored ${n} items` : 'Everything in that backup was already here'); Study._subjects = null; }
      catch (er) { toast(er.message, true); }
    };
    $('#planSave').onclick = async () => { try { await api('/api/settings', {method: 'PUT', json: {daily_goal_minutes: $('#goalIn').value, pomo_focus: $('#pFocus').value, pomo_short: $('#pShort').value, pomo_long: $('#pLong').value}}); toast('Planner settings saved'); if (window.Pomodoro) Pomodoro.reload(); } catch (e) { toast(e.message, true); } };
    $('#clearHist').onclick = async () => { if (await UI.confirm('Your files are not deleted, and favorites are kept.', {title: 'Clear recent history?', confirm: 'Clear history', danger: true})) { try { await api('/api/library/forget', {json: {}}); toast('History cleared'); } catch (e) { toast(e.message, true); } } };
  },

  /* ------------------------------------------------ keyboard */
  keys(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); return this.toggleNav(); }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const inDoc = location.hash.startsWith('#/open');
    if (e.key === 'Escape') {
      const r = $('#gresults'); if (r && !r.hidden) { r.hidden = true; return; }
      if (inDoc && !typing() && !$('.cmt.edit')) this.back(); return;
    }
    if (typing()) return;
    if (e.key === '/') { const s = $$('input[data-search]').find(i => i.offsetParent); if (s) { e.preventDefault(); s.focus(); } }
    else if (inDoc && e.key === '[') this.step(-1);
    else if (inDoc && e.key === ']') this.step(1);
    else if (!inDoc && this.bs && $('#blist') && !$('#page').hidden && location.hash.startsWith('#/browse')) {
      const files = this.visibleFiles(), bs = this.bs, i = files.findIndex(f => f.path === bs.active);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const f = files[Math.max(0, Math.min(files.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]; if (f) { bs.active = f.path; if (!bs.multi || !bs.sel.size) bs.sel = new Set([f.path]); this.paintList(); this.paintPreview(); $('tr.active', $('#blist'))?.scrollIntoView({block: 'nearest'}); } }
      else if (e.key === 'Enter') this.openSelection();
      else if (e.key === ' ' && bs.multi && bs.active) { e.preventDefault(); bs.sel.has(bs.active) ? bs.sel.delete(bs.active) : bs.sel.add(bs.active); this.paintList(); }
    }
  },
};

/* Files that have no built-in viewer yet are handed to the operating system. */
Viewers.external = rec => {
  $('#extBox').innerHTML = `<div class="ext-card">${icon(fileIcon(rec.category), 'ic-lg')}<h2>${esc(rec.name)}</h2>
    <p>${fmtSize(rec.size)} · ${esc(rec.category)}. A built-in viewer for this file type is planned for the next phase. For now you can open it with your system's default app.</p>
    <div class="actions"><button class="btn primary" id="extOpen">${icon('external')}Open with system app</button><button class="btn" id="extReveal">${icon('folder')}Show in folder</button></div></div>`;
  const call = action => api('/api/fs/external', {json: {path: rec.path, action}}).catch(e => toast(e.message, true));
  $('#extOpen').onclick = () => call('open'); $('#extReveal').onclick = () => call('reveal');
};
