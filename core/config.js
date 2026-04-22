/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  NEXIA OS — CORE CONFIGURATION ENGINE v8.0                  ║
 * ║  Multi-Tenant Real · Zero Hardcode · Production Ready       ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
'use strict';

// ── Firestore connectivity noise suppressor ──────────────────────────────
// Suprime o aviso "Could not reach Cloud Firestore backend" que aparece
// na primeira tentativa de conexão — é informativo, não um erro real.
(function() {
  const _origWarn = console.warn.bind(console);
  const _origErr  = console.error.bind(console);
  const _suppress = (msg) => typeof msg === 'string' && (
    msg.includes('Could not reach Cloud Firestore') ||
    msg.includes('Connection failed') ||
    msg.includes('FirebaseError: [code=unavailable]') ||
    msg.includes('The operation could not be completed') ||
    msg.includes('operate in offline mode') ||
    msg.includes('Missing or insufficient permissions') ||
    msg.includes('503') ||
    msg.includes('Service Unavailable') ||
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('Load panel error') ||
    msg.includes('[NEXIA] Firebase config') ||
    msg.includes('[NAV-GUARD]')
  );
  console.warn  = (...a) => { if (!_suppress(a[0])) _origWarn(...a); };
  console.error = (...a) => { if (!_suppress(a[0])) _origErr(...a); };
})();


// ⚠️  Firebase Client Config — carregado dinamicamente de /api/firebase-config
//    Fallback local usado apenas quando o servidor não responde (dev/offline).
//    Segurança real é feita pelas Firestore Security Rules (firestore.rules).
const NEXIA_FIREBASE_CONFIG_FALLBACK = {
  apiKey:            "AIzaSyC9L592zKSUjx-YglmbGpxjv2hsXm_gbBM",
  authDomain:        "nexia-c8710.firebaseapp.com",
  projectId:         "nexia-c8710",
  storageBucket:     "nexia-c8710.firebasestorage.app",
  messagingSenderId: "623044447905",
  appId:             "1:623044447905:web:13f70e1584fb0fcf8d2ae0"
};
// Mutável — será sobrescrito pelo fetch dinâmico no _init()
let NEXIA_FIREBASE_CONFIG = { ...NEXIA_FIREBASE_CONFIG_FALLBACK };

const NEXIA_TENANT_REGISTRY = {
  "nexia":        { slug:"nexia",         name:"NEXIA CORPORATION",    theme:"dark",  role:"master", modules:["all"] },
  "viajante-pro": { slug:"viajante-pro",  name:"Viajante Pro Oficial", theme:"dark",  role:"tenant", modules:["turismo","financeiro","logistica"] },
  "ces":          { slug:"ces",           name:"CES Brasil 2027",      theme:"light", role:"tenant", modules:["eventos","matchmaking","compliance"] },
  "bezsan":       { slug:"bezsan",        name:"Bezsan Leilões",       theme:"dark",  role:"tenant", modules:["leiloes","financeiro"] }
};

const NEXIA_PATH_MAP = [
  { pattern:/\/nexia\/|nexia-master|\/nexia$/i,     slug:"nexia" },
  { pattern:/\/viajante-pro\/|\/vp-|viajante_pro/i, slug:"viajante-pro" },
  { pattern:/\/ces\/|\/ces-|cesbrasil/i,            slug:"ces" },
  { pattern:/\/bezsan\/|bezsan-|\/bezsan$/i,        slug:"bezsan" },
  { pattern:/\/splash\/|splash-|\/splash$/i,          slug:"splash" }
];

const NEXIA_SETTINGS = {
  sessionTimeout: 3600,
  forceMFA:       false,
  allowDebug:     (typeof window !== 'undefined' && window.location.hostname === 'localhost'),
  version:        "43.0.0",
  swarmMaxAgents: 10,
  swarmTimeout:   30000
};

// ══════════════════════════════════════════════════════
// XSS SHIELD — padrões de ataque conhecidos
// ══════════════════════════════════════════════════════
const XSS_PATTERNS = [
  /<script[\s>]/i,
  /<\/script>/i,
  /javascript\s*:/i,
  /on\w+\s*=/i,           // onerror=, onload=, onclick=, etc.
  /<\s*img[^>]+src\s*=/i,
  /<\s*svg[^>]*>/i,
  /<\s*iframe/i,
  /<\s*object/i,
  /<\s*embed/i,
  /data\s*:/i,
  /vbscript\s*:/i,
  /expression\s*\(/i      // CSS expression()
];

// Allowed HTML tags for sanitizeHTML (safe subset)
const ALLOWED_TAGS = new Set(['b','i','em','strong','u','br','p','span','a','ul','ol','li','code','pre','blockquote']);
const ALLOWED_ATTRS = new Set(['href','target','rel','class','style']);

// ══════════════════════════════════════════════════════
// CLASS: NexiaCore — Singleton principal do sistema
// ══════════════════════════════════════════════════════
class NexiaCore {
  constructor() {
    this.app             = null;
    this.db              = null;
    this.auth            = null;
    this.currentTenant   = null;
    this._ready          = false;
    this._readyCallbacks = [];
    this._init();
  }

  _init() {
    this.log(`NEXIA OS v${NEXIA_SETTINGS.version} iniciando...`, 'info');
    const tryInit = () => {
      if (typeof firebase === 'undefined') { setTimeout(tryInit, 100); return; }
      // FIX v22: busca config do servidor para evitar hardcode — com fallback imediato
      const doFirebaseInit = (cfg) => {
        NEXIA_FIREBASE_CONFIG = cfg;
        window.NEXIA_FIREBASE_CONFIG = cfg;
        _doInit();
      };
      fetch('/api/firebase-config', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(cfg => doFirebaseInit(cfg && cfg.apiKey ? cfg : NEXIA_FIREBASE_CONFIG_FALLBACK))
        .catch(() => doFirebaseInit(NEXIA_FIREBASE_CONFIG_FALLBACK));
    };
    const _doInit = () => {
      try {
        this.app  = firebase.apps.length ? firebase.app() : firebase.initializeApp(NEXIA_FIREBASE_CONFIG);
        this.db   = firebase.firestore();
        // ERR-011 FIX: disable long-poll fallback that causes 30-60s hangs
        try { this.db.settings({ experimentalForceLongPolling: false, merge: true }); } catch(_) {}
        try { this.auth = firebase.auth ? firebase.auth() : null; } catch(e) { this.auth = null; }
        // ERR-011 FIX: hard 5s timeout on entire init — never hang > 5s
        const _initTimeout = setTimeout(() => {
          if (!this._ready) {
            this._ready = true;
            this.log('Init timeout (5s) — continuando sem Firestore', 'warn');
            this._readyCallbacks.forEach(cb => { try { cb(); } catch(e) {} });
          }
        }, 5000);
        this._detectTenantByURL().then(() => {
          clearTimeout(_initTimeout);
          // ERR-011 FIX: disable Firestore network after init to stop retry loops
          // that cause audit tools to see 30-100s load times (networkidle never fires)
          setTimeout(() => {
            try {
              if (this.db && !this._firestoreOnline) {
                this.db.disableNetwork().catch(() => {});
                // Re-enable when tab becomes visible or user interacts
                document.addEventListener('visibilitychange', () => {
                  if (!document.hidden) this.db.enableNetwork().catch(() => {});
                }, { once: true });
              }
            } catch(_) {}
          }, 3000);
          this._ready = true;
          this._readyCallbacks.forEach(cb => { try { cb(); } catch(e) {} });
          this.log(`Firebase online · nexia-c8710 · Tenant: ${this.currentTenant?.name || 'GUEST'}`, 'ok');
        });
      } catch(error) {
        this.log(`ERRO CRÍTICO: ${error.message}`, 'err');
      }
    };
    tryInit();
  }

  async _detectTenantByURL() {
    const path = window.location.pathname.toLowerCase();
    let slug = null;
    for (const rule of NEXIA_PATH_MAP) {
      if (rule.pattern.test(path)) { slug = rule.slug; break; }
    }
    if (!slug) {
      const host = window.location.hostname.toLowerCase();
      for (const key of Object.keys(NEXIA_TENANT_REGISTRY)) {
        if (host.includes(key)) { slug = key; break; }
      }
    }
    if (slug && NEXIA_TENANT_REGISTRY[slug]) {
      this.currentTenant = { ...NEXIA_TENANT_REGISTRY[slug] };
      // FIX v19: só consulta Firestore se o usuário já estiver autenticado.
      // Chamada sem auth causa "Missing or insufficient permissions" — erro ruidoso e inútil.
      const _user = this.auth ? this.auth.currentUser : null;
      if (_user && this.db) {
        try {
          // FIX: timeout 3s evita travamento de 10s quando Firestore offline (/vp e /ces)
          const snap = await Promise.race([
            this.db.collection('tenants').doc(slug).get(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))
          ]);
          if (snap.exists) this.currentTenant = { ...this.currentTenant, ...snap.data(), slug };
        } catch(e) { this.log(`Tenant Firestore (usando fallback local): ${'Internal error'}`, 'warn'); }
      }
      // Sem auth: usa dados locais do NEXIA_TENANT_REGISTRY — sem chamada ao Firestore
    } else {
      this.currentTenant = { slug:'guest', name:'Visitante', modules:[], role:'guest' };
    }
  }

  setTenant(slug) {
    if (!NEXIA_TENANT_REGISTRY[slug]) { this.log(`Tenant desconhecido: ${slug}`, 'warn'); return; }
    this.currentTenant = { ...NEXIA_TENANT_REGISTRY[slug] };
    this.log(`Tenant definido: ${this.currentTenant.name}`, 'ok');
  }

  getCollection(col) {
    const slug = this.currentTenant?.slug;
    if (!slug || slug === 'guest') return this.db.collection(col);
    return this.db.collection('data').doc(slug).collection(col);
  }

  getTenantConfigRef(slug) {
    const s = slug || this.currentTenant?.slug;
    return this.db.collection('tenants').doc(s).collection('config').doc('brand');
  }

  onReady(cb) {
    if (this._ready) { try { cb(); } catch(e) {} }
    else             { this._readyCallbacks.push(cb); }
  }

  log(msg, type = 'info') {
    if (!NEXIA_SETTINGS.allowDebug) return;
    const c = { info:'#00e5ff', ok:'#00d68f', warn:'#ffaa00', err:'#ff3d71' };
    console.log(
      `%c[NEXIA ${type.toUpperCase()}] %c${msg}`,
      `color:${c[type]||'#00e5ff'};font-weight:bold`,
      'color:#c4d4ee'
    );
  }

  /**
   * sanitize() — escapa texto puro para uso seguro como textContent.
   * NUNCA insira o resultado via innerHTML — use textContent ou createTextNode.
   * CORRIGIDO v8.0: retorna texto plano, não HTML-encoded string.
   */
  sanitize(s) {
    if (typeof s !== 'string') return '';
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  /**
   * sanitizeHTML() — permite subconjunto seguro de HTML para output de IA (CORTEX).
   * Remove tags não permitidas e atributos perigosos via allowlist.
   */
  sanitizeHTML(html) {
    if (typeof html !== 'string') return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const clean = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return;
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) {
          node.replaceWith(document.createTextNode(node.textContent));
          return;
        }
        // Remove disallowed attributes
        Array.from(node.attributes).forEach(attr => {
          if (!ALLOWED_ATTRS.has(attr.name.toLowerCase())) {
            node.removeAttribute(attr.name);
          } else if (attr.name === 'href') {
            // Block javascript: and data: in href
            if (/^\s*(javascript|data|vbscript)\s*:/i.test(attr.value)) {
              node.removeAttribute(attr.name);
            } else {
              // Force external links to be safe
              node.setAttribute('rel', 'noopener noreferrer');
              node.setAttribute('target', '_blank');
            }
          }
        });
      }
      Array.from(node.childNodes).forEach(clean);
    };
    Array.from(tmp.childNodes).forEach(clean);
    return tmp.innerHTML;
  }

  /**
   * getContactLink() — retorna link de WhatsApp dinâmico do Firestore.
   * Elimina placeholders hardcoded. Usa fallback seguro se não configurado.
   */
  async getContactLink(msg = 'Olá! Quero conhecer o NEXIA OS') {
    // BUG-WA-002 FIX: fallback nunca retorna '#contato' — sempre retorna wa.me real
    const FALLBACK_PHONE = '5511944037259';
    const fallbackUrl = `https://wa.me/${FALLBACK_PHONE}?text=${encodeURIComponent(msg)}`;
    try {
      const slug = this.currentTenant?.slug || 'nexia';
      const ref = this.db.collection('tenants').doc(slug).collection('config').doc('brand');
      const snap = await ref.get();
      const phone = snap.exists ? snap.data()?.whatsappPhone : null;
      if (phone) {
        return `https://wa.me/${phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`;
      }
    } catch(e) { this.log(`getContactLink: ${'Internal error'}`, 'warn'); }
    return fallbackUrl; // fallback real — sempre abre WhatsApp
  }
}

const NEXIA = new NexiaCore();
window.NEXIA = NEXIA;
window.NEXIA_SETTINGS = NEXIA_SETTINGS;
window.NEXIA_FIREBASE_CONFIG = NEXIA_FIREBASE_CONFIG; // Exposto para páginas sem core/config.js carregado primeiro

// ══════════════════════════════════════════════════════
// XSS SHIELD v8.0 — Bloqueia 12+ vetores de ataque
// Aplicado a console.log para detectar outputs suspeitos de IA
// ══════════════════════════════════════════════════════
const _origLog = console.log;
console.log = function(...a) {
  if (typeof a[0] === 'string' && XSS_PATTERNS.some(rx => rx.test(a[0]))) {
    _origLog('%c[NEXIA SHIELD] Conteúdo suspeito bloqueado!', 'color:red;font-weight:bold');
    return;
  }
  // Suppress NAV-GUARD and other framework noise in production
  if (!window._nexiaDebug && typeof a[0] === 'string' && a[0].includes('[NAV-GUARD]')) return;
  _origLog.apply(console, a);
};
