/* Planner: Pomodoro timer, daily progress, goals, to-do list, revision reminders and exam checklists. */
const fmtClock = sec => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
const todayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

/* ---------------- Pomodoro (keeps running while you move around the app) ---------------- */
const Pomodoro = {
  cfg: {focus: 25, short: 5, long: 15},
  st: store.get('pomo', null) || {mode: 'focus', remaining: 25 * 60, endsAt: null, cycle: 0, subject: ''},
  save() { store.set('pomo', this.st); },
  len(mode) { return this.cfg[mode] * 60; },
  async reload() {
    try { const s = await api('/api/settings'); this.cfg = {focus: s.pomo_focus || 25, short: s.pomo_short || 5, long: s.pomo_long || 15}; } catch {}
    if (!this.st.endsAt && this.st.remaining >= this.len(this.st.mode) - 1) this.st.remaining = this.len(this.st.mode);
    this.render();
  },
  running() { return !!this.st.endsAt; },
  left() { return this.st.endsAt ? Math.max(0, Math.ceil((this.st.endsAt - Date.now()) / 1000)) : this.st.remaining; },
  start() { if (!this.st.endsAt) { this.st.endsAt = Date.now() + this.st.remaining * 1000; this.save(); this.render(); } },
  pause() { if (this.st.endsAt) { this.st.remaining = this.left(); this.st.endsAt = null; this.save(); this.render(); } },
  reset() { this.st.endsAt = null; this.st.remaining = this.len(this.st.mode); this.save(); this.render(); },
  setMode(mode) { this.st.mode = mode; this.reset(); },
  skip() { this.next(false); },
  next(completed) {
    if (this.st.mode === 'focus') { this.st.cycle = completed ? this.st.cycle + 1 : this.st.cycle; this.st.mode = this.st.cycle > 0 && this.st.cycle % 4 === 0 && completed ? 'long' : 'short'; }
    else this.st.mode = 'focus';
    this.st.endsAt = null; this.st.remaining = this.len(this.st.mode); this.save(); this.render();
  },
  async finish() {
    const wasFocus = this.st.mode === 'focus', minutes = this.cfg.focus;
    this.beep();
    if (wasFocus) {
      try { await SA.add('sessions', {minutes, subject_id: this.st.subject || '', kind: 'focus', day: todayStr()}); toast(`Focus session complete: ${minutes} minutes logged. Take a break!`); } catch (e) { toast(e.message, true); }
    } else toast('Break over. Ready for the next focus session?');
    this.next(wasFocus);
    if (location.hash.startsWith('#/planner') || location.hash === '' || location.hash === '#/') App.route();
  },
  beep() {
    try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); [0, 0.25, 0.5].forEach(t => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.15); }); } catch {}
  },
  tick() { if (this.running() && this.left() <= 0) this.finish(); else this.render(); },
  render() {
    const left = this.left(), mini = $('#miniTimer'), inProgress = this.running() || left < this.len(this.st.mode);
    if (mini) { mini.hidden = !inProgress; $('#miniTime').textContent = (this.st.mode === 'focus' ? '' : 'Break ') + fmtClock(left); }
    const face = $('#tmFace'); if (!face) return;
    face.textContent = fmtClock(left);
    $('#tmMode').textContent = {focus: 'Focus', short: 'Short break', long: 'Long break'}[this.st.mode];
    $('#tmGo').innerHTML = this.running() ? icon('pause') + 'Pause' : icon('play') + (left < this.len(this.st.mode) ? 'Resume' : 'Start');
    $$('#tmDots i').forEach((d, i) => d.classList.toggle('on', i < this.st.cycle % 4));
  },
};
setInterval(() => Pomodoro.tick(), 500);
Pomodoro.reload();

/* ---------------- planner page ---------------- */
const PL = {tab: 'today', todoFilter: 'open'};
App.pages.planner = async (rest) => {
  PL.tab = rest[0] || 'today'; await Study.subjects();
  const page = $('#page'), tabs = [['today', 'Today'], ['todo', 'To-do'], ['revision', 'Revision'], ['exams', 'Exams']];
  page.innerHTML = `<div class="page"><div class="page-title"><h1>Planner</h1><div class="seg" id="plSeg">${tabs.map(([k, n]) => `<button data-t="${k}" class="${k === PL.tab ? 'active' : ''}">${n}</button>`).join('')}</div></div><div id="plBody"></div></div>`;
  $('#plSeg').onclick = e => { const b = e.target.closest('button'); if (b) App.go('#/planner/' + b.dataset.t); };
  try { await ({today: planToday, todo: planTodo, revision: planRevision, exams: planExams}[PL.tab] || planToday)(); }
  catch (e) { $('#plBody').innerHTML = `<div class="empty"><h2>Something went wrong</h2><p>${esc(e.message)}</p></div>`; }
};
const subSel = (id, cls = '') => `<select ${id ? `id="${id}"` : ''} class="${cls}" aria-label="Subject">${Study.subjectOptions('', 'No subject')}</select>`;
const dueLabel = d => { if (!d) return ''; const days = Math.round((new Date(d + 'T00:00') - new Date(todayStr() + 'T00:00')) / 864e5); return days < 0 ? `${-days} day${days === -1 ? '' : 's'} overdue` : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`; };

async function planToday() {
  const [sum, sessions, goals] = await Promise.all([api('/api/study/summary'), SA.list('sessions'), SA.list('goals')]);
  const pct = sum.goal_minutes ? Math.min(100, Math.round(100 * sum.today_minutes / sum.goal_minutes)) : 0, max = Math.max(30, ...sum.week.map(w => w.minutes));
  const inRange = (g) => sessions.filter(s => (!g.subject_id || s.subject_id === g.subject_id) && (g.period === 'day' ? s.day === todayStr() : s.day >= new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10))).reduce((a, s) => a + s.minutes, 0);
  $('#plBody').innerHTML = `<div class="pl-grid">
    <div class="panel"><h2>Focus timer</h2><div class="timer-mode" id="tmMode"></div><div class="timer-face" id="tmFace">25:00</div><div class="dots" id="tmDots"><i></i><i></i><i></i><i></i></div>
      <div class="timer-ctl"><button class="btn primary" id="tmGo"></button><button class="btn" id="tmReset">${icon('reset')}Reset</button><button class="btn" id="tmSkip">${icon('skip')}Skip</button></div>
      <div class="timer-opt">${subSel('tmSub')}</div><p class="muted" style="text-align:center;font-size:12.5px;margin:10px 0 0">Completed focus sessions are logged automatically. Lengths are in Settings.</p></div>
    <div class="panel"><h2>Today's progress</h2><div style="display:flex;align-items:baseline;gap:8px"><b style="font-size:28px">${sum.today_minutes}</b><span class="muted">of ${sum.goal_minutes} min · ${sum.streak} day streak</span></div>
      <div class="bar" style="height:8px"><i style="width:${pct}%"></i></div>
      <div class="week">${sum.week.map(w => `<div title="${w.day}: ${w.minutes} min"><i style="height:${Math.round(100 * w.minutes / max)}%"></i>${new Date(w.day + 'T00:00').toLocaleDateString(undefined, {weekday: 'short'}).slice(0, 2)}</div>`).join('')}</div>
      <div class="addrow" style="margin:14px 0 0"><input id="lgMin" type="number" min="1" max="1440" placeholder="Minutes" style="width:96px">${subSel('lgSub')}<input id="lgNote" type="text" placeholder="What did you study? (optional)"><button class="btn" id="lgAdd">Log time</button></div></div>
    <div class="panel"><h2>Goals</h2><div class="addrow"><input id="gTitle" type="text" placeholder="e.g. Finish OS chapter 4">
        <select id="gKind"><option value="text">Checklist goal</option><option value="minutes">Study time goal</option></select><input id="gTarget" type="number" min="1" placeholder="Minutes" style="width:90px" hidden>
        <select id="gPeriod" hidden><option value="day">per day</option><option value="week">per week</option></select><button class="btn" id="gAdd">Add</button></div>
      <div id="gList">${goals.length ? goals.map(g => { const done = g.kind === 'minutes' ? inRange(g) : 0, p = g.target ? Math.min(100, Math.round(100 * done / g.target)) : 0; return `<div class="todo ${g.active ? '' : 'done'}" data-id="${g.id}">
        ${g.kind === 'text' ? `<input type="checkbox" data-done ${g.active ? '' : 'checked'} aria-label="Mark goal done">` : icon('timer')}<div class="tt">${esc(g.title)}${g.kind === 'minutes' ? `<small> · ${done}/${g.target} min ${g.period === 'day' ? 'today' : 'this week'}${g.subject_id ? ' · ' + esc(Study.subjectName(g.subject_id)) : ''}</small><div class="bar"><i style="width:${p}%"></i></div>` : ''}</div><button class="icon-btn" data-del aria-label="Delete goal">${icon('trash')}</button></div>`; }).join('') : '<div class="noresult">No goals yet.</div>'}</div></div>
    <div class="panel"><h2>Recent sessions</h2>${sessions.slice(0, 8).map(s => `<div class="todo" data-sid="${s.id}"><div class="tt"><b>${s.minutes} min</b> <small>${s.day}${s.subject_id ? ' · ' + esc(Study.subjectName(s.subject_id)) : ''}${s.note ? ' · ' + esc(s.note) : ''}</small></div><button class="icon-btn" data-del aria-label="Delete session">${icon('trash')}</button></div>`).join('') || '<div class="noresult">No study time logged yet.</div>'}</div></div>`;
  const P = Pomodoro; $('#tmSub').value = P.st.subject || ''; $('#tmSub').onchange = e => { P.st.subject = e.target.value; P.save(); };
  $('#tmGo').onclick = () => P.running() ? P.pause() : P.start(); $('#tmReset').onclick = () => P.reset(); $('#tmSkip').onclick = () => P.skip(); P.render();
  $('#lgAdd').onclick = async () => { try { await SA.add('sessions', {minutes: $('#lgMin').value, subject_id: $('#lgSub').value, note: $('#lgNote').value, kind: 'manual', day: todayStr()}); toast('Study time logged'); planToday(); } catch (e) { toast(e.message, true); } };
  const kindSw = () => { const m = $('#gKind').value === 'minutes'; $('#gTarget').hidden = $('#gPeriod').hidden = !m; }; $('#gKind').onchange = kindSw;
  $('#gAdd').onclick = async () => { try { await SA.add('goals', {title: $('#gTitle').value, kind: $('#gKind').value, target: $('#gTarget').value || 0, period: $('#gPeriod').value}); planToday(); } catch (e) { toast(e.message, true); } };
  $('#plBody').onclick = async e => {
    const row = e.target.closest('[data-id]'), srow = e.target.closest('[data-sid]');
    if (row && e.target.closest('[data-del]')) { if (await UI.confirm('', {title: 'Delete this goal?', confirm: 'Delete', danger: true})) { await SA.del('goals', row.dataset.id); planToday(); } }
    else if (row && e.target.closest('[data-done]')) { await SA.upd('goals', row.dataset.id, {active: !e.target.checked}); planToday(); }
    else if (srow && e.target.closest('[data-del]')) { await SA.del('sessions', srow.dataset.sid); planToday(); }
  };
}

async function planTodo() {
  const items = await SA.list('todos'), shown = items.filter(t => PL.todoFilter === 'all' || (PL.todoFilter === 'open' ? !t.done : t.done));
  $('#plBody').innerHTML = `<div class="panel"><div class="addrow"><input id="tTitle" type="text" placeholder="Add a task, e.g. Solve problem set 3   ( Enter )"><input id="tDue" type="date" aria-label="Due date">${subSel('tSub')}
      <select id="tPri" aria-label="Priority"><option value="1">Normal</option><option value="2">High</option><option value="3">Urgent</option></select><button class="btn primary" id="tAdd">${icon('plus')}Add</button></div>
    <div class="chips" style="padding:0 0 8px">${['open', 'done', 'all'].map(f => `<button class="chip${PL.todoFilter === f ? ' on' : ''}" data-f="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div>
    <div id="tList">${shown.length ? shown.map(t => `<div class="todo ${t.done ? 'done' : ''}" data-id="${t.id}"><input type="checkbox" ${t.done ? 'checked' : ''} aria-label="Done"><span class="pri p${t.priority}" title="Priority"></span>
      <div class="tt">${esc(t.title)}<small>${t.subject_id ? ' · ' + esc(Study.subjectName(t.subject_id)) : ''}${t.due ? ` · <span class="${!t.done && t.due < todayStr() ? 'late' : ''}">${esc(dueLabel(t.due))}</span>` : ''}</small></div><button class="icon-btn" data-del aria-label="Delete task">${icon('trash')}</button></div>`).join('') : '<div class="noresult">Nothing here. Add your first task above.</div>'}</div></div>`;
  const add = async () => { try { await SA.add('todos', {title: $('#tTitle').value, due: $('#tDue').value, subject_id: $('#tSub').value, priority: $('#tPri').value}); planTodo(); } catch (e) { toast(e.message, true); } };
  $('#tAdd').onclick = add; $('#tTitle').onkeydown = e => { if (e.key === 'Enter') add(); };
  $('#plBody').onclick = async e => {
    const chip = e.target.closest('.chip[data-f]'); if (chip) { PL.todoFilter = chip.dataset.f; return planTodo(); }
    const row = e.target.closest('.todo'); if (!row) return;
    if (e.target.closest('[data-del]')) { await SA.del('todos', row.dataset.id); planTodo(); }
    else if (e.target.matches('input[type=checkbox]')) { await SA.upd('todos', row.dataset.id, {done: e.target.checked}); planTodo(); }
  };
}

async function planRevision() {
  const [reminders, due, sum] = await Promise.all([SA.list('reminders'), api('/api/study/practice/due'), api('/api/study/summary')]);
  $('#plBody').innerHTML = `<div class="pl-grid"><div class="panel"><h2>Practice questions</h2><div style="display:flex;align-items:baseline;gap:8px"><b style="font-size:28px">${due.length}</b><span class="muted">due for review today</span></div>
      <p class="muted" style="font-size:13px">Questions come back on a spaced schedule: 1, 3, 7, 14 and 30 days, depending on how well you remember them.</p><a class="btn primary" href="#/toolkit/practice">${icon('play')}Start practice</a></div>
    <div class="panel"><h2>Revision reminders</h2><div class="addrow"><input id="rTitle" type="text" placeholder="e.g. Revise deadlock chapter"><input id="rDue" type="date" value="${new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10)}" aria-label="Due date">${subSel('rSub')}<button class="btn" id="rAdd">${icon('plus')}Add</button></div>
      <div id="rList">${reminders.length ? reminders.map(r => `<div class="todo ${r.done ? 'done' : ''}" data-id="${r.id}"><input type="checkbox" ${r.done ? 'checked' : ''} aria-label="Done"><div class="tt">${esc(r.title)}<small>${r.subject_id ? ' · ' + esc(Study.subjectName(r.subject_id)) : ''} · <span class="${!r.done && r.due && r.due <= todayStr() ? 'late' : ''}">${esc(dueLabel(r.due) || 'no date')}</span></small></div>
        ${r.file && r.file.exists ? `<button class="btn ghost" data-open="${esc(r.file.path)}">Open</button>` : ''}<button class="icon-btn" data-del aria-label="Delete reminder">${icon('trash')}</button></div>`).join('') : '<div class="noresult">No reminders. Use the tag button in any open file to add it to your revision list.</div>'}</div></div></div>`;
  const add = async () => { try { await SA.add('reminders', {title: $('#rTitle').value, due: $('#rDue').value, subject_id: $('#rSub').value}); planRevision(); } catch (e) { toast(e.message, true); } };
  $('#rAdd').onclick = add; $('#rTitle').onkeydown = e => { if (e.key === 'Enter') add(); };
  $('#plBody').onclick = async e => {
    const row = e.target.closest('.todo'); if (!row) return;
    if (e.target.closest('[data-open]')) return App.open(e.target.closest('[data-open]').dataset.open);
    if (e.target.closest('[data-del]')) { await SA.del('reminders', row.dataset.id); planRevision(); }
    else if (e.target.matches('input[type=checkbox]')) { await SA.upd('reminders', row.dataset.id, {done: e.target.checked}); planRevision(); }
  };
}

const STD_CHECKLIST = ['Review the syllabus and mark weak topics', 'Collect lecture notes and slides', 'Solve past papers under time', 'Write a one-page summary per chapter', 'Make a formula / key-terms sheet', 'Practice the weak topics again', 'Do a final revision the day before', 'Prepare ID, stationery and exam venue'];
async function planExams() {
  const [exams, items] = await Promise.all([SA.list('exams'), SA.list('checklist')]);
  $('#plBody').innerHTML = `<div class="panel" style="margin-bottom:16px"><div class="addrow" style="margin:0"><input id="eName" type="text" placeholder="Exam name, e.g. Operating Systems midterm"><input id="eDate" type="date" aria-label="Exam date">${subSel('eSub')}<button class="btn primary" id="eAdd">${icon('plus')}Add exam</button></div></div>
    ${exams.length ? exams.map(x => { const its = items.filter(i => i.exam_id === x.id), done = its.filter(i => i.done).length, p = its.length ? Math.round(100 * done / its.length) : 0; return `<div class="exam" data-ex="${x.id}">
      <div class="exam-h"><b>${esc(x.name)}</b><span class="muted">${x.subject_id ? esc(Study.subjectName(x.subject_id)) + ' · ' : ''}${esc(x.date || 'no date')}${x.date ? ' · ' + esc(dueLabel(x.date)) : ''}</span><span class="badge">${done}/${its.length}</span><button class="icon-btn" data-delex aria-label="Delete exam">${icon('trash')}</button></div>
      <div class="bar" style="margin:0;border-radius:0"><i style="width:${p}%"></i></div>
      ${its.map(i => `<div class="todo ${i.done ? 'done' : ''}" data-id="${i.id}"><input type="checkbox" ${i.done ? 'checked' : ''} aria-label="Done"><div class="tt">${esc(i.text)}</div><button class="icon-btn" data-delit aria-label="Delete item">${icon('trash')}</button></div>`).join('')}
      <div class="addrow" style="margin:0;padding:10px 12px"><input type="text" data-newit placeholder="Add a checklist item   ( Enter )">${its.length ? '' : '<button class="btn" data-std>Use a standard checklist</button>'}</div></div>`; }).join('') : '<div class="empty"><h2>No exams yet</h2><p>Add an exam to get a countdown and a preparation checklist.</p></div>'}`;
  const add = async () => { try { await SA.add('exams', {name: $('#eName').value, date: $('#eDate').value, subject_id: $('#eSub').value}); planExams(); } catch (e) { toast(e.message, true); } };
  $('#eAdd').onclick = add; $('#eName').onkeydown = e => { if (e.key === 'Enter') add(); };
  $('#plBody').onkeydown = async e => { const inp = e.target.closest('[data-newit]'); if (inp && e.key === 'Enter' && inp.value.trim()) { try { await SA.add('checklist', {exam_id: inp.closest('[data-ex]').dataset.ex, text: inp.value, position: 99}); planExams(); } catch (er) { toast(er.message, true); } } };
  $('#plBody').onclick = async e => {
    const ex = e.target.closest('[data-ex]'); if (!ex) return;
    if (e.target.closest('[data-delex]')) { if (await UI.confirm('Its checklist is deleted too.', {title: 'Delete this exam?', confirm: 'Delete', danger: true})) { await SA.del('exams', ex.dataset.ex); planExams(); } }
    else if (e.target.closest('[data-std]')) { for (const [i, t] of STD_CHECKLIST.entries()) await SA.add('checklist', {exam_id: ex.dataset.ex, text: t, position: i}); planExams(); }
    else { const row = e.target.closest('.todo'); if (!row) return; if (e.target.closest('[data-delit]')) { await SA.del('checklist', row.dataset.id); planExams(); } else if (e.target.matches('input[type=checkbox]')) { await SA.upd('checklist', row.dataset.id, {done: e.target.checked}); planExams(); } }
  };
}
