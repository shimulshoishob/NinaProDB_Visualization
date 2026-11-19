(() => {
const P = document.getElementById('v-docx');
// Queries are scoped to this viewer's pane so ids/classes never clash with other viewers.
const $ = (s, r = P) => r.querySelector(s), $$ = (s, r = P) => [...r.querySelectorAll(s)];
const art = $('#docArticle'), scroller = $('#docScroll'), nav = $('#docNav');
let fs = store.get('docFont', 16), hits = [], hitI = -1, navOpen = store.get('docToc', true);
P.style.setProperty('--docfs', fs + 'px');

Viewers.docx = async f => {
  art.innerHTML = '<span class="spin"></span>'; nav.hidden = true; $('#docQ').value = ''; $('#docQInfo').hidden = true;
  const d = await api('/api/docx?path=' + enc(f.path));
  art.innerHTML = d.html || '<p style="color:var(--fg2)">This document has no readable content.</p>';
  $('#docInfo').textContent = `${d.words.toLocaleString()} words · ${d.minutes} min read` + (d.warnings ? ` · ${d.warnings} formatting notes` : '');
  nav.innerHTML = d.toc.length ? '<h4>Contents</h4>' + d.toc.map(t => `<a href="#${t.id}" data-id="${t.id}" style="padding-left:${8 + (t.level - 1) * 12}px">${esc(t.text)}</a>`).join('') : '<h4>No headings</h4>';
  nav.hidden = !navOpen; $('#docToc').classList.toggle('active', navOpen);
  $$('a', nav).forEach(a => a.onclick = e => { e.preventDefault(); const h = document.getElementById(a.dataset.id); if (h) scroller.scrollTo({top: h.offsetTop - 20, behavior: 'smooth'}); });
  $$('a[href]', art).forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  scroller.scrollTop = 0; spy();
};
function spy() { let id = null; for (const h of $$('h1,h2,h3,h4', art)) { if (h.offsetTop - 60 <= scroller.scrollTop) id = h.id; else break; } $$('a', nav).forEach(a => a.classList.toggle('on', a.dataset.id === id)); }
scroller.addEventListener('scroll', spy, {passive: true});
$('#docToc').onclick = () => { navOpen = !navOpen; store.set('docToc', navOpen); nav.hidden = !navOpen; $('#docToc').classList.toggle('active', navOpen); };
const setFont = d => { fs = Math.max(11, Math.min(28, fs + d)); store.set('docFont', fs); P.style.setProperty('--docfs', fs + 'px'); };
$('#docFontUp').onclick = () => setFont(1); $('#docFontDn').onclick = () => setFont(-1);
$('#docPrint').onclick = () => print();

function find(q) {
  $$('mark', art).forEach(m => m.replaceWith(document.createTextNode(m.textContent))); art.normalize(); hits = []; hitI = -1;
  const info = $('#docQInfo'); info.hidden = !q; if (!q) return;
  const ql = q.toLowerCase(), w = document.createTreeWalker(art, NodeFilter.SHOW_TEXT), nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  for (const n of nodes) {
    const low = n.data.toLowerCase(); let idx = low.indexOf(ql); if (idx < 0) continue;
    const ranges = []; while (idx >= 0 && hits.length + ranges.length < 2000) { ranges.push(idx); idx = low.indexOf(ql, idx + ql.length); }
    for (const s of ranges.reverse()) { const mid = n.splitText(s); mid.splitText(q.length); const m = document.createElement('mark'); mid.replaceWith(m); m.appendChild(mid); }
  }
  hits = $$('mark', art); info.textContent = hits.length ? `1 / ${hits.length}` : 'No matches'; if (hits.length) step(1);
}
function step(d) {
  if (!hits.length) return; hits[hitI]?.classList.remove('on'); hitI = (hitI + d + hits.length) % hits.length;
  const m = hits[hitI]; m.classList.add('on'); m.scrollIntoView({block: 'center'}); $('#docQInfo').textContent = `${hitI + 1} / ${hits.length}`;
}
$('#docQ').oninput = debounce(e => find(e.target.value.trim()), 250);
$('#docQ').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } };
$('#docQNext').onclick = () => step(1); $('#docQPrev').onclick = () => step(-1);
document.addEventListener('keydown', e => { if (!P.hidden && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#docQ').focus(); $('#docQ').select(); } });
})();
