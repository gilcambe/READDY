/**
 * NEXIA OS — Firebase Resilience Layer
 * Elimina erros de console do Firebase offline.
 * Adicionar em todas as telas: <script src="../core/firebase-resilience.js"></script>
 */
(function() {
  'use strict';

  // Suprimir erros não críticos do Firebase no console
  const originalConsoleError = console.error;
  console.error = function(...args) {
    const msg = args.join(' ');
    // Suprimir erros conhecidos e não críticos
    if (
      msg.includes('Could not reach Cloud Firestore backend') ||
      msg.includes('Connection failed') ||
      msg.includes('offline mode') ||
      msg.includes('FirebaseError: [code=unavailable]') ||
      msg.includes('WebChannelConnection') ||
      msg.includes('Transport errored')
    ) {
      // Log silencioso para debugging interno
      if (window._nexiaDebug) console.warn('[NEXIA/Firebase] Offline:', msg.slice(0, 100));
      return;
    }
    originalConsoleError.apply(console, args);
  };

  // Habilitar persistência offline do Firestore quando disponível
  window.enableFirestorePersistence = function(db) {
    if (!db || !db.enablePersistence) return;
    db.enablePersistence({ synchronizeTabs: true })
      .then(() => { if (window._nexiaDebug) console.log('[NEXIA] Firestore persistence enabled'); })
      .catch(err => {
        if (err.code === 'failed-precondition') {
          // Múltiplas tabs abertas — modo normal
        } else if (err.code === 'unimplemented') {
          // Browser não suporta
        }
      });
  };

  // Wrapper de onSnapshot com retry automático
  window.nexiaSnapshot = function(ref, callback, errorCallback) {
    let retryCount = 0;
    const maxRetries = 3;
    const retryDelay = 5000;

    function subscribe() {
      return ref.onSnapshot(callback, (err) => {
        if (retryCount < maxRetries) {
          retryCount++;
          setTimeout(subscribe, retryDelay * retryCount);
        } else if (errorCallback) {
          errorCallback(err);
        }
      });
    }
    return subscribe();
  };

  // Status de conectividade
  window.nexiaOnline = navigator.onLine;
  window.addEventListener('online', () => {
    window.nexiaOnline = true;
    document.dispatchEvent(new Event('nexia:online'));
  });
  window.addEventListener('offline', () => {
    window.nexiaOnline = false;
    document.dispatchEvent(new Event('nexia:offline'));
  });

})();
