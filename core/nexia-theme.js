/* NEXIA Theme + Language v4.0 — functional, no mocks */
(function() {
  'use strict';

  const THEME_KEY = 'nx_theme';
  const LANG_KEY = 'nx_lang';

  // ── THEME ────────────────────────────────────────────────────────────────
  function getTheme() { return localStorage.getItem(THEME_KEY) || 'dark'; }
  function setTheme(t) {
    localStorage.setItem(THEME_KEY, t);
    document.documentElement.setAttribute('data-theme', t);
    document.querySelectorAll('[data-nx-theme-icon]').forEach(el => {
      el.className = t === 'dark' ? 'ri-sun-line' : 'ri-moon-line';
    });
    document.querySelectorAll('[data-nx-theme-label]').forEach(el => {
      el.textContent = t === 'dark' ? 'Light' : 'Dark';
    });
  }
  function toggleTheme() { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); }

  // ── LANGUAGE ─────────────────────────────────────────────────────────────
  function getLang() { return localStorage.getItem(LANG_KEY) || 'pt'; }
  function setLang(l) {
    localStorage.setItem(LANG_KEY, l);
    document.documentElement.setAttribute('lang', l === 'pt' ? 'pt-BR' : l);
    document.querySelectorAll('[data-nx-lang]').forEach(el => {
      el.classList.toggle('active', el.dataset.nxLang === l);
    });
    // Dispatch event for pages that listen
    window.dispatchEvent(new CustomEvent('nx:langchange', { detail: { lang: l } }));
  }

  // ── WIDGET INJECTION ─────────────────────────────────────────────────────
  function injectWidget() {
    if (document.getElementById('nx-theme-widget')) return;

    // Remove old inline PT/EN/ES buttons if present
    document.querySelectorAll('.lang-btn, .btn-lang, [onclick*="changeLang"], [onclick*="setLang"]').forEach(el => {
      // Only remove if it's a standalone button, not part of our widget
      if (!el.closest('#nx-theme-widget')) el.style.display = 'none';
    });

    const w = document.createElement('div');
    w.id = 'nx-theme-widget';
    w.style.cssText = `
      position:fixed; bottom:16px; right:16px; z-index:9999;
      display:flex; align-items:center; gap:6px;
      background:var(--bg2); border:1px solid var(--brd2);
      border-radius:12px; padding:6px 10px;
      box-shadow:0 4px 16px rgba(0,0,0,0.12);
      font-family:Inter,system-ui,sans-serif;
      font-size:11px; font-weight:600;
    `;
    const cur = getTheme();
    const curLang = getLang();
    w.innerHTML = `
      <button id="nx-toggle-theme" title="Toggle theme" style="
        width:28px;height:28px;border-radius:7px;border:1px solid var(--brd2);
        background:transparent;color:var(--text2);cursor:pointer;
        display:flex;align-items:center;justify-content:center;font-size:14px;
        transition:all .15s;
      "><i data-nx-theme-icon class="${cur === 'dark' ? 'ri-sun-line' : 'ri-moon-line'}"></i></button>
      <div style="width:1px;height:18px;background:var(--brd2)"></div>
      ${['pt','en','es'].map(l => `
        <button data-nx-lang="${l}" onclick="window.NexiaTheme.setLang('${l}')" style="
          padding:3px 7px;border-radius:6px;border:1px solid ${l === curLang ? 'var(--cyanbrd)' : 'transparent'};
          background:${l === curLang ? 'var(--cyanlt)' : 'transparent'};
          color:${l === curLang ? 'var(--cyan)' : 'var(--text3)'};
          cursor:pointer;font-size:10px;font-weight:700;font-family:inherit;
          transition:all .15s; text-transform:uppercase;
        ">${l.toUpperCase()}</button>
      `).join('')}
    `;
    document.body.appendChild(w);

    document.getElementById('nx-toggle-theme').addEventListener('click', toggleTheme);
  }

  // ── APPLY ON LOAD ─────────────────────────────────────────────────────────
  function apply() {
    setTheme(getTheme());
    const l = getLang();
    document.documentElement.setAttribute('lang', l === 'pt' ? 'pt-BR' : l);
    injectWidget();
  }

  // ── PUBLIC API ────────────────────────────────────────────────────────────
  window.NexiaTheme = { toggleTheme, setTheme, getTheme, setLang, getLang };
  // Backward compat
  window.toggleTheme = toggleTheme;
  window.changeLang = function(l) { setLang(l); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
})();
