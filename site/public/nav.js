// Header menu. With this script, groups open on click and the narrow layout
// uses a hamburger. Without it, the stylesheet leaves every link visible.
(function () {
  var root = document.documentElement;
  var mq = window.matchMedia('(max-width: 899px)');
  var scrollY = 0;

  function isMobile() {
    return mq.matches;
  }

  function eventTarget(event) {
    var t = event.target;
    if (!t) return null;
    if (t.nodeType === 1) return t;
    return t.parentElement;
  }

  function visible(el) {
    return !!(el && el.getClientRects && el.getClientRects().length);
  }

  function navEl() {
    return document.querySelector('[data-site-nav]');
  }

  function toggleEl() {
    return document.querySelector('[data-nav-toggle]');
  }

  function groups() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-nav-group]'));
  }

  function placePanel() {
    var bar = document.querySelector('[data-site-bar]');
    if (!bar) return;
    var bottom = bar.getBoundingClientRect().bottom;
    root.style.setProperty('--site-bar-bottom', Math.max(0, Math.round(bottom)) + 'px');
  }

  function lockPage(on) {
    if (on) {
      scrollY = window.scrollY || root.scrollTop || 0;
      root.classList.add('nav-lock');
      document.body.style.top = '-' + scrollY + 'px';
      return;
    }
    root.classList.remove('nav-lock');
    document.body.style.top = '';
    window.scrollTo(0, scrollY);
  }

  function closeGroups() {
    groups().forEach(function (group) {
      group.classList.remove('is-open');
      var btn = group.querySelector('[data-nav-group-btn]');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }

  function openGroup(btn) {
    var group = btn.closest('[data-nav-group]');
    if (!group) return;
    closeGroups();
    group.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
  }

  function setMenu(open, opts) {
    opts = opts || {};
    var toggle = toggleEl();
    var nav = navEl();
    if (toggle) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }
    if (nav) nav.classList.toggle('is-open', open);
    root.classList.toggle('nav-open', open);
    if (open && isMobile()) {
      placePanel();
      lockPage(true);
      if (opts.focus !== false) {
        var first = nav && nav.querySelector('a');
        if (first) first.focus();
      }
      return;
    }
    lockPage(false);
    closeGroups();
    if (!open && opts.focusToggle && toggle) toggle.focus();
  }

  function topItems() {
    var nav = navEl();
    if (!nav) return [];
    return Array.prototype.filter.call(
      nav.querySelectorAll('[data-nav-group-btn], [data-nav-about], [data-nav-cta]'),
      visible
    );
  }

  function panelLinks(panel) {
    if (!panel) return [];
    return Array.prototype.filter.call(panel.querySelectorAll('a'), visible);
  }

  function moveFocus(items, delta, event) {
    if (!items.length) return;
    var i = items.indexOf(document.activeElement);
    if (i < 0) i = delta > 0 ? -1 : 0;
    var next = items[(i + delta + items.length) % items.length];
    event.preventDefault();
    next.focus();
  }

  function onClick(event) {
    var t = eventTarget(event);
    if (!t || !t.closest) return;
    var toggle = t.closest('[data-nav-toggle]');
    if (toggle) {
      setMenu(toggle.getAttribute('aria-expanded') !== 'true');
      return;
    }
    var groupBtn = t.closest('[data-nav-group-btn]');
    if (groupBtn && !isMobile()) {
      var wasOpen = groupBtn.getAttribute('aria-expanded') === 'true';
      closeGroups();
      if (!wasOpen) openGroup(groupBtn);
      return;
    }
    if (!t.closest('[data-site-nav]')) {
      closeGroups();
      if (isMobile() && root.classList.contains('nav-open')) setMenu(false);
      return;
    }
    if (!isMobile() && t.closest('a')) closeGroups();
    if (isMobile() && t.closest('a')) setMenu(false);
  }

  function onKey(event) {
    var nav = navEl();
    if (!nav) return;
    var active = document.activeElement;
    if (event.key === 'Escape') {
      if (!isMobile()) {
        var openBtn = document.querySelector('[data-nav-group].is-open [data-nav-group-btn]');
        if (openBtn) {
          closeGroups();
          openBtn.focus();
          event.preventDefault();
        }
        return;
      }
      if (root.classList.contains('nav-open')) {
        setMenu(false, { focusToggle: true });
        event.preventDefault();
      }
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    if (!nav.contains(active) && active !== toggleEl()) return;

    if (isMobile()) {
      if (!root.classList.contains('nav-open')) return;
      var mobileItems = [toggleEl()].concat(Array.prototype.filter.call(nav.querySelectorAll('a'), visible)).filter(Boolean);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') moveFocus(mobileItems, event.key === 'ArrowDown' ? 1 : -1, event);
      if (event.key === 'Home') { event.preventDefault(); mobileItems[0].focus(); }
      if (event.key === 'End') { event.preventDefault(); mobileItems[mobileItems.length - 1].focus(); }
      return;
    }

    var groupBtn = active.closest && active.closest('[data-nav-group-btn]');
    var panel = active.closest && active.closest('[data-nav-panel]');
    var top = active.matches && (groupBtn || active.matches('[data-nav-about], [data-nav-cta]'));

    if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && top) {
      closeGroups();
      moveFocus(topItems(), event.key === 'ArrowRight' ? 1 : -1, event);
      return;
    }
    if ((event.key === 'Home' || event.key === 'End') && top) {
      var items = topItems();
      if (!items.length) return;
      event.preventDefault();
      closeGroups();
      items[event.key === 'Home' ? 0 : items.length - 1].focus();
      return;
    }
    if (event.key === 'ArrowDown' && groupBtn) {
      openGroup(groupBtn);
      var links = panelLinks(groupBtn.closest('[data-nav-group]').querySelector('[data-nav-panel]'));
      if (links[0]) {
        event.preventDefault();
        links[0].focus();
      }
      return;
    }
    if (panel && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End')) {
      var inPanel = panelLinks(panel);
      if (event.key === 'Home') { event.preventDefault(); inPanel[0].focus(); return; }
      if (event.key === 'End') { event.preventDefault(); inPanel[inPanel.length - 1].focus(); return; }
      var index = inPanel.indexOf(active);
      if (event.key === 'ArrowUp' && index <= 0) {
        var back = panel.closest('[data-nav-group]').querySelector('[data-nav-group-btn]');
        event.preventDefault();
        if (back) back.focus();
        return;
      }
      moveFocus(inPanel, event.key === 'ArrowDown' ? 1 : -1, event);
    }
  }

  function onFocusIn(event) {
    if (isMobile()) return;
    var open = document.querySelector('[data-nav-group].is-open');
    if (!open) return;
    var t = event.target;
    if (t && open.contains(t)) return;
    closeGroups();
  }

  function onViewport() {
    closeGroups();
    if (!isMobile() && root.classList.contains('nav-open')) setMenu(false);
    else if (isMobile() && root.classList.contains('nav-open')) placePanel();
  }

  function keepBackgroundStill(event) {
    if (!root.classList.contains('nav-lock')) return;
    var nav = navEl();
    var t = eventTarget(event);
    if (nav && t && nav.contains(t)) return;
    event.preventDefault();
  }

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('touchmove', keepBackgroundStill, { passive: false });
  document.addEventListener('wheel', keepBackgroundStill, { passive: false });
  window.addEventListener('resize', onViewport);
  if (mq.addEventListener) mq.addEventListener('change', onViewport);
  else if (mq.addListener) mq.addListener(onViewport);

  root.classList.add('nav-js');
})();
