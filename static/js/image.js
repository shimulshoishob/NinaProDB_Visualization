(() => {
const P = document.getElementById('v-image');
// Queries are scoped to this viewer's pane so ids/classes never clash with other viewers.
const $ = (s, r = P) => r.querySelector(s), $$ = (s, r = P) => [...r.querySelectorAll(s)];
const img = $('#imgEl'), stage = $('#imgStage');
let zoom = 1, fit = true, rot = 0, nat = {w: 0, h: 0};

function apply() {
  const r90 = rot % 180 !== 0, bw = r90 ? nat.h : nat.w, bh = r90 ? nat.w : nat.h;
  if (fit) zoom = Math.min(1, Math.min((stage.clientWidth - 48) / bw, (stage.clientHeight - 48) / bh)) || 1;
  img.style.width = nat.w * zoom + 'px'; img.style.height = nat.h * zoom + 'px';
  // rotated images keep their layout box swapped so scrolling still works
  const shift = r90 ? (nat.w - nat.h) * zoom / 2 : 0;
  img.style.transform = `rotate(${rot}deg)`; img.style.margin = r90 ? `${-shift}px ${shift}px` : 'auto';
  stage.classList.toggle('big', !fit && (bw * zoom > stage.clientWidth || bh * zoom > stage.clientHeight));
  $('#imgZoom').textContent = Math.round(zoom * 100) + '%';
}
const setZoom = z => { fit = false; zoom = Math.max(.05, Math.min(16, z)); apply(); };
Viewers.image = async f => {
  fit = true; rot = 0; $('#imgInfo').textContent = fmtSize(f.size);
  await new Promise(res => { img.onload = res; img.onerror = () => { toast('This image could not be displayed.', true); res(); }; img.src = '/api/asset?path=' + enc(f.path); img.alt = f.name; });
  nat = {w: img.naturalWidth || 1, h: img.naturalHeight || 1};
  $('#imgInfo').textContent = `${nat.w} × ${nat.h} px · ${fmtSize(f.size)}`; apply();
};
$('#imgIn').onclick = () => setZoom(zoom * 1.25); $('#imgOut').onclick = () => setZoom(zoom / 1.25);
$('#imgFit').onclick = () => { fit = true; apply(); }; $('#imgActual').onclick = () => setZoom(1);
$('#imgRotate').onclick = () => { rot = (rot + 90) % 360; apply(); };
img.ondblclick = () => { if (fit) setZoom(1); else { fit = true; apply(); } };
stage.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, {passive: false});
new ResizeObserver(() => { if (!P.hidden && fit && nat.w) apply(); }).observe(stage);
document.addEventListener('keydown', e => {
  if (P.hidden || typing() || e.ctrlKey || e.metaKey) return;
  if (e.key === '+' || e.key === '=') $('#imgIn').click(); else if (e.key === '-') $('#imgOut').click();
  else if (e.key === '0') $('#imgFit').click(); else if (e.key === '1') $('#imgActual').click(); else if (e.key === 'r') $('#imgRotate').click();
});
})();
