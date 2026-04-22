'use strict';
const NexiaAuth = (() => {
  let _currentUser = null, _userProfile = null, _authCallbacks = [];
  // CORRIGIDO v38: flag para evitar múltiplos listeners (memory leak)
  let _authListenerRegistered = false;
  let _authUnsubscribe = null;

  function init() {
    const waitAuth = () => {
      if (!NEXIA._ready || !NEXIA.auth) { setTimeout(waitAuth, 200); return; }
      // Registra listener apenas uma vez — evita acúmulo em SPA
      if (_authListenerRegistered) return;
      _authListenerRegistered = true;
      NEXIA.auth.onAuthStateChanged(async user => {
        _currentUser = user;
        if (user) {
          try {
            const snap = await NEXIA.db.collection('users').doc(user.uid).get();
            if (snap.exists) {
              _userProfile = snap.data();
              const slug = _userProfile.tenantSlug || _userProfile.tenant;
              if (slug) NEXIA.setTenant(slug);
            } else {
              _userProfile = { uid: user.uid, email: user.email, displayName: user.displayName || user.email, tenantSlug: 'guest', role: 'user', createdAt: firebase.firestore.FieldValue.serverTimestamp() };
              await NEXIA.db.collection('users').doc(user.uid).set(_userProfile);
            }
          } catch(e) { NEXIA.log('Auth profile error: ' + 'Internal error', 'warn'); }
        } else { _userProfile = null; }
        _authCallbacks.forEach(cb => { try { cb(_userProfile); } catch(e) {} });
      });
    };
    waitAuth();
  }

  async function login(email, password) {
    if (!NEXIA.auth) throw new Error('Serviço de autenticação indisponível. Tente novamente.');
    try {
      const cred = await NEXIA.auth.signInWithEmailAndPassword(email, password);
      return cred.user;
    } catch (e) {
      const msg = {
        'auth/user-not-found':      'E-mail não cadastrado.',
        'auth/wrong-password':      'Senha incorreta.',
        'auth/invalid-email':       'E-mail inválido.',
        'auth/user-disabled':       'Conta desativada. Contate o suporte.',
        'auth/too-many-requests':   'Muitas tentativas. Aguarde alguns minutos.',
        'auth/network-request-failed': 'Sem conexão com a internet.',
        'auth/invalid-credential':  'Credenciais inválidas.',
      }[e.code] || 'Erro ao fazer login. Tente novamente.';
      throw new Error(msg);
    }
  }

  async function register(email, password, displayName, tenantSlug = 'guest') {
    if (!NEXIA.auth) throw new Error('Auth indisponível');
    const cred = await NEXIA.auth.createUserWithEmailAndPassword(email, password);
    const user = cred.user;
    await user.updateProfile({ displayName });
    await NEXIA.db.collection('users').doc(user.uid).set({ uid: user.uid, email, displayName, tenantSlug, role: 'user', createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    await NEXIA.db.collection('tenants').doc(tenantSlug).collection('members').doc(user.uid).set({ uid: user.uid, email, displayName, role: 'user', joinedAt: firebase.firestore.FieldValue.serverTimestamp() });
    return user;
  }

  async function logout() {
    if (NEXIA.auth) await NEXIA.auth.signOut();
    _currentUser = null; _userProfile = null;
    window.location.href = '/login';
  }

  function requireAuth(redirectTo = '/login') {
    const _hideBody = () => { if (document.body) document.body.style.visibility = 'hidden'; };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _hideBody);
    else _hideBody();

    // NEXIA FIX v2: timeout máximo de 8s para nunca travar a página em headless/CI
    const _showBody = () => {
      if (document.documentElement) document.documentElement.style.visibility = 'visible';
      if (document.body) document.body.style.visibility = 'visible';
    };
    const _safetyTimer = setTimeout(_showBody, 8000); // FIX v48: 8s para suportar cold start do Render
    
    const waitCheck = (attempts) => {
      if (attempts > 100) { clearTimeout(_safetyTimer); _showBody(); return; } // max 10s
      if (!NEXIA._ready) { setTimeout(() => waitCheck(attempts + 1), 100); return; }
      if (!NEXIA.auth) { clearTimeout(_safetyTimer); _showBody(); return; }

      // FIX v48: aguarda Firebase restaurar sessão antes do primeiro check
      // Render cold start pode demorar até 2s para o Firebase Client SDK restaurar onAuthStateChanged
      // Usamos um listener PERSISTENTE com timeout — não cancela na primeira chamada nula
      if (_authUnsubscribe) { _authUnsubscribe(); _authUnsubscribe = null; }

      let _resolved = false;
      const _resolveAuth = (user) => {
        if (_resolved) return;
        _resolved = true;
        if (_authUnsubscribe) { _authUnsubscribe(); _authUnsubscribe = null; }
        clearTimeout(_safetyTimer);
        if (!user) {
          window.location.href = redirectTo;
        } else {
          _showBody();
        }
      };

      // Listener que aguarda até 3s por uma resposta não-null antes de redirecionar
      let _nullTimer = null;
      _authUnsubscribe = NEXIA.auth.onAuthStateChanged(user => {
        if (user) {
          // Usuário autenticado — resolver imediatamente
          if (_nullTimer) clearTimeout(_nullTimer);
          _resolveAuth(user);
        } else {
          // Pode ser transitório (Firebase ainda restaurando sessão)
          // Aguarda 1.5s antes de concluir que não há sessão
          if (!_nullTimer) {
            _nullTimer = setTimeout(() => _resolveAuth(null), 1500);
          }
        }
      });
    };
    waitCheck(0);
  }

  function _autoGuard() {
    const path = window.location.pathname;
    // CORRIGIDO v38: vp-passenger, vp-guide e architect adicionados
    const PROTECTED = [
      /-admin\.html$/,              // *-admin.html (bezsan-admin, ces-admin, vp-admin, etc.)
      /\/nexia\//,                  // /nexia/* (todos os painéis master)
      /cortex-app\.html$/,
      /flow\.html$/,
      /studio\.html$/,
      /tenant-hub\.html$/,
      /my-panel\.html$/,
      /pabx-softphone\.html$/,
      /nexia-pay\.html$/,
      /nexia-store\.html$/,
      /swarm-control\.html$/,
      /pki-scanner\.html$/,
      /vp-passenger\.html$/,        // CORRIGIDO: estava sem proteção
      /vp-guide\.html$/,            // CORRIGIDO: estava sem proteção
      /architect\.html$/,           // CORRIGIDO: estava sem proteção (criação de tenant)
      /qa-test-center\.html$/,      // QA CENTER: acesso apenas para master
      /nexia-autodemo\.html$/,       // FIX v22: adicionado — estava sem proteção
      /osint-query\.html$/,          // FIX v22: adicionado — estava sem proteção
      /ces-admin\.html$/,            // FIX v22: coberto por /-admin\.html$/ mas explicitado
      /splash-admin\.html$/,         // FIX v22: coberto por /-admin\.html$/ mas explicitado
    ];
    const isProtected = PROTECTED.some(rx => rx.test(path));
    const isLoginPage  = /\/login(\.html)?$/.test(path) || path === '/';
    if (isProtected && !isLoginPage) {
      requireAuth('/login?next=' + encodeURIComponent(path));
    }
  }

  function onChange(cb) { _authCallbacks.push(cb); }

  init(); _autoGuard();

  return {
    login,
    register,
    logout,
    onChange,
    requireAuth,
    getUser:       () => _currentUser,
    getProfile:    () => _userProfile,
    isLogged:      () => !!_currentUser,
    getTenantSlug: () => _userProfile?.tenantSlug || NEXIA.currentTenant?.slug || 'nexia'
  };
})();
window.NexiaAuth = NexiaAuth;
