(() => {
const P = document.getElementById('v-pptx');
// Queries are scoped to this viewer's pane so ids/classes never clash with other viewers.
const $ = (s, r = P) => r.querySelector(s), $$ = (s, r = P) => [...r.querySelectorAll(s)];
let deck = null, cur = 0, mode = 'slide', notes = store.get('pptNotes', false);
const stage = $('#pptStage'), slideEl = $('#pptSlide');

Viewers.pptx = async f => {
  slideEl.innerHTML = '<span class="spin"></span>';
  deck = await api('/api/pptx?path=' + enc(f.path)); cur = 0;
  $('#pptCount').textContent = '/ ' + deck.slides.length; $('#pptNum').max = deck.slides.length;
  $('#pptInfo').textContent = `${deck.slides.length} slides · text and images view`;
  $('#pptList').innerHTML = deck.slides.map((s, i) => `<button class="st" data-i="${i}"><b>${s.n}</b><span>${esc(s.title)}</span></button>`).join('');
  $('#pptList').onclick = e => { const b = e.target.closest('.st'); if (b) show(+b.dataset.i); };
  $('#pptNotes').classList.toggle('active', notes); setMode('slide'); show(0);
};
function size() {
  const aspect = deck.width / deck.height, w = stage.clientWidth - 40, h = stage.clientHeight - 40;
  const sw = Math.max(200, Math.min(w, h * aspect)); slideEl.style.width = sw + 'px'; slideEl.style.height = sw / aspect + 'px'; return sw;
}
function show(i) {
  if (!deck) return; cur = Math.max(0, Math.min(deck.slides.length - 1, i)); const s = deck.slides[cur];
  $$('.st').forEach(b => b.classList.toggle('on', +b.dataset.i === cur)); $('.st.on')?.scrollIntoView({block: 'nearest'});
  $('#pptNum').value = cur + 1; $('#pptPrev').disabled = cur === 0; $('#pptNext').disabled = cur === deck.slides.length - 1;
  const sw = size(), pxPerPt = sw / (deck.width * 72);
  slideEl.innerHTML = s.shapes.map(sh => {
    const pos = `left:${sh.x}%;top:${sh.y}%;width:${sh.w}%;height:${sh.h}%`;
    if (sh.type === 'image') return `<div class="sh" style="${pos}"><img src="${sh.src}" alt=""></div>`;
    if (sh.type === 'table') return `<div class="sh" style="${pos}"><table>${sh.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`;
    return `<div class="sh" style="${pos}">${sh.paras.map(p => { const pt = p.size || (sh.title ? 32 : 20 - Math.min(p.level, 3) * 2); return `<p style="font-size:${(pt * pxPerPt).toFixed(1)}px;margin-left:${p.level * 1.2}em;${p.bold || sh.title ? 'font-weight:600;' : ''}">${!sh.title && sh.paras.length > 1 ? '• ' : ''}${esc(p.text)}</p>`; }).join('')}</div>`;
  }).join('') || '<div class="sh" style="left:5%;top:45%;color:#999">Empty slide</div>';
  const nb = $('#pptNoteBox'); nb.hidden = !(notes && s.notes); nb.textContent = s.notes ? 'Speaker notes\n' + s.notes : '';
}
function setMode(m) {
  mode = m; $$('#pptMode button').forEach(b => b.classList.toggle('active', b.dataset.m === m));
  const out = $('#pptOutline');
  if (m === 'outline') {
    stage.hidden = true; $('#pptNoteBox').hidden = true;
    const el = out || Object.assign(document.createElement('div'), {id: 'pptOutline'}); if (!out) $('#pptMain').prepend(el);
    el.hidden = false; el.innerHTML = deck.slides.map(s => `<h3>${s.n}. ${esc(s.title)}</h3>` + s.shapes.filter(x => x.type === 'text' && !x.title).flatMap(x => x.paras).map(p => `<p style="margin-left:${p.level * 18}px">• ${esc(p.text)}</p>`).join('') + (s.notes ? `<p style="color:var(--fg2)"><i>Notes: ${esc(s.notes)}</i></p>` : '')).join('');
  } else { stage.hidden = false; if (out) out.hidden = true; show(cur); }
}
$('#pptMode').onclick = e => { const b = e.target.closest('button'); if (b && deck) setMode(b.dataset.m); };
$('#pptPrev').onclick = () => show(cur - 1); $('#pptNext').onclick = () => show(cur + 1);
$('#pptNum').onkeydown = e => { if (e.key === 'Enter') show(+e.target.value - 1); };
$('#pptNotes').onclick = () => { notes = !notes; store.set('pptNotes', notes); $('#pptNotes').classList.toggle('active', notes); show(cur); };
$('#pptPresent').onclick = () => $('#pptMain').requestFullscreen?.().catch(() => toast('Full screen is not available.', true));
new ResizeObserver(() => { if (!P.hidden && deck && mode === 'slide') show(cur); }).observe(stage);
document.addEventListener('keydown', e => {
  if (P.hidden || typing() || e.ctrlKey || e.metaKey) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); show(cur + 1); } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); show(cur - 1); }
  else if (e.key === 'Home') show(0); else if (e.key === 'End') show(deck.slides.length - 1);
});
})();
