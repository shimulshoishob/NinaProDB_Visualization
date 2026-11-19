/* Command palette (Ctrl/Cmd+K): jump to any page, run common actions, search files, notes and annotations. */
const Palette = {
  el: null, items: [], idx: 0,
  commands() {
    const go = (name, hash) => ({name, hint: 'Go to', run: () => App.go(hash)});
    return [
      go('Dashboard', '#/'), go('Recent files', '#/recent'), go('Library', '#/library/modified'), go('Library: collections', '#/library/collections'), go('Library: tags', '#/library/tags'),
      go('Subjects', '#/subjects'), go('Notes', '#/notes'), go('Annotations', '#/annotations'), go('Bookmarks', '#/annotations/bookmarks'), go('Favorites', '#/library/favorites'), go('Planner: today', '#/planner'), go('Planner: to-do', '#/planner/todo'),
      go('Planner: revision', '#/planner/revision'), go('Planner: exams', '#/planner/exams'), go('Toolkit: algorithm visualizer', '#/toolkit/visualizer'), go('Toolkit: dry-run table', '#/toolkit/dryrun'),
      go('Toolkit: complexity reference', '#/toolkit/complexity'), go('Toolkit: data structures', '#/toolkit/structures'), go('Toolkit: concepts', '#/toolkit/concepts'),
      go('Toolkit: snippets', '#/toolkit/snippets'), go('Toolkit: practice questions', '#/toolkit/practice'), go('Settings', '#/settings'),
      ...['code', 'pdf', 'text', 'word', 'slides', 'images', 'data'].map(c => ({name: 'Browse ' + c + ' files', hint: 'Open', run: () => App.go('#/browse/' + c)})),
      {name: 'New note', hint: 'Action', run: async () => { const n = await SA.add('notes', {title: '', body: ''}); App.go('#/notes/' + n.id); }},
      {name: window.Pomodoro && Pomodoro.running() ? 'Pause focus timer' : 'Start focus timer', hint: 'Action', run: () => { Pomodoro.running() ? Pomodoro.pause() : Pomodoro.start(); toast(Pomodoro.running() ? 'Focus timer started' : 'Focus timer paused'); }},
      {name: 'Toggle light / dark theme', hint: 'Action', run: () => Theme.toggle()},
      {name: 'Toggle navigation', hint: 'Action', run: () => App.toggleNav()},
      {name: 'Download a backup of my study data', hint: 'Action', run: () => { location.href = '/api/backup'; }},
    ];
  },
  open() {
    if (this.el) return this.close();
    const el = this.el = document.createElement('div'); el.className = 'palette-back';
    el.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="Command palette"><input id="palQ" type="text" placeholder="Type a command, or search files, notes and annotations…" aria-label="Command palette search" autocomplete="off" spellcheck="false"><div id="palList" role="listbox"></div><div class="pal-foot"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>Enter</kbd> run <kbd>Esc</kbd> close</div></div>`;
    document.body.appendChild(el); this.prev = document.activeElement;
    const input = $('#palQ'); input.focus(); this.all = this.commands(); this.extra = []; this.render('');
    input.oninput = () => { this.render(input.value); this.search(input.value); };
    input.onkeydown = e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); this.move(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); this.move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); this.run(this.idx); } else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    };
    el.onclick = e => { if (e.target === el) this.close(); const it = e.target.closest('.pal-item'); if (it) this.run(+it.dataset.i); };
  },
  close() { this.el?.remove(); this.el = null; this.prev?.focus?.(); },
  render(q) {
    const ql = q.trim().toLowerCase();
    const cmds = this.all.filter(c => !ql || ql.split(/\s+/).every(w => c.name.toLowerCase().includes(w))).slice(0, 12);
    this.items = [...cmds, ...this.extra.filter(() => ql.length >= 2)]; this.idx = Math.min(this.idx, Math.max(0, this.items.length - 1));
    $('#palList').innerHTML = this.items.length ? this.items.map((c, i) => `<div class="pal-item${i === this.idx ? ' on' : ''}" role="option" aria-selected="${i === this.idx}" data-i="${i}"><span>${esc(c.name)}</span><small>${esc(c.hint)}</small></div>`).join('') : '<div class="noresult">Nothing matches.</div>';
  },
  move(d) { if (!this.items.length) return; this.idx = (this.idx + d + this.items.length) % this.items.length; this.render($('#palQ').value); $('.pal-item.on')?.scrollIntoView({block: 'nearest'}); },
  run(i) { const c = this.items[i]; if (!c) return; this.close(); c.run(); },
  search: debounce(async function (q) {
    q = q.trim(); if (!Palette.el || q.length < 2) { Palette.extra = []; return; }
    try {
      const [files, all] = await Promise.all([api('/api/library/search?q=' + enc(q)), api('/api/search?q=' + enc(q))]);
      if (!Palette.el || $('#palQ').value.trim() !== q) return;
      Palette.extra = [
        ...files.slice(0, 5).filter(f => f.exists !== false).map(f => ({name: f.name, hint: 'File', run: () => App.open(f.path)})),
        ...(all.notes || []).map(n => ({name: n.title || 'Untitled note', hint: 'Note', run: () => App.go('#/notes/' + n.id)})),
        ...(all.annotations || []).filter(a => a.file.exists).map(a => ({name: (a.text || a.quote).slice(0, 60), hint: a.file.name + ' · ' + Ann.where(a), run: () => App.openAt(a.file.path, a)})),
      ];
      Palette.render(q);
    } catch {}
  }, 200),
};
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); Palette.open(); } });
