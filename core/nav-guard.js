/**
 * NEXIA OS — NAV GUARD v1.1
 * Enforces single-tab navigation for all internal routes.
 * External links (http/https to other domains), downloads, and WA keep _blank.
 * v1.1: saves redirect_after_login before bouncing to /login
 */
(function() {
  'use strict';

  // FIX: Singleton guard — prevents duplicate execution when nav-guard.js
  // is loaded by multiple pages sharing the same context (causes 3x log spam)
  if (window._nexiaNavGuardActive) return;
  window._nexiaNavGuardActive = true;
  const INTERNAL_PREFIXES = [
    '/nexia/', '/ces/', '/viajante-pro/', '/bezsan/', '/splash/',
    '/login', '/index.html', '/flow', '/store', '/sentinel',
    '/cortex', '/studio', '/pabx', '/my-panel', '/architect'
  ];

  // Map of path patterns → redirect_after_login keys (for pages that auth.js protects)
  const REDIRECT_KEY_MAP = [
    { pattern: /\/nexia\/cortex/,        key: 'cortex' },
    { pattern: /\/nexia\/flow/,           key: 'flow' },
    { pattern: /\/nexia\/strike-center/,  key: 'strike-center' },
    { pattern: /\/nexia\/nexia-striker/,  key: 'striker' },
    { pattern: /\/nexia\/studio/,         key: 'studio' },
    { pattern: /\/nexia\/sentinel/,       key: 'sentinel' },
    { pattern: /\/nexia\/swarm/,          key: 'swarm' },
    { pattern: /\/nexia\/pabx/,           key: 'pabx' },
    { pattern: /\/nexia\/pki/,            key: 'pki' },
    { pattern: /\/nexia\/osint/,          key: 'osint' },
    { pattern: /\/nexia\/nexia-pay/,      key: 'pay' },
    { pattern: /\/nexia\/nexia-store/,    key: 'store' },
    { pattern: /\/nexia\/architect/,      key: 'architect' },
    { pattern: /\/nexia\/social-media/,   key: 'social-media' },
    { pattern: /\/nexia\/my-panel/,       key: 'my-panel' },
    { pattern: /\/nexia\/tenant-hub/,     key: 'tenant-hub' },
    { pattern: /\/nexia\/nexia-master/,   key: 'master-admin' },
    { pattern: /\/nexia\/qa-test-center/, key: 'qa-test-center' },
  ];

  const EXTERNAL_ALLOW_LIST = ['wa.me', 'api.whatsapp.com', 'sympla.com.br', 'invideo.io'];

  function isInternal(href) {
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return false;
    if (href.startsWith('/')) return true;
    try {
      const url = new URL(href, window.location.origin);
      if (url.origin === window.location.origin) return true;
      if (EXTERNAL_ALLOW_LIST.some(d => url.hostname.includes(d))) return false;
    } catch(e) { /* relative */ return true; }
    return false;
  }

  // Save redirect_after_login when the app is bouncing the user to /login
  // This is triggered by auth.js calling window.location.href = '/login'
  // We intercept location changes via a patched setter
  (function patchLocationRedirect() {
    const desc = Object.getOwnPropertyDescriptor(window.location, 'href');
    // Only patch if configurable (some browsers block this) — degrade gracefully
    try {
      const origAssign = window.location.assign.bind(window.location);
      window.location.assign = function(url) {
        _maybeSetRedirect(url);
        origAssign(url);
      };
    } catch(_) {}
  })();

  function _maybeSetRedirect(targetUrl) {
    if (!targetUrl) return;
    const norm = targetUrl.startsWith('/') ? targetUrl : (function() {
      try { return new URL(targetUrl, window.location.origin).pathname; } catch(_) { return ''; }
    })();
    if (!norm.startsWith('/login')) return; // only relevant when bouncing to login
    const current = window.location.pathname;
    for (const { pattern, key } of REDIRECT_KEY_MAP) {
      if (pattern.test(current)) {
        localStorage.setItem('redirect_after_login', key);
        return;
      }
    }
  }

  // Intercept all clicks on <a target="_blank"> for internal routes
  document.addEventListener('click', function(e) {
    const a = e.target.closest('a[target="_blank"]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (isInternal(href)) {
      e.preventDefault();
      window.location.href = href;
    }
  }, true);

  // Patch window.open globally — redirect internal calls to location.href
  const _nativeOpen = window.open.bind(window);
  window.open = function(url, target, features) {
    if (url && isInternal(url)) {
      window.location.href = url;
      return window;
    }
    return _nativeOpen(url, target, features);
  };

  if (window._nexiaDebug) console.log('[NAV-GUARD] Single-tab navigation enforced ✓');
})();
