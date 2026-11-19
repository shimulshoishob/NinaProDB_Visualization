/* Shared interface components: dialogs (confirm / prompt), menus, tooltips.
   They replace the browser's confirm() and prompt() so every overlay looks, moves and behaves the same,
   traps focus, closes with Esc and returns focus to where you were. */
const UI = (() => {
  const FOCUSABLE = 'button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

  /* ---------------- dialog ---------------- */
  function dialog({title, message = '', html = '', input = null, confirm = 'OK', cancel = 'Cancel', danger = false}) {
    return new Promise(resolve => {
      const prev = document.activeElement, id = 'dlg' + Math.random().toString(36).slice(2, 7);
      const scrim = document.createElement('div'); scrim.className = 'dlg-scrim';
      scrim.innerHTML = `<div class="dlg" role="${input ? 'dialog' : 'alertdialog'}" aria-modal="true" aria-labelledby="${id}t" aria-describedby="${id}d">
        <h2 id="${id}t">${esc(title)}</h2>${html ? `<div id="${id}d" class="dlg-body">${html}</div>` : message ? `<p id="${id}d">${esc(message)}</p>` : `<p id="${id}d" hidden></p>`}
        ${input ? `<input type="${input.password ? 'password' : 'text'}" value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}" aria-label="${esc(input.label || title)}" spellcheck="false">` : ''}
        <div class="acts">${cancel ? `<button class="btn" data-a="cancel">${esc(cancel)}</button>` : ''}<button class="btn primary${danger ? ' danger' : ''}" data-a="ok">${esc(confirm)}</button></div></div>`;
      document.body.appendChild(scrim);
      const box = scrim.firstElementChild, field = box.querySelector('input');
      const done = value => {
        document.removeEventListener('keydown', onKey, true);
        scrim.classList.add('out'); setTimeout(() => scrim.remove(), 120);
        if (prev && prev.focus) prev.focus();
        resolve(value);
      };
      const ok = () => done(field ? field.value : true), no = () => done(field ? null : false);
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); no(); }
        else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); ok(); }
        else if (e.key === 'Tab') {                                        // keep focus inside the dialog
          const items = [...box.querySelectorAll(FOCUSABLE)], first = items[0], last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      document.addEventListener('keydown', onKey, true);
      scrim.addEventListener('mousedown', e => { if (e.target === scrim) no(); });
      box.querySelector('[data-a=ok]').onclick = ok;
      const c = box.querySelector('[data-a=cancel]'); if (c) c.onclick = no;
      (field || (danger && c) || box.querySelector('[data-a=ok]')).focus();
      if (field) field.select();
    });
  }
  const confirmDialog = (message, opts = {}) => dialog({title: opts.title || 'Are you sure?', message, confirm: opts.confirm || 'OK', cancel: opts.cancel === undefined ? 'Cancel' : opts.cancel, danger: !!opts.danger});
  const promptDialog = (title, value = '', opts = {}) => dialog({title, message: opts.message || '', input: {value, label: opts.label, placeholder: opts.placeholder, password: opts.password}, confirm: opts.confirm || 'OK'});

  /* ---------------- menu ---------------- */
  let openMenu = null;
  function closeMenu() { if (!openMenu) return; const {el, off, anchor} = openMenu; openMenu = null; off(); el.remove(); if (anchor && anchor.focus) anchor.focus(); }
  /* items: {label, icon, hint, checked, danger, disabled, onClick} | {sep: true} | {heading: 'Text'} */
  function menu(anchor, items, {align = 'right'} = {}) {
    closeMenu();
    const el = document.createElement('div'); el.className = 'menu'; el.setAttribute('role', 'menu');
    el.innerHTML = items.map((it, i) => it.sep ? '<div class="menu-sep" role="separator"></div>' : it.heading ? `<div class="menu-label">${esc(it.heading)}</div>` :
      `<button class="menu-item${it.danger ? ' danger' : ''}" role="menuitem${it.checked !== undefined ? 'checkbox' : ''}" ${it.checked !== undefined ? `aria-checked="${!!it.checked}"` : ''} data-i="${i}" ${it.disabled ? 'disabled' : ''}>
        ${it.checked !== undefined ? `<span class="tick">${it.checked ? icon('check') : ''}</span>` : (it.icon ? icon(it.icon) : '')}<span>${esc(it.label)}</span>${it.hint ? `<span class="hint">${esc(it.hint)}</span>` : ''}</button>`).join('');
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : {left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y};
    const mw = el.offsetWidth, mh = el.offsetHeight;
    let left = align === 'right' ? r.right - mw : r.left, top = r.bottom + 6;
    if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    el.style.left = Math.max(8, Math.min(left, innerWidth - mw - 8)) + 'px'; el.style.top = top + 'px';
    const buttons = () => [...el.querySelectorAll('.menu-item:not(:disabled)')];
    const run = b => { const it = items[+b.dataset.i]; closeMenu(); if (it && it.onClick) it.onClick(); };
    el.onclick = e => { const b = e.target.closest('.menu-item'); if (b) run(b); };
    const onKey = e => {
      const b = buttons(), i = b.indexOf(document.activeElement);
      if (!['Escape', 'ArrowDown', 'ArrowUp', 'Tab', 'Enter', ' '].includes(e.key)) return;
      e.stopPropagation();                      // while a menu is open, keys belong to the menu only
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); b[(i + 1) % b.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); b[(i - 1 + b.length) % b.length].focus(); }
      else if (e.key === 'Tab') { e.preventDefault(); closeMenu(); }
    };
    const onDown = e => { if (!el.contains(e.target) && !(anchor.contains && anchor.contains(e.target))) closeMenu(); };
    document.addEventListener('keydown', onKey, true); document.addEventListener('mousedown', onDown, true); addEventListener('resize', closeMenu, {once: true});
    openMenu = {el, anchor: anchor.focus ? anchor : null, off: () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onDown, true); }};
    (buttons()[0] || el).focus();
    return el;
  }

  /* ---------------- tooltips: the native title="" attribute, shown in the app's own style ---------------- */
  let tip = null, timer = 0, held = null;
  const hideTip = () => { clearTimeout(timer); tip?.remove(); tip = null; if (held) { held.el.setAttribute('title', held.text); held = null; } };
  function showTip(el, immediate) {
    const text = el.getAttribute('title'); if (!text || held) return;
    if (!el.getAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', text);     // keep the accessible name
    const go = () => {
      if (!document.contains(el)) return;
      held = {el, text}; el.removeAttribute('title');
      tip = document.createElement('div'); tip.className = 'ui-tip'; tip.setAttribute('role', 'tooltip'); tip.textContent = text; document.body.appendChild(tip);
      const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
      let top = r.bottom + 8; if (top + h > innerHeight - 6) top = r.top - h - 8;
      tip.style.top = Math.max(6, top) + 'px'; tip.style.left = Math.max(6, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 6)) + 'px';
    };
    immediate ? go() : (timer = setTimeout(go, 550));
  }
  function initTips() {
    if (!matchMedia('(hover:hover)').matches) return;                      // touch screens keep the native behaviour
    document.addEventListener('mouseover', e => { const el = e.target.closest && e.target.closest('[title]'); if (el && !(held && held.el === el)) { hideTip(); showTip(el); } else if (!el) hideTip(); });
    document.addEventListener('mouseout', e => { if (held && !held.el.contains(e.relatedTarget)) hideTip(); else if (!held) clearTimeout(timer); });
    document.addEventListener('mousedown', hideTip, true); document.addEventListener('keydown', hideTip, true); document.addEventListener('scroll', hideTip, true);
    document.addEventListener('focusin', e => { if (e.target.matches && e.target.matches(':focus-visible') && e.target.getAttribute('title')) { hideTip(); showTip(e.target, true); } });
    document.addEventListener('focusout', hideTip);
  }

  const info = (title, html) => dialog({title, html, confirm: 'Close', cancel: ''});

  return {confirm: confirmDialog, prompt: promptDialog, info, menu, closeMenu, initTips};
})();
