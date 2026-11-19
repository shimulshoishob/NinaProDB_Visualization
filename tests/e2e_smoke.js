/* Browser smoke test for NinaPro Study Workspace.
 *
 * How to run: start the app (python main.py), open http://127.0.0.1:8000 and keep that tab visible,
 * paste this whole file into the browser's developer-tools console and press Enter.
 * It opens every page and one sample file of every type from the bundled data/ folder, checks that the
 * expected content appears, that no script error occurs and that every control has an accessible name.
 * The result is printed as a table; `failed` is the number of failing checks.
 */
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const errors = [];
  addEventListener('error', e => errors.push(e.message));
  addEventListener('unhandledrejection', e => errors.push('rejection: ' + (e.reason && e.reason.message)));
  const root = (await api('/api/fs/list?path=')).path;                      // the bundled data/ folder
  const results = [];
  const check = (name, ok, detail = '') => results.push({check: name, pass: !!ok, detail: String(detail)});
  const visible = () => [...document.querySelectorAll('.vpane')].find(p => !p.hidden)?.id;
  const count = sel => document.querySelectorAll(sel).length;
  const unnamed = () => [...document.querySelectorAll('#main button, #main a[href], #main input:not([type=hidden]), #main select, #main textarea')]
    .filter(el => el.offsetParent !== null && !(el.getAttribute('aria-label') || el.textContent.trim() || el.title || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label'))).length;

  // 1. pages
  for (const [hash, selector] of [['#/', '.card'], ['#/recent', '.page-title'], ['#/library/favorites', '.page-title'], ['#/library/collections', '.page-title'], ['#/library/tags', '.page-title'],
    ['#/subjects', '.subj'], ['#/notes', '.nlist'], ['#/planner', '.timer-face'], ['#/planner/todo', '#tAdd'], ['#/planner/revision', '#rAdd'], ['#/planner/exams', '#eAdd'],
    ['#/toolkit/visualizer', '.bars'], ['#/toolkit/dryrun', '.dry'], ['#/toolkit/complexity', 'table.ref'], ['#/toolkit/structures', '.ref-card'], ['#/toolkit/concepts', '.ref-card'],
    ['#/toolkit/snippets', '#snSeg'], ['#/toolkit/practice', '#pSeg'], ['#/annotations', '#annBody'], ['#/settings', '.set-sec'], ['#/browse/code', '#blist'], ['#/browse/pdf', '#blist']]) {
    location.hash = hash; await wait(800);
    check('page ' + hash, count(selector) > 0, selector);
    check('accessible names ' + hash, unnamed() === 0, unnamed() + ' unnamed controls');
  }

  // 2. one file per viewer
  const files = [['pdf/algorithms_notes.pdf', 'v-pdf', '.pg'], ['code/example.py', 'v-code', '.ln'], ['json/sample_users.json', 'v-json', '.row'], ['markdown/welcome.md', 'v-md', '#doc h2'],
    ['sql/shop.db', 'v-sql', '.obj'], ['sql/shop.sql', 'v-sql', '.ln'], ['mat/S1_A1_E1_sample.mat', 'v-mat', '.mx-c'], ['images/sample_gradient.png', 'v-image', '#imgEl'],
    ['docs/sample_notes.docx', 'v-docx', '#docArticle h1'], ['slides/sample_lecture.pptx', 'v-pptx', '.sh']];
  for (const [path, pane, selector] of files) {
    App.open(root + '/' + path); await wait(2200);
    check('open ' + path, visible() === pane && document.querySelectorAll('#' + pane + ' ' + selector).length > 0, visible());
    check('accessible names ' + path, unnamed() === 0, unnamed() + ' unnamed controls');
    if (path === 'markdown/welcome.md') { const ad = document.querySelector('#v-md .admonition'); check('markdown admonition stays in the page flow', ad && getComputedStyle(ad).position !== 'fixed'); }
    if (path === 'code/example.py') { const k = document.querySelector('#v-code .t .k'), t = document.querySelector('#v-code .t'); check('code syntax colours applied', k && getComputedStyle(k).color !== getComputedStyle(t).color); }
  }

  // 3. keyboard shortcuts
  location.hash = '#/'; await wait(700);
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'k', ctrlKey: true, bubbles: true})); await wait(200);
  check('Ctrl+K opens the command palette', !!document.querySelector('.palette'));
  document.querySelector('#palQ').dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); await wait(150);
  check('Esc closes the palette', !document.querySelector('.palette'));
  document.dispatchEvent(new KeyboardEvent('keydown', {key: '?', bubbles: true})); await wait(250);
  check('? opens the shortcuts sheet', !!document.querySelector('.dlg .keys'));
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); await wait(250);
  check('Esc closes the shortcuts sheet', !document.querySelector('.dlg'));
  document.dispatchEvent(new KeyboardEvent('keydown', {key: '/', bubbles: true})); await wait(100);
  check('/ focuses the search box', document.activeElement.id === 'gsearch', document.activeElement.id);
  document.activeElement.blur();
  const nav = document.body.classList.contains('nav-min');
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'b', ctrlKey: true, bubbles: true}));
  check('Ctrl+B toggles the navigation', document.body.classList.contains('nav-min') !== nav);
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'b', ctrlKey: true, bubbles: true}));
  App.open(root + '/code/example.py'); await wait(1500);
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); await wait(600);
  check('Esc leaves a document', !location.hash.startsWith('#/open'), location.hash);

  check('no script errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = results.filter(r => !r.pass).length;
  console.table(results);
  console.log(failed ? `FAILED: ${failed} of ${results.length} checks` : `All ${results.length} checks passed`);
  return {failed, total: results.length, failures: results.filter(r => !r.pass)};
})();
