/* Accessibility settings menu. No tracking, no third parties: choices stay in this browser (localStorage 'a11y').
   Skin it with CSS variables (--a11y-*) on the page. Open with any element that has [data-a11y-open]. */
(function () {
  var d = document.documentElement, me = document.currentScript, KEY = 'a11y';
  var FONT = (me && me.getAttribute('data-font')) || '/fonts/atkinson.css';
  var T = (me && me.getAttribute('data-title')) || 'Accessibility';
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function mq(q) { return !!(window.matchMedia && matchMedia(q).matches); }
  var SW = [
    ['contrast', 'High contrast', 'Stronger text and border colours.', 'high', 'normal'],
    ['motion', 'Reduce motion', 'Stops blinking, animation and transitions.', 'reduce', 'full'],
    ['font', 'Readable font', 'Switches to Atkinson Hyperlegible.', 'readable', 'default'],
    ['cb', 'Colour-blind safe colours', 'Blue/orange instead of green/red, plus shape cues.', 'on', ''],
    ['space', 'Bigger buttons and spacing', 'Larger tap targets, more line and letter spacing.', 'on', ''],
    ['links', 'Underline links', 'Every link is underlined.', 'on', ''],
    ['tables', 'Show charts as tables', 'Adds a plain table under each chart.', 'on', '']
  ];
  var OMIT = ((me && me.getAttribute('data-omit')) || '').split(',');
  SW = SW.filter(function (x) { return OMIT.indexOf(x[0]) < 0; });
  function cur(k) { var v = d.getAttribute('data-a11y-' + k); return v; }
  function fontLink() {
    if (cur('font') === 'readable' && !document.getElementById('a11y-font')) {
      var l = document.createElement('link'); l.id = 'a11y-font'; l.rel = 'stylesheet'; l.href = FONT; document.head.appendChild(l);
    }
  }
  function apply(k, v) { if (v) d.setAttribute('data-a11y-' + k, v); else d.removeAttribute('data-a11y-' + k); if (k === 'font') fontLink(); }
  fontLink();
  // Follow OS changes for settings the visitor hasn't chosen.
  [['contrast', '(prefers-contrast: more)', 'high', 'normal'], ['motion', '(prefers-reduced-motion: reduce)', 'reduce', 'full']].forEach(function (a) {
    if (!window.matchMedia) return; var m = matchMedia(a[1]);
    if (m.addEventListener) m.addEventListener('change', function () { if (!(a[0] in load())) { apply(a[0], m.matches ? a[2] : a[3]); sync(); } });
  });
  var css = '#a11y-dlg{max-width:min(34rem,calc(100vw - 1.5rem));width:100%;max-height:calc(100dvh - 1.5rem);overflow:auto;padding:0;border:var(--a11y-border,2px solid #000);border-radius:var(--a11y-radius,12px);background:var(--a11y-bg,#fff);color:var(--a11y-fg,#111);box-shadow:var(--a11y-shadow,0 10px 40px rgba(0,0,0,.35));font:inherit}'
    + '#a11y-dlg::backdrop{background:rgba(0,0,0,.6)}#a11y-dlg .a11y-in{padding:1rem 1.2rem 1.2rem}'
    + '#a11y-dlg h2{margin:0 0 .2rem;font-size:1.3rem;color:inherit}#a11y-dlg .a11y-sub{margin:0 0 1rem;font-size:.9rem;color:var(--a11y-muted,#444)}'
    + '#a11y-dlg fieldset{border:0;margin:0 0 .8rem;padding:0}#a11y-dlg legend{font-weight:700;margin-bottom:.4rem;padding:0}'
    + '#a11y-dlg .a11y-seg{display:flex;gap:.4rem;flex-wrap:wrap}#a11y-dlg .a11y-seg label{position:relative}'
    + '#a11y-dlg .a11y-seg input{position:absolute;opacity:0;inset:0;margin:0}'
    + '#a11y-dlg .a11y-seg span{display:inline-flex;align-items:center;justify-content:center;min-width:3rem;min-height:2.75rem;padding:0 .8rem;border:2px solid var(--a11y-ctl,#555);border-radius:var(--a11y-ctl-radius,8px);font-weight:700;cursor:pointer;background:var(--a11y-ctl-bg,transparent)}'
    + '#a11y-dlg .a11y-seg input:checked+span{background:var(--a11y-on,#0b57d0);border-color:var(--a11y-on,#0b57d0);color:var(--a11y-on-fg,#fff)}'
    + '#a11y-dlg .a11y-seg input:checked+span::before{content:"\\2713\\00a0"}'
    + '#a11y-dlg .a11y-seg input:focus-visible+span{outline:3px solid var(--a11y-focus,#0b57d0);outline-offset:3px}'
    + '#a11y-dlg .a11y-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.55rem 0;border-top:1px solid var(--a11y-line,#ccc)}'
    + '#a11y-dlg .a11y-row small{display:block;color:var(--a11y-muted,#444);font-size:.85rem}'
    + '#a11y-dlg [role=switch]{flex:none;min-width:5rem;min-height:2.75rem;border:2px solid var(--a11y-ctl,#555);border-radius:var(--a11y-ctl-radius,8px);background:var(--a11y-ctl-bg,transparent);color:inherit;font:inherit;font-weight:700;cursor:pointer;padding:0 .7rem}'
    + '#a11y-dlg [role=switch][aria-checked=true]{background:var(--a11y-on,#0b57d0);border-color:var(--a11y-on,#0b57d0);color:var(--a11y-on-fg,#fff)}'
    + '#a11y-dlg [role=switch]::before{content:"\\25CB\\00a0OFF"}#a11y-dlg [role=switch][aria-checked=true]::before{content:"\\25CF\\00a0ON"}'
    + '#a11y-dlg .a11y-act{display:flex;gap:.6rem;justify-content:flex-end;margin-top:1rem;flex-wrap:wrap}'
    + '#a11y-dlg .a11y-act button{min-height:2.75rem;padding:0 1.1rem;font:inherit;font-weight:700;cursor:pointer;border-radius:var(--a11y-ctl-radius,8px);border:2px solid var(--a11y-ctl,#555);background:var(--a11y-ctl-bg,transparent);color:inherit}'
    + '#a11y-dlg .a11y-act .a11y-done{background:var(--a11y-on,#0b57d0);border-color:var(--a11y-on,#0b57d0);color:var(--a11y-on-fg,#fff)}'
    + '#a11y-dlg .a11y-kick{margin:0;font-size:.75rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--a11y-muted,#444)}'
    + '#a11y-dlg .a11y-hint{margin-right:auto;align-self:center;font-size:.8rem;color:var(--a11y-muted,#444)}#a11y-dlg kbd{font:inherit;font-weight:700;border:1px solid currentColor;border-radius:3px;padding:0 .25rem}'
    + '#a11y-dlg .a11y-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}'
    + '#a11y-dlg button:focus-visible{outline:3px solid var(--a11y-focus,#0b57d0);outline-offset:3px}';
  var dlg, opener;
  function build() {
    var st = document.createElement("style"); st.textContent = css; document.head.insertBefore(st, document.head.firstChild); // first, so page skins win
    dlg = document.createElement('dialog'); dlg.id = 'a11y-dlg'; dlg.setAttribute('aria-labelledby', 'a11y-t'); dlg.setAttribute('aria-describedby', 'a11y-s');
    var h = '<div class="a11y-in"><p class="a11y-kick" aria-hidden="true">Options &#9656;</p><h2 id="a11y-t">' + T + '</h2><p class="a11y-sub" id="a11y-s">Changes apply right away and are saved in this browser only.</p>'
      + '<fieldset><legend>Text size</legend><div class="a11y-seg">'
      + [['s', 'S', 'Small'], ['m', 'M', 'Medium'], ['l', 'L', 'Large'], ['xl', 'XL', 'Extra large']].map(function (o) { return '<label><input type="radio" name="a11y-size" value="' + o[0] + '"><span>' + o[1] + '<em class="a11y-sr"> ' + o[2].toLowerCase() + '</em></span></label>'; }).join('') + '</div></fieldset>';
    SW.forEach(function (s) { h += '<div class="a11y-row"><span><span id="a11y-l-' + s[0] + '">' + s[1] + '</span><small id="a11y-h-' + s[0] + '">' + s[2] + '</small></span><button type="button" role="switch" data-k="' + s[0] + '" aria-labelledby="a11y-l-' + s[0] + '" aria-describedby="a11y-h-' + s[0] + '"></button></div>'; });
    h += '<div class="a11y-act"><span class="a11y-hint" aria-hidden="true"><kbd>Tab</kbd> move &middot; <kbd>Space</kbd> toggle &middot; <kbd>Esc</kbd> back</span><button type="button" class="a11y-reset">Reset to defaults</button><button type="button" class="a11y-done">Done</button></div></div>';
    dlg.innerHTML = h; document.body.appendChild(dlg);
    dlg.addEventListener('change', function (e) { if (e.target.name === 'a11y-size') { var s = load(); s.size = e.target.value; save(s); apply('size', e.target.value); } });
    dlg.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) { if (e.target === dlg) close(); return; }
      if (b.classList.contains('a11y-done')) return close();
      if (b.classList.contains('a11y-reset')) { save({}); apply('size', 'm'); apply('contrast', mq('(prefers-contrast: more)') ? 'high' : 'normal'); apply('motion', mq('(prefers-reduced-motion: reduce)') ? 'reduce' : 'full'); ['cb', 'space', 'links', 'tables'].forEach(function (k) { apply(k, ''); }); apply('font', 'default'); return sync(); }
      var k = b.getAttribute('data-k'); if (!k) return;
      var sw = SW.filter(function (x) { return x[0] === k; })[0], on = b.getAttribute('aria-checked') !== 'true', v = on ? sw[3] : sw[4];
      var s = load(); s[k] = v; save(s); apply(k, v); sync();
    });
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    dlg.addEventListener('keydown', function (e) { // keep Tab inside the menu
      if (e.key !== 'Tab') return;
      var f = dlg.querySelectorAll('input:checked, button'), a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { z.focus(); e.preventDefault(); } else if (!e.shiftKey && document.activeElement === z) { a.focus(); e.preventDefault(); }
    });
  }
  function sync() {
    if (!dlg) return;
    var sz = cur('size') || 'm'; dlg.querySelectorAll('input[name=a11y-size]').forEach(function (i) { i.checked = i.value === sz; });
    SW.forEach(function (s) { dlg.querySelector('[data-k=' + s[0] + ']').setAttribute('aria-checked', cur(s[0]) === s[3] ? 'true' : 'false'); });
  }
  function open(e) {
    if (e) e.preventDefault(); if (!dlg) build(); sync(); opener = document.activeElement;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    (dlg.querySelector('input:checked') || dlg.querySelector('button')).focus();
  }
  function close() { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); if (opener && opener.focus) opener.focus(); }
  document.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-a11y-open]'); if (t) open(e); });
  window.a11yOpen = open;
  if (location.hash === '#accessibility') open();
})();
