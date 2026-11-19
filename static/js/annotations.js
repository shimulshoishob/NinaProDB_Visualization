/* Shared annotation helpers and the annotations panel used by the PDF and code viewers. */
const Ann = {
  CATS: window.ANN_CATS || {},
  color: cat => (Ann.CATS[cat] || Ann.CATS.general || {color: '#e3b800'}).color,
  name: cat => (Ann.CATS[cat] || {name: cat}).name,
  KIND_ICON: {highlight: 'highlighter', underline: 'underline', strikeout: 'strike', comment: 'comment', note: 'note', bookmark: 'bookmark', drawing: 'pen'},
  KIND_NAME: {highlight: 'Highlight', underline: 'Underline', strikeout: 'Strikethrough', comment: 'Comment', note: 'Note', bookmark: 'Bookmark', drawing: 'Drawing'},
  list: path => api('/api/annotations?path=' + encodeURIComponent(path)),
  create: (path, body) => api('/api/annotations', {json: {path, ...body}}),
  update: (id, body) => api('/api/annotations/' + id, {method: 'PATCH', json: body}),
  remove: id => api('/api/annotations/' + id, {method: 'DELETE'}),
  where(a) { const l = a.locator || {}; if (l.page) return 'p. ' + l.page; if (l.start) return l.start === l.end ? 'line ' + l.start : `lines ${l.start}–${l.end}`; return ''; },
  pos(a) { const l = a.locator || {}; return (l.page || l.start || 0) * 100000 - (l.rects?.[0]?.[3] || l.points?.[0]?.[0]?.[1] || 0); },
  // anything with your own words counts as a comment, whatever its style
  group: a => a.kind === 'bookmark' ? 'bookmarks' : (a.text || a.kind === 'comment' || a.kind === 'note') ? 'comments' : 'marks',

  catDots(current, attr = 'data-cat') {
    return Object.entries(Ann.CATS).map(([k, c]) => `<button class="cdot${k === current ? ' on' : ''}" ${attr}="${k}" style="--c:${c.color}" title="${esc(c.name)}" aria-label="${esc(c.name)}"></button>`).join('');
  },

  markdown(items, title) {
    let md = `# ${title}\n\n_Exported ${new Date().toLocaleString()}_\n\n`;
    for (const a of items) {
      md += `## ${Ann.KIND_NAME[a.kind]} · ${Ann.where(a)} · ${Ann.name(a.category)}\n\n`;
      if (a.quote) md += a.quote.split('\n').map(l => '> ' + l).join('\n') + '\n\n';
      if (a.text) md += a.text + '\n\n';
    }
    return md;
  },

  /* panel: Ann.panel(rootEl, {title, getItems, onJump, onEdit, onDelete, fileName}) -> {render} */
  panel(root, cfg) {
    const st = {q: '', kind: 'all', cat: '', sort: 'pos'};
    root.classList.add('ap');
    root.innerHTML = `<div class="ap-head"><b>${esc(cfg.title || 'Annotations')}</b><span class="badge" data-ap="count">0</span><span class="spacer"></span>
        <button class="btn ghost" data-ap="md" title="Export as Markdown">.md</button><button class="btn ghost" data-ap="json" title="Export as JSON">.json</button></div>
      <div class="ap-tools"><input type="search" data-ap="q" placeholder="Search notes" aria-label="Search annotations">
        <select data-ap="sort" aria-label="Sort"><option value="pos">By position</option><option value="date">Newest first</option><option value="cat">By category</option></select></div>
      <div class="ap-chips" data-ap="chips"></div><div class="ap-list" data-ap="list"></div>`;
    const q = s => root.querySelector(`[data-ap="${s}"]`);
    const filtered = () => cfg.getItems().filter(a => (st.kind === 'all' || Ann.group(a) === st.kind) && (!st.cat || a.category === st.cat) &&
      (!st.q || (a.text + ' ' + a.quote).toLowerCase().includes(st.q.toLowerCase())))
      .sort(st.sort === 'date' ? (a, b) => b.created - a.created : st.sort === 'cat' ? (a, b) => a.category.localeCompare(b.category) || Ann.pos(a) - Ann.pos(b) : (a, b) => Ann.pos(a) - Ann.pos(b));
    function render() {
      const all = cfg.getItems(), items = filtered(); q('count').textContent = all.length;
      const kinds = [['all', 'All'], ['marks', 'Marks'], ['comments', 'Comments'], ['bookmarks', 'Bookmarks']];
      q('chips').innerHTML = kinds.map(([k, n]) => `<button class="chip${st.kind === k ? ' on' : ''}" data-k="${k}">${n}</button>`).join('') + '<span class="sepv"></span>' + Ann.catDots(st.cat, 'data-c');
      q('list').innerHTML = items.length ? items.map(a => `<div class="ap-item" data-id="${a.id}" style="--ac:${Ann.color(a.category)}" tabindex="0">
          <div class="ap-top">${icon(Ann.KIND_ICON[a.kind])}<span class="ap-where">${esc(Ann.where(a))}</span><span class="ap-cat">${esc(Ann.name(a.category))}</span><span class="spacer"></span>
            <button class="icon-btn" data-a="edit" title="Edit" aria-label="Edit annotation">${icon('edit')}</button><button class="icon-btn" data-a="del" title="Delete" aria-label="Delete annotation">${icon('trash')}</button></div>
          ${a.quote ? `<div class="ap-quote">${esc(a.quote)}</div>` : ''}${a.text ? `<div class="ap-text">${esc(a.text)}</div>` : ''}
          <div class="ap-date">${timeAgo(a.created)}</div></div>`).join('')
        : `<div class="noresult">${all.length ? 'Nothing matches these filters.' : 'No annotations yet.'}</div>`;
    }
    root.addEventListener('click', e => {
      const chip = e.target.closest('.chip[data-k]'); if (chip) { st.kind = chip.dataset.k; return render(); }
      const dot = e.target.closest('.cdot[data-c]'); if (dot) { st.cat = st.cat === dot.dataset.c ? '' : dot.dataset.c; return render(); }
      const item = e.target.closest('.ap-item'); if (!item) return;
      const a = cfg.getItems().find(x => x.id === item.dataset.id); if (!a) return;
      const act = e.target.closest('[data-a]')?.dataset.a;
      if (act === 'del') cfg.onDelete(a); else if (act === 'edit') cfg.onEdit(a); else cfg.onJump(a);
    });
    q('q').oninput = debounce(e => { st.q = e.target.value; render(); }, 150);
    q('sort').onchange = e => { st.sort = e.target.value; render(); };
    q('md').onclick = () => { const it = filtered(); it.length ? download((cfg.fileName() || 'annotations') + '.annotations.md', Ann.markdown(it, 'Annotations: ' + (cfg.fileName() || '')), 'text/markdown') : toast('Nothing to export yet'); };
    q('json').onclick = () => { const it = filtered(); it.length ? download((cfg.fileName() || 'annotations') + '.annotations.json', JSON.stringify({file: cfg.fileName(), annotations: it}, null, 2), 'application/json') : toast('Nothing to export yet'); };
    return {render};
  },
};
