(() => {
const P = document.getElementById('v-md');
// Queries are scoped to this viewer's pane so ids/classes never clash with other viewers.
const $ = (s, r = P) => r.querySelector(s), $$ = (s, r = P) => [...r.querySelectorAll(s)];
let cur = null, tocOpen = store.get('tocOpen', true), mode = 'preview';
const doc = $('#doc'), prev = $('#prevPane'), toc = $('#toc');

function fixLinks(dir) {
  $$('img', doc).forEach(img => {
    const s = img.getAttribute('src') || '';
    if (s && !/^(https?:|data:|\/)/i.test(s)) img.src = '/api/asset?path=' + encodeURIComponent(normalize(dir, s));
  });
  $$('a', doc).forEach(a => {
    const h = a.getAttribute('href') || '';
    if (/^(https?:|mailto:|tel:)/i.test(h)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; return; }
    if (h.startsWith('#')) return;
    const p = normalize(dir, h.split('#')[0]);
    if (/\.(md|markdown|mdown|mkd)$/i.test(p)) a.onclick = e => { e.preventDefault(); App.open(p); };
  });
  $$('pre', doc).forEach(pre => {
    const b = document.createElement('button'); b.className = 'btn copy'; b.textContent = 'Copy';
    b.onclick = () => { copyText(pre.innerText.replace(/Copy$/, '').trimEnd()); };
    (pre.closest('.hl') || pre).appendChild(b);
  });
  $$('input[type=checkbox]', doc).forEach(c => c.disabled = true);
}
function normalize(dir, rel) {
  const abs = rel[0] === '/' || (dir && dir[0] === '/');
  const parts = (dir && rel[0] !== '/' ? dir.split('/').concat(rel.split('/')) : rel.split('/')).filter(Boolean), out = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.') out.push(decodeURIComponent(p)); }
  return (abs ? '/' : '') + out.join('/');
}
function buildToc(items) {
  toc.innerHTML = items.length ? '<h4>On this page</h4>' + items.map(t => `<a href="#${esc(t.id)}" data-id="${esc(t.id)}" style="padding-left:${8 + (t.level - 1) * 12}px">${esc(t.text)}</a>`).join('') : '<h4>No headings</h4>';
  $$('a', toc).forEach(a => a.onclick = e => { e.preventDefault(); const t = document.getElementById(a.dataset.id); if (t) prev.scrollTo({top: t.offsetTop - 12}); });
  toc.hidden = !tocOpen; $('#tocBtn').classList.toggle('active', tocOpen);
}
function setDoc(html, tocItems, dir) { doc.innerHTML = html; fixLinks(dir); buildToc(tocItems); onScroll(); }

Viewers.md = async f => {
  
  try {
    const d = await api('/api/md?path=' + encodeURIComponent(f.path));
    cur = {...d, path: f.path, name: f.name};
    $('#mdName').textContent = f.name;
    $('#mdMeta').textContent = `${d.words.toLocaleString()} words · ${d.minutes} min read · ${d.lines} lines` + (d.truncated ? ' · truncated' : '');
    $('#src').value = d.source; setDoc(d.html, d.toc, d.dir); prev.scrollTop = 0;
  } catch (e) { doc.innerHTML = `<p style="color:var(--danger)">${esc(e.message)}</p>`; }
};

const live = debounce(async () => {
  try { const d = await api('/api/render', {json: {text: $('#src').value}}); setDoc(d.html, d.toc, cur.dir); } catch (e) { toast(e.message, true); }
}, 300);
$('#src').oninput = live;

function onScroll() {
  const max = prev.scrollHeight - prev.clientHeight;
  $('#progress div').style.width = (max > 0 ? prev.scrollTop / max * 100 : 0) + '%';
  let id = null; for (const h of $$('h1,h2,h3,h4', doc)) { if (h.offsetTop - 40 <= prev.scrollTop) id = h.id; else break; }
  $$('a', toc).forEach(a => a.classList.toggle('on', a.dataset.id === id));
}
prev.addEventListener('scroll', onScroll, {passive: true});

$('#mdModes').onclick = e => {
  const b = e.target.closest('button'); if (!b) return; mode = b.dataset.m; P.dataset.mode = mode;
  $$('#mdModes button').forEach(x => x.classList.toggle('active', x === b));
};
$('#tocBtn').onclick = () => { tocOpen = !tocOpen; store.set('tocOpen', tocOpen); toc.hidden = !tocOpen; $('#tocBtn').classList.toggle('active', tocOpen); };
$('#copySrc').onclick = () => copyText($('#src').value);
$('#printBtn').onclick = () => print();
$('#exportHtml').onclick = async () => {
  const css = await (await fetch('/static/css/md.css')).text(), pyg = await (await fetch('/pygments.css')).text();
  const page = `<!doctype html><meta charset=utf-8><title>${esc(cur.name)}</title><style>body{font:16px/1.7 -apple-system,Segoe UI,sans-serif;margin:0}${pyg}:root{--bg:#fff;--bg2:#f6f7f9;--bg3:#eceef2;--fg:#1c2128;--fg2:#5b6572;--line:#dde1e7;--accent:#2f81f7;--hover:#eef1f5;--sel:#e3ecfb}.copy,#toc{display:none}${css}</style><article class="markdown-body">${doc.innerHTML}</article>`;
  download(cur.name.replace(/\.\w+$/, '') + '.html', page, 'text/html');
};
})();
