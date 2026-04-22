'use strict';
/**
 * NEXIA OS — Firebase Admin Init v16
 * FIX: Decodificação Base64 robusta para chave RSA privada.
 *
 * Problemas corrigidos:
 * 1. Base64 com espaços/newlines do Render → trim() antes de decodificar
 * 2. Chave RSA com \\n literais (escaped) → converter para \n reais
 * 3. Proteção contra double-init em hot-reload
 * 4. Log de projeto para diagnóstico sem expor credenciais
 */
'use strict';

let admin, db;

try {
  admin = require('firebase-admin');

  if (!admin.apps.length) {
    const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
    const saB64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

    if (!saRaw && !saB64) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT ou FIREBASE_SERVICE_ACCOUNT_BASE64 não configurada');
    }

    let saJson;

    if (saRaw) {
      // Variável já é JSON puro
      saJson = saRaw.trim();
    } else {
      // FIX: trim() remove espaços/newlines que o Render pode injetar nos env vars
      const cleanB64 = saB64.trim().replace(/\s/g, '');
      saJson = Buffer.from(cleanB64, 'base64').toString('utf8');
    }

    // FIX: chaves RSA exportadas pelo Firebase Console às vezes têm \\n
    // literais (dois caracteres) em vez de \n reais. Isso causa:
    // "error:0909006C:PEM routines:get_name:no start line"
    const parsed = JSON.parse(saJson);
    if (parsed.private_key && parsed.private_key.includes('\\n')) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }

    // Diagnóstico seguro: loga apenas o project_id, nunca a chave
    console.info(`[NEXIA] Firebase init → projeto: ${parsed.project_id || 'desconhecido'}`);

    admin.initializeApp({
      credential: admin.credential.cert(parsed),
      // Garante conexão com o projeto correto mesmo se a chave vier de outro ambiente
      projectId: parsed.project_id,
    });
  }

  db = admin.firestore();

  // Configurações de timeout e cache para evitar travamentos no Render
  db.settings({
    ignoreUndefinedProperties: true,
    // Desabilita cache local no backend (só necessário no cliente)
    // cacheSizeBytes: admin.firestore.CACHE_SIZE_UNLIMITED
  });

  console.info('[NEXIA] Firestore conectado ✓');

} catch (e) {
  // Log estruturado: não expõe stack trace com credenciais
  console.error('[NEXIA] Firebase init FALHOU:', e.message);
  db = null;
}

module.exports = { admin, db };
