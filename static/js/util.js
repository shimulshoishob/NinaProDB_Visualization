/* Shared helpers used by the shell and every viewer. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';
const fmtDate = t => t ? new Date(t * 1000).toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'}) : '';
function timeAgo(t) {
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'; if (s < 604800) return Math.floor(s / 86400) + ' d ago';
  return fmtDate(t);
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : ''); t.setAttribute('role', err ? 'alert' : 'status'); t.textContent = msg;
  $('#toast').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 200); }, err ? 6000 : 2600);
}
async function api(url, opts = {}) {
  if (opts.json !== undefined) opts = {method: opts.method || 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(opts.json)};
  let r;
  try { r = await fetch(url, opts); } catch { throw new Error('Cannot reach the server. Is `python main.py` still running?'); }
  const data = (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.error) || 'Request failed (' + r.status + ')');
  return data;
}
async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('Copied to clipboard'); } catch { toast('Copy failed', true); } }
function download(name, text, type = 'text/plain') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
function debounce(fn, ms = 150) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
const fileIcon = cat => ({code: 'code', pdf: 'pdf', text: 'text', word: 'word', slides: 'slides', images: 'image', data: 'data'}[cat] || 'file');

/* theme: system / light / dark */
const Theme = {
  pref: () => store.get('theme', 'system'),
  apply() {
    const p = this.pref(), dark = p === 'dark' || (p === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.dispatchEvent(new CustomEvent('themechange'));
  },
  set(p) { store.set('theme', p); this.apply(); },
  toggle() { this.set(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); }
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => Theme.pref() === 'system' && Theme.apply());


/* Accessibility: give every control an accessible name and make clickable rows keyboard friendly.
   Runs after any change to the page (cheap, debounced). */
const A11y = {
  run() {
    const root = document.getElementById('main'); if (!root) return;
    root.querySelectorAll('input:not([type=hidden]):not([aria-label]),select:not([aria-label]),textarea:not([aria-label])').forEach(el => {
      if ((el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label')) return;
      if (el.type === 'checkbox' || el.type === 'radio') { const t = (el.closest('li,.todo,.row,td') || el.parentElement)?.textContent.trim().slice(0, 80); if (t) el.setAttribute('aria-label', t); return; }
      const t = el.title || el.placeholder || (el.tagName === 'SELECT' && el.options[0] ? el.options[0].textContent : '') || (el.disabled ? el.value : '');
      if (t) el.setAttribute('aria-label', t.replace(/\s*\(.*?\)\s*$/, '').trim());
    });
    root.querySelectorAll('button:not([aria-label]),a[href]:not([aria-label])').forEach(el => { if (!el.textContent.trim() && el.title) el.setAttribute('aria-label', el.title); });
    root.querySelectorAll('.row[data-path],.nitem,.subj,.ap-item,.card:not(button)').forEach(el => { if (!el.hasAttribute('tabindex')) el.tabIndex = 0; if (!el.getAttribute('role')) el.setAttribute('role', 'button'); });
    root.querySelectorAll('.seg').forEach(seg => seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.classList.contains('active'))));
  },
  start() {
    const later = debounce(() => A11y.run(), 120);
    new MutationObserver(later).observe(document.getElementById('main'), {childList: true, subtree: true});
    document.addEventListener('click', e => { if (e.target.closest('.seg')) setTimeout(() => A11y.run(), 60); });
    document.addEventListener('keydown', e => {                       // Enter / Space activate row-like buttons
      const t = e.target;
      if ((e.key === 'Enter' || e.key === ' ') && t.getAttribute && t.getAttribute('role') === 'button' && !/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) { e.preventDefault(); t.click(); }
    });
    this.run();
  },
};
