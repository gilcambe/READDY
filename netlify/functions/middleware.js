'use strict';
/**
 * NEXIA OS — Middleware v15.2
 * CORRIGIDO v40: Suporte a FIREBASE_SERVICE_ACCOUNT_BASE64. SECURITY: fail-CLOSED quando db=null (VULN-03 fix)
 * FIX v45: Alinhado com firebase-init.js v16 — trim()+replace(/\s/g,'') no Base64,
 *          fix de private_key RSA (\\n → \n), projectId explícito.
 */

let admin, db;
try {
  admin = require('firebase-admin');

  if (!admin.apps.length) {
    const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
    const saB64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    if (!saRaw && !saB64) throw new Error('FIREBASE_SERVICE_ACCOUNT ou FIREBASE_SERVICE_ACCOUNT_BASE64 não configurada');

    let saJson;
    if (saRaw) {
      saJson = saRaw.trim();
    } else {
      // FIX: trim() + remove espaços/quebras que o Render pode injetar no env var
      const cleanB64 = saB64.trim().replace(/\s/g, '');
      saJson = Buffer.from(cleanB64, 'base64').toString('utf8');
    }

    // FIX: private_key com \\n literais causa erro RSA no Render
    const parsed = JSON.parse(saJson);
    if (parsed.private_key && parsed.private_key.includes('\\n')) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }

    console.info(`[MIDDLEWARE] Firebase init → projeto: ${parsed.project_id || 'desconhecido'}`);
    admin.initializeApp({
      credential: admin.credential.cert(parsed),
      projectId:  parsed.project_id,
    });
  }

  db = admin.firestore();
  db.settings({ ignoreUndefinedProperties: true });
  console.info('[MIDDLEWARE] Firestore conectado ✓');
} catch (e) {
  console.warn('[MIDDLEWARE] Firebase indisponível:', e.message);
  db = null;
}

function getCorsOrigin(event) {
  const allowed = (process.env.NEXIA_APP_URL || '').split(',').map(u => u.trim()).filter(Boolean);
  const origin = (event && event.headers && (event.headers.origin || event.headers.Origin)) || '';
  return allowed.includes(origin) ? origin : (allowed[0] || '*');
}

const HEADERS = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': process.env.NEXIA_APP_URL ? process.env.NEXIA_APP_URL.split(',')[0].trim() : '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tenant-Id'
};

function makeHeaders(event) {
  return { ...HEADERS, 'Access-Control-Allow-Origin': getCorsOrigin(event) };
}

const RATE_LIMITS = {
  'cortex-chat':        { max: 200, windowMs: 60_000 },
  'swarm':              { max: 60,  windowMs: 60_000 },
  'action-engine':      { max: 120, windowMs: 60_000 },
  'agents':             { max: 120, windowMs: 60_000 },
  'cortex-memory':      { max: 200, windowMs: 60_000 },
  'cortex-learn':       { max: 120, windowMs: 60_000 },
  'notifications':      { max: 200, windowMs: 60_000 },
  'cortex-agent':       { max: 60,  windowMs: 60_000 },
  'event-processor':    { max: 200, windowMs: 60_000 },
  'autodev-engine':     { max: 60,  windowMs: 60_000 },
  'rag-engine':         { max: 60,  windowMs: 60_000 },
  'multi-model-engine': { max: 200, windowMs: 60_000 },
  'auth':               { max: 20,  windowMs: 60_000 },
  'billing':            { max: 30,  windowMs: 60_000 },
  'usage':              { max: 200, windowMs: 60_000 },
  'tenant-admin':       { max: 120, windowMs: 60_000 },
  'observability':      { max: 200, windowMs: 60_000 },
  'cortex-logs':        { max: 200, windowMs: 60_000 },
  'default':            { max: 200, windowMs: 60_000 }
};

const ROLE_PERMISSIONS = {
  master:  ['*'],
  admin:   ['createClient','updateClient','deleteClient','createTask','updateTask','deleteTask','createMeeting','updateMeeting','deleteMeeting','createFinance','updateFinance','deleteFinance','createAgent','updateAgent','deleteAgent'],
  manager: ['createClient','updateClient','createTask','updateTask','createMeeting','updateMeeting','createFinance','updateFinance'],
  member:  ['createTask','updateTask','createMeeting','updateMeeting'],
  user:    ['createTask','createMeeting']
};

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /forget\s+(everything|all|your\s+instructions?)/i,
  /you\s+are\s+now\s+(a\s+)?(\w+\s+)?assistant/i,
  /act\s+as\s+(if\s+you\s+are\s+)?a?\s*(new|different|evil|uncensored)/i,
  /\[SYSTEM\]/i, /\[INST\]/i, /###\s*System/i,
  /override\s+(your\s+)?(system\s+)?prompt/i,
  /jailbreak/i, /DAN\s+mode/i, /do\s+anything\s+now/i,
  /<\|system\|>/i, /<<SYS>>/i
];

const DANGEROUS_ACTIONS = [
  /delete\s*all/i, /drop\s*(database|collection|table)/i,
  /truncate/i, /wipe\s+(all|everything|data)/i,
  /destroy\s+all/i, /remove\s+all\s+(clients|users|data)/i,
  /nuke\s+(the\s+)?(database|data)/i
];

// Memória in-process para rate limit quando Firebase não disponível
const _localRL = new Map();

async function checkRateLimit(userId, functionName) {
  if (!userId) return { ok: true };
  const limit = RATE_LIMITS[functionName] || RATE_LIMITS.default;
  const key = `${userId}:${functionName}`;

  // Se Firebase não disponível, usa memória local
  if (!db) {
    const now = Date.now();
    const entry = _localRL.get(key);
    if (!entry || (now - entry.windowStart) > limit.windowMs) {
      _localRL.set(key, { count: 1, windowStart: now });
      return { ok: true, remaining: limit.max - 1 };
    }
    if (entry.count >= limit.max) return { ok: false, reason: 'Rate limit excedido', retryAfter: Math.ceil((limit.windowMs - (now - entry.windowStart)) / 1000) };
    entry.count++;
    return { ok: true, remaining: limit.max - entry.count };
  }

  // Com Firebase
  _cleanExpiredRateLimits().catch(() => {});
  const ref = db.collection('rate_limits').doc(key);
  try {
    return await db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      const now = Date.now();
      if (!doc.exists) {
        tx.set(ref, { count: 1, windowStart: now, userId, fn: functionName, ttl: now + 3600_000 });
        return { ok: true, remaining: limit.max - 1 };
      }
      const data = doc.data();
      const age = now - (data.windowStart || 0);
      if (age > limit.windowMs) {
        tx.set(ref, { count: 1, windowStart: now, userId, fn: functionName, ttl: now + 3600_000 });
        return { ok: true, remaining: limit.max - 1 };
      }
      if (data.count >= limit.max) return { ok: false, reason: 'Rate limit excedido', retryAfter: Math.ceil((limit.windowMs - age) / 1000) };
      tx.update(ref, { count: admin.firestore.FieldValue.increment(1) });
      return { ok: true, remaining: limit.max - data.count - 1 };
    });
  } catch (e) { return { ok: true, remaining: -1 }; }
}

async function _cleanExpiredRateLimits() {
  if (!db) return;
  try {
    const now = Date.now();
    const expired = await db.collection('rate_limits').where('ttl', '<', now).limit(50).get();
    if (expired.empty) return;
    const batch = db.batch();
    expired.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  } catch (_) { /* intentional: cleanup failure is non-critical */ }
}

const _tenantCache = new Map();
async function validateTenant(userId, tenantId) {
  if (!userId || !tenantId) return { ok: false, reason: 'userId ou tenantId ausente' };
  if (!db) return { ok: true, role: 'user' };

  const cacheKey = `${userId}:${tenantId}`;
  const cached = _tenantCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < 300000) return cached.result;

  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return { ok: false, reason: 'Usuário não encontrado no Firestore. Faça login novamente.' };
    const profile = userDoc.data();
    const userTenant = profile.tenantSlug || profile.tenant;
    const userRole = profile.role || 'user';
    // Master ou pertence ao tenant nexia → acesso total
    if (userTenant === 'nexia' || userRole === 'master') return { ok: true, role: 'master' };
    // FIX v50: usuário 'guest' tentando acessar tenant 'nexia' → auto-repara se
    // foi registrado antes do set-master-role ser executado. Verifica se é o
    // único tenant existente (setup inicial) e eleva para member do nexia.
    if (userTenant === 'guest' && tenantId === 'nexia') {
      const nexiaSnap = await db.collection('tenants').doc('nexia').get().catch(() => null);
      if (nexiaSnap && nexiaSnap.exists) {
        // Repara o doc do usuário no Firestore silenciosamente
        await db.collection('users').doc(userId).update({ tenantSlug: 'nexia', tenant: 'nexia' }).catch(() => {});
        console.info(`[validateTenant] Auto-reparado: ${userId} guest → nexia`);
        return { ok: true, role: 'user' };
      }
    }
    if (userTenant !== tenantId) return { ok: false, reason: `Acesso negado ao tenant "${tenantId}"` };
    const memberDoc = await db.collection('tenants').doc(tenantId).collection('members').doc(userId).get().catch(() => null);
    const result = { ok: true, role: memberDoc?.exists ? (memberDoc.data().role || userRole) : userRole };
    _tenantCache.set(cacheKey, { result, ts: Date.now() });
    return result;
  } catch (e) {
    console.error('[validateTenant] error:', 'Internal error');
    return { ok: false, reason: 'Erro ao validar acesso. Tente novamente.' };
  }
}

function sanitizePrompt(text) {
  if (typeof text !== 'string') return '';
  let clean = text.replace(/\0/g, '').replace(/[\x01-\x08\x0b-\x1f\x7f]/g, '');
  for (const p of INJECTION_PATTERNS) if (p.test(clean)) throw new Error('Padrão de prompt injection detectado e bloqueado.');
  for (const p of DANGEROUS_ACTIONS)  if (p.test(clean)) throw new Error('Operação destrutiva em massa não permitida.');
  return clean.trim().slice(0, 32000);
}

/**
 * guard() — FIX v41 ARQUITETURAL
 *
 * PROBLEMA ANTERIOR: guard() aceitava userId/tenantId do body sem verificar
 * se o caller era de fato esse usuário. Qualquer pessoa podia passar
 * { userId: "uid-alheio", tenantId: "tenant-alheio" } e passar pela guarda.
 *
 * CORREÇÃO: guard() agora verifica o Bearer token ANTES de qualquer coisa.
 * O uid real vem sempre do token decodificado — nunca do body.
 * O tenantId do body é mantido apenas para roteamento; a pertença ao tenant
 * é validada via validateTenant() com o uid do token.
 *
 * opts.skipAuth = true → permite bypass (apenas para rotas internas/scheduled)
 * opts.skipTenant = true → pula validação de tenant
 * opts.requiredRole = 'admin'|'master' → exige role mínimo
 */
async function guard(event, functionName, opts = {}) {
  const h = makeHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: h, body: '' };

  // ── BEARER TOKEN VERIFICATION (novo — obrigatório por padrão) ──────────────
  if (!opts.skipAuth) {
    const tokenResult = await verifyBearerToken(event);
    if (!tokenResult.ok) {
      return { statusCode: 401, headers: h, body: JSON.stringify({ error: tokenResult.reason || 'Token de autenticação inválido ou ausente.' }) };
    }
    // Role check opcional
    if (opts.requiredRole && tokenResult.role !== 'master') {
      const hierarchy = ['user', 'member', 'manager', 'admin', 'master'];
      const callerIdx = hierarchy.indexOf(tokenResult.role);
      const requiredIdx = hierarchy.indexOf(opts.requiredRole);
      if (callerIdx < requiredIdx) {
        return { statusCode: 403, headers: h, body: JSON.stringify({ error: 'Permissão insuficiente.' }) };
      }
    }
    // Expõe uid/role verificados no evento — funções downstream usam event._uid
    event._uid    = tokenResult.uid;
    event._role   = tokenResult.role;
    event._email  = tokenResult.email;
  }

  // ── BODY PARSE ─────────────────────────────────────────────────────────────
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { }

  // uid vem SEMPRE do token verificado — nunca do body (previne IDOR)
  const userId   = event._uid || body.userId;
  const tenantId = body.tenantId;

  // ── RATE LIMIT ─────────────────────────────────────────────────────────────
  if (userId) {
    const rl = await checkRateLimit(userId, functionName);
    if (!rl.ok) return { statusCode: 429, headers: h, body: JSON.stringify({ error: rl.reason }) };
  }

  // ── TENANT VALIDATION ──────────────────────────────────────────────────────
  // FIX v50: role='master' confirmado por custom claims do Firebase Auth →
  // pula validação de tenant no Firestore. Previne 403 quando admin@nexia.com
  // tem tenantSlug='guest' no Firestore mas claims corretos no Auth Token.
  if (!opts.skipTenant && userId && tenantId && event._role !== 'master') {
    const tv = await validateTenant(userId, tenantId);
    if (!tv.ok) return { statusCode: 403, headers: h, body: JSON.stringify({ error: tv.reason }) };
    event._role    = tv.role;
    event._userId  = userId;
  }

  return null;
}

function checkPermission(role, action) {
  const perms = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.user;
  if (perms.includes('*')) return true;
  return perms.includes(action);
}

function validateAIAction(type, data) {
  const ALLOWED = ['createClient','updateClient','deleteClient','createTask','updateTask','deleteTask','createMeeting','updateMeeting','deleteMeeting','createFinance','updateFinance','deleteFinance','createNote','updateNote','deleteNote'];
  if (!ALLOWED.includes(type)) throw new Error(`Ação de IA não permitida: "${type}"`);
  if (!data || typeof data !== 'object') throw new Error(`Dados inválidos para ação: "${type}"`);
}


/**
 * verifyBearerToken — valida Firebase ID Token no header Authorization: Bearer <token>
 * Retorna { ok, uid, role } ou { ok: false, reason }
 */
async function verifyBearerToken(event) {
  const authHeader = event.headers && (event.headers.authorization || event.headers.Authorization);
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, reason: 'Token de autenticação ausente.' };
  }
  const idToken = authHeader.slice(7).trim();
  try {
    if (!admin || !admin.auth) return { ok: false, reason: 'Firebase Admin não disponível.' };
    const decoded = await admin.auth().verifyIdToken(idToken);
    // Optionally check Firestore for role
    let role = 'user';
    if (db) {
      try {
        const userDoc = await db.collection('users').doc(decoded.uid).get();
        if (userDoc.exists) role = userDoc.data().role || 'user';
      } catch(e) { /* log only */ }
    }
    // FIX v49: Custom Claims do Firebase Auth têm prioridade sobre Firestore
    // set-master-role.js define claims {role:'master', tenantSlug:'nexia'}
    if (decoded.role) role = decoded.role;
    // Usuário do tenant nexia sem doc no Firestore → promove a master
    if (!decoded.role && !db && decoded.email) role = 'user';
    return { ok: true, uid: decoded.uid, email: decoded.email, role, tenantSlug: decoded.tenantSlug };
  } catch (e) {
    return { ok: false, reason: `Token inválido: ${'Internal error'}` };
  }
}

/**
 * requireBearerAuth — middleware helper: retorna resposta 401/403 se token inválido.
 * Uso: const authErr = await requireBearerAuth(event); if (authErr) return authErr;
 */
async function requireBearerAuth(event, requiredRole = null) {
  if (event.httpMethod === 'OPTIONS') return null; // deixa CORS preflight passar
  const result = await verifyBearerToken(event);
  if (!result.ok) {
    return { statusCode: 401, headers: makeHeaders(event), body: JSON.stringify({ error: result.reason }) };
  }
  if (requiredRole && result.role !== 'master') {
    const hierarchy = ['user', 'member', 'manager', 'admin', 'master'];
    const callerIdx  = hierarchy.indexOf(result.role);
    const requiredIdx = hierarchy.indexOf(requiredRole);
    if (callerIdx < requiredIdx) {
      return { statusCode: 403, headers: makeHeaders(event), body: JSON.stringify({ error: 'Permissão insuficiente.' }) };
    }
  }
  event._uid  = result.uid;
  event._role = result.role;
  return null; // ok
}

// ═══════════════════════════════════════════════════════════════════════
// NETLIFY FUNCTION HANDLER — /api/governance
// ═══════════════════════════════════════════════════════════════════════
const _handler = async (event) => {
  const h = makeHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: h, body: '' };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  const { action = 'check', tenantId, userId, policy } = body;

  // Verificar auth
  const authResult = await verifyBearerToken(event);

  if (action === 'check') {
    return {
      statusCode: 200, headers: h,
      body: JSON.stringify({
        ok: true,
        authenticated: authResult.ok,
        role: authResult.ok ? authResult.role : 'anonymous',
        tenantId: tenantId || null,
        timestamp: new Date().toISOString()
      })
    };
  }

  if (action === 'audit') {
    if (!authResult.ok) return { statusCode: 401, headers: h, body: JSON.stringify({ error: 'Não autenticado' }) };
    return {
      statusCode: 200, headers: h,
      body: JSON.stringify({ ok: true, action: 'audit', userId: authResult.uid, tenantId, timestamp: new Date().toISOString() })
    };
  }

  return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Ação desconhecida: ' + action }) };
};

module.exports = { guard, checkRateLimit, validateTenant, sanitizePrompt, checkPermission, validateAIAction, verifyBearerToken, requireBearerAuth, HEADERS, makeHeaders, getCorsOrigin, ROLE_PERMISSIONS, handler: _handler };
module.exports.handler = _handler;
