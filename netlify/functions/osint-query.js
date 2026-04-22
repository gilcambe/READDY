'use strict';

// ── fetchWithTimeout helper ──
async function _fetchTimeout(url, opts = {}, ms = 30000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(tid); }
}

/**
/**
 * ╔══════════════════════════════════════════════════════╗
 * ║  NEXIA OS — OSINT Hub v1.1                           ║
 * ║  CPF/CNPJ via Receita Federal + BrasilAPI            ║
 * ╚══════════════════════════════════════════════════════╝
 */
const { admin, db } = require('./firebase-init');
const { requireBearerAuth, HEADERS, makeHeaders } = require('./middleware');

async function queryCNPJ(cnpj) {
  const clean = cnpj.replace(/\D/g, '');
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`);
  if (!res.ok) throw new Error(`BrasilAPI CNPJ error: ${res.status}`);
  return await res.json();
}

async function queryCEP(cep) {
  const clean = cep.replace(/\D/g, '');
  const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${clean}`);
  if (!res.ok) throw new Error(`BrasilAPI CEP error: ${res.status}`);
  return await res.json();
}

exports.handler = async (event) => {
  const headers = makeHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  // FIX v20: guard contra db null quando Firebase não está configurado
  if (!db) return { statusCode: 503, headers: makeHeaders ? makeHeaders(event) : HEADERS, body: JSON.stringify({ ok: false, error: 'Firebase indisponível — configure FIREBASE_SERVICE_ACCOUNT.' }) };

  // CORRIGIDO v38: autenticação obrigatória (dados sensíveis de CNPJ/CPF)
  const authErr = await requireBearerAuth(event);
  if (authErr) return authErr;
  try {
    const { query, type = 'cnpj', tenantId } = event.queryStringParameters || {};
    if (!query) return { statusCode: 400, headers, body: JSON.stringify({ error: 'query parameter required' }) };

    let result;
    if (type === 'cnpj') result = await queryCNPJ(query);
    else if (type === 'cep') result = await queryCEP(query);
    else return { statusCode: 400, headers, body: JSON.stringify({ error: 'type must be cnpj or cep' }) };

    // Log to Firestore for audit trail
    if (tenantId) {
      await db.collection('tenants').doc(tenantId).collection('osint_log').add({
        query, type, timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ query, type, result }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
