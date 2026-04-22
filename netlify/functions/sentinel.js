'use strict';

/**
 * NEXIA OS — Sentinel v3.1 (RENDER REAL AUTO-HEAL)
 * ──────────────────────────────────────────────────
 * FIXES v3.1:
 * - BUG CRÍTICO: sintaxe corrompida em scanEndpoint (url + ';) corrigida
 * - heal mode: triggerRedeploy agora dispara SEMPRE após aplicar qualquer
 *   patch no Firestore (não apenas se firestoreResult.applied > 0)
 * - Redeploy também é acionado mesmo sem override se há issues CRITICAL
 * - RENDER_DEPLOY_HOOK: POST correto com body JSON para o Render
 *
 * MODES:
 *   GET               → status da última execução (Firestore)
 *   POST {mode:scan}  → scan completo + diagnóstico IA
 *   POST {mode:heal}  → recebe issues, gera patches Firestore + redeploy
 *   Scheduled (05:00) → scan automático + heal se crítico
 */

// ── fetchWithTimeout helper ──────────────────────────────────────────
async function _fetchTimeout(url, opts = {}, ms = 30000, _legacyOpts) {
  // Backward-compat: assinatura antiga era _fetchTimeout(url, {}, ms, opts)
  if (_legacyOpts && typeof _legacyOpts === 'object') opts = _legacyOpts;
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

const { admin, db }          = require('./firebase-init');
const { requireBearerAuth }  = require('./middleware');

const BASE   = process.env.NEXIA_APP_URL
            || process.env.RENDER_EXTERNAL_URL
            || process.env.URL
            || 'https://nexia-os.onrender.com';
const GHTKN  = process.env.GITHUB_TOKEN;
const GHREPO = process.env.GITHUB_REPO;        // ex: "org/nexia-os"
const NBHOOK = process.env.RENDER_DEPLOY_HOOK; // Deploy Hook URL do Render

// ─── ENDPOINTS MONITORADOS ──────────────────────────────────────────
const ENDPOINTS = [
  // ── ROTAS PÚBLICAS / LANDING ──────────────────────────────────────
  { name: 'Home',              url: BASE + '/',                         method: 'GET',  expect: 200,                  group: 'Core'       },
  { name: 'Login',             url: BASE + '/login',                    method: 'GET',  expect: 200,                  group: 'Core'       },
  { name: 'CES Landing',       url: BASE + '/ces/landing',              method: 'GET',  expect: 200,                  group: 'CES'        },
  { name: 'CES Admin',         url: BASE + '/ces/admin',                method: 'GET',  expect: 200,                  group: 'CES'        },
  { name: 'CES Executivo',     url: BASE + '/ces/executivo',            method: 'GET',  expect: 200,                  group: 'CES'        },
  { name: 'VP Landing',        url: BASE + '/vp/landing',               method: 'GET',  expect: 200,                  group: 'ViajantePro'},
  { name: 'VP Admin',          url: BASE + '/vp/admin',                 method: 'GET',  expect: 200,                  group: 'ViajantePro'},
  { name: 'Bezsan Landing',    url: BASE + '/bezsan/landing',           method: 'GET',  expect: 200,                  group: 'Bezsan'     },
  { name: 'Splash Admin',      url: BASE + '/splash/admin',             method: 'GET',  expect: 200,                  group: 'Splash'     },
  // ── NEXIA OS — MÓDULOS INTERNOS ───────────────────────────────────
  { name: 'NEXIA Hub',         url: BASE + '/nexia',                    method: 'GET',  expect: 200,                  group: 'NEXIA'      },
  { name: 'NEXIA Cortex',      url: BASE + '/nexia/cortex',             method: 'GET',  expect: 200,                  group: 'NEXIA'      },
  { name: 'NEXIA Store',       url: BASE + '/nexia/store',              method: 'GET',  expect: 200,                  group: 'NEXIA'      },
  { name: 'NEXIA Studio',      url: BASE + '/nexia/studio',             method: 'GET',  expect: 200,                  group: 'NEXIA'      },
  { name: 'NEXIA Sentinel',    url: BASE + '/nexia/sentinel',           method: 'GET',  expect: 200,                  group: 'NEXIA'      },
  { name: 'NEXIA Swarm',       url: BASE + '/nexia/swarm',              method: 'GET',  expect: 200,                  group: 'NEXIA'      },
  { name: 'NEXIA Pay',         url: BASE + '/nexia/pay',                method: 'GET',  expect: 200,                  group: 'NEXIA'      },
  { name: 'NEXIA PABX',        url: BASE + '/nexia/pabx',              method: 'GET',  expect: 200,                  group: 'NEXIA'      },
  { name: 'NEXIA Striker',     url: BASE + '/nexia/striker',            method: 'GET',  expect: 200,                  group: 'NEXIA'      },
  { name: 'NEXIA Strike Ctr',  url: BASE + '/nexia/strike-center',      method: 'GET',  expect: 200,                  group: 'NEXIA'      },
  { name: 'NEXIA OSINT',       url: BASE + '/nexia/osint-query',        method: 'GET',  expect: 200,                  group: 'NEXIA'      },
  { name: 'NEXIA PKI',         url: BASE + '/nexia/pki',                method: 'GET',  expect: 200,                  group: 'NEXIA'      },
  { name: 'NEXIA Architect',   url: BASE + '/nexia/architect',          method: 'GET',  expect: 200,                  group: 'NEXIA'      },
  { name: 'NEXIA AutoDemo',    url: BASE + '/nexia/autodemo',           method: 'GET',  expect: 200,                  group: 'NEXIA'      },
  { name: 'NEXIA Social',      url: BASE + '/nexia/social-media',       method: 'GET',  expect: 200,                  group: 'NEXIA'      },
  { name: 'NEXIA My Panel',    url: BASE + '/nexia/my-panel',           method: 'GET',  expect: 200,                  group: 'NEXIA'      },
  { name: 'NEXIA Master Admin',url: BASE + '/nexia/master-admin',       method: 'GET',  expect: 200,                  group: 'NEXIA'      },
  { name: 'NEXIA QA Center',   url: BASE + '/nexia/qa-test-center',     method: 'GET',  expect: 200,                  group: 'NEXIA'      },
  { name: 'NEXIA Flow',        url: BASE + '/nexia/flow',               method: 'GET',  expect: 200,                  group: 'NEXIA'      },
  // ── APIs BACKEND ──────────────────────────────────────────────────
  { name: 'API Auth',          url: BASE + '/api/auth',                 method: 'POST', expect: [400, 401, 403, 200], group: 'API',  body: { action: 'health' }                                           },
  { name: 'API Cortex',        url: BASE + '/api/cortex',               method: 'POST', expect: [400, 401, 403, 200], group: 'API',  body: { userId: 'sentinel', tenantId: 'nexia', message: 'ping', stream: false } },
  { name: 'API Agents',        url: BASE + '/api/agents',               method: 'GET',  expect: [200, 401, 403],      group: 'API',  params: '?tenantId=nexia'                                            },
  { name: 'API Billing',       url: BASE + '/api/billing',              method: 'GET',  expect: [400, 401, 403, 200], group: 'API',  params: '?tenantId=nexia'                                            },
  { name: 'API KPI',           url: BASE + '/api/kpi',                  method: 'GET',  expect: [200, 401, 403],      group: 'API',  params: '?action=summary&tenantId=nexia'                             },
  { name: 'API Tenant',        url: BASE + '/api/tenant',               method: 'GET',  expect: [200, 401, 403],      group: 'API',  params: '?tenantId=nexia'                                            },
  { name: 'API Swarm',         url: BASE + '/api/swarm',                method: 'POST', expect: [400, 401, 403, 200], group: 'API',  body: { action: 'status', tenantId: 'nexia' }                        },
  { name: 'API Sentinel IoT',  url: BASE + '/api/sentinel',             method: 'GET',  expect: [200, 401, 403],      group: 'API',  params: '?tenantId=nexia'                                            },
  { name: 'API OSINT',         url: BASE + '/api/osint',                method: 'GET',  expect: [400, 401, 403, 200], group: 'API',  params: '?query=test&type=cep'                                       },
  { name: 'API Metrics',       url: BASE + '/api/metrics',              method: 'GET',  expect: [200, 401, 403],      group: 'API',  params: '?tenantId=nexia'                                            },
  { name: 'API Usage',         url: BASE + '/api/usage',                method: 'GET',  expect: [200, 401, 403],      group: 'API',  params: '?tenantId=nexia'                                            },
];

// ─── SCAN ───────────────────────────────────────────────────────────
async function scanEndpoint(ep) {
  const start = Date.now();
  try {
    // FIX: sintaxe corrompida corrigida (url + '; causava SyntaxError em runtime)
    const url  = ep.url + (ep.params || '');
    const opts = { method: ep.method, signal: AbortSignal.timeout(10_000) };

    if (ep.body) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body    = JSON.stringify(ep.body);
    }

    const r        = await fetch(url, opts);
    const ms       = Date.now() - start;
    const expected = Array.isArray(ep.expect) ? ep.expect : [ep.expect];
    const ok       = expected.includes(r.status);

    return {
      name:  ep.name,
      url:   ep.url,
      group: ep.group,
      status: r.status,
      ms,
      ok,
      error: ok ? null : `HTTP ${r.status} (esperado: ${expected.join('/')})`,
    };
  } catch (e) {
    return {
      name:   ep.name,
      url:    ep.url,
      group:  ep.group,
      status: 0,
      ms:     Date.now() - start,
      ok:     false,
      error:  e.name === 'AbortError' ? 'Timeout (>10s)' : (e.message || 'Erro de rede'),
    };
  }
}

// ─── DIAGNÓSTICO VIA IA ─────────────────────────────────────────────
async function diagnosisViaAI(errors, context = '') {
  const key = process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key || !errors.length) return null;

  try {
    const isAnthropic = !!process.env.ANTHROPIC_API_KEY && !process.env.GROQ_API_KEY;

    const prompt = `Você é um engenheiro DevOps sênior. Analise estes erros em produção no sistema NEXIA OS (Render + Firebase + HTML/JS):

ERROS:
${JSON.stringify(errors, null, 2)}

${context ? 'CONTEXTO ADICIONAL DO AUDIT:\n' + context : ''}

Para cada erro, forneça:
1. Diagnóstico da causa raiz
2. Ação imediata (pode ser feita agora sem redeploy)
3. Ação de longo prazo (requer redeploy)

Responda APENAS em JSON (sem markdown): {"summary":"...", "fixes":[{"issue":"...","rootCause":"...","immediateAction":"...","longTermFix":"...","priority":"CRITICAL|HIGH|MEDIUM|LOW","canAutoFix":true/false,"firestoreOverride":{"collection":"...","doc":"...","data":{}}}]}

Se canAutoFix=true, preencha firestoreOverride com dados para salvar no Firestore como override de config.`;

    let r, data;
    if (isAnthropic) {
      r = await _fetchTimeout('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
      });
      data = await r.json();
      return JSON.parse((data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim());
    } else {
      r = await _fetchTimeout('https://api.groq.com/openai/v1/chat/completions', {
        method:  'POST',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 2000, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
      });
      data = await r.json();
      return JSON.parse((data.choices?.[0]?.message?.content || '{}').replace(/```json|```/g, '').trim());
    }
  } catch (e) {
    console.error('[Sentinel] diagnosisViaAI error:', e.message);
    return { error: e.message };
  }
}

// ─── AUTO-HEAL: FIRESTORE OVERRIDES ────────────────────────────────
async function applyFirestoreOverrides(fixes) {
  if (!db) return { applied: 0, errors: ['DB unavailable'] };
  const applied = [];
  const errors  = [];

  for (const fix of fixes) {
    if (!fix.canAutoFix || !fix.firestoreOverride) continue;
    const { collection, doc, data } = fix.firestoreOverride;
    if (!collection || !doc || !data) continue;

    try {
      await db.collection(collection).doc(doc).set({
        ...data,
        _sentinelApplied: true,
        _appliedAt:       admin.firestore.FieldValue.serverTimestamp(),
        _issue:           fix.issue,
      }, { merge: true });

      applied.push({ fix: fix.issue, collection, doc });
    } catch (e) {
      errors.push({ fix: fix.issue, error: e.message });
    }
  }

  return { applied: applied.length, appliedFixes: applied, errors };
}

// ─── AUTO-HEAL: GITHUB ISSUE ────────────────────────────────────────
async function openGitHubPR(fixes, scanReport) {
  if (!GHTKN || !GHREPO) return null;
  const criticalFixes = fixes.filter(f => f.priority === 'CRITICAL' && f.longTermFix);
  if (!criticalFixes.length) return null;

  const prBody = `## 🤖 Sentinel Auto-Heal — ${new Date().toLocaleString('pt-BR')}

**Score do Audit:** ${scanReport.score || 'N/A'}
**Erros detectados:** ${scanReport.errorCount || criticalFixes.length}

### Fixes necessários

${criticalFixes.map(f => `#### ${f.priority}: ${f.issue}\n- **Causa:** ${f.rootCause || 'Ver diagnóstico'}\n- **Fix:** ${f.longTermFix}\n`).join('\n')}

> Gerado automaticamente pelo Sentinel v3.1. Revisar antes de fazer merge.`;

  try {
    const r = await _fetchTimeout(`https://api.github.com/repos/${GHREPO}/issues`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${GHTKN}`,
        'Content-Type':  'application/json',
        'Accept':        'application/vnd.github.v3+json',
      },
      body: JSON.stringify({
        title:  `🔴 Sentinel: ${criticalFixes.length} fix(es) crítico(s) — ${new Date().toLocaleDateString('pt-BR')}`,
        body:   prBody,
        labels: ['sentinel', 'auto-heal', 'critical'],
      }),
    }, 15_000);

    const issue = await r.json();
    return { created: true, url: issue.html_url, number: issue.number };
  } catch (e) {
    return { created: false, error: e.message };
  }
}

// ─── AUTO-HEAL: RENDER DEPLOY HOOK ─────────────────────────────────
// FIX: triggerRedeploy agora sempre é chamado após patches Firestore,
// independente do número de overrides aplicados.
async function triggerRedeploy(reason) {
  if (!NBHOOK) {
    console.warn('[Sentinel] RENDER_DEPLOY_HOOK não configurado — redeploy ignorado');
    return { triggered: false, reason: 'RENDER_DEPLOY_HOOK não configurado' };
  }

  try {
    // O Render Deploy Hook aceita POST sem body específico,
    // mas o campo trigger_title aparece nos logs do deploy.
    const r = await _fetchTimeout(NBHOOK, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ trigger_title: `Sentinel Auto-Heal v3.1: ${reason}` }),
    }, 15_000);

    const triggered = r.ok || r.status === 201;
    console.info(`[Sentinel] Redeploy ${triggered ? 'acionado' : 'falhou'}: ${r.status} — ${reason}`);
    return { triggered, status: r.status, reason };
  } catch (e) {
    console.error('[Sentinel] triggerRedeploy error:', e.message);
    return { triggered: false, error: e.message };
  }
}

// ─── HANDLER PRINCIPAL ─────────────────────────────────────────────
exports.handler = async (event) => {
  const CORS = {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  // GET → status da última execução
  if (event.httpMethod === 'GET') {
    const authErrGet = await requireBearerAuth(event);
    if (authErrGet) return authErrGet;

    if (!db) return { statusCode: 503, headers: CORS, body: JSON.stringify({ error: 'DB unavailable' }) };

    const snap = await db.collection('system_status').doc('sentinel').get().catch(() => null);
    return {
      statusCode: 200,
      headers:    CORS,
      body:       JSON.stringify(snap?.exists ? snap.data() : { message: 'Sem dados ainda' }),
    };
  }

  // Chamadas agendadas (cron do Render/Netlify) dispensam Bearer token
  const isScheduled = event.headers?.['x-netlify-event'] === 'schedule';
  if (!isScheduled) {
    // FIX v49: requireBearerAuth sem role obrigatório — qualquer usuário autenticado
    // pode acessar o Sentinel. O role 'admin' causava 403 quando o documento do
    // usuário no Firestore não tinha o campo role preenchido (retornava 'user').
    const authErr = await requireBearerAuth(event);
    if (authErr) return authErr;
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  const mode = body.mode || 'scan';

  // ── MODO HEAL ─────────────────────────────────────────────────────
  if (mode === 'heal') {
    const issues = body.issues || [];
    if (!issues.length) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'issues[] obrigatório' }) };
    }

    const errorIssues = issues.filter(i => ['CRITICAL', 'HIGH'].includes(i.severity));

    // 1. Diagnóstico IA
    const diagnosis = await diagnosisViaAI(errorIssues, JSON.stringify(issues.slice(0, 10)));

    // 2. Aplicar fixes via Firestore
    let firestoreResult = { applied: 0 };
    if (diagnosis?.fixes && db) {
      firestoreResult = await applyFirestoreOverrides(diagnosis.fixes);
    }

    // 3. Abrir GitHub issue se há críticos
    let githubResult = null;
    if (diagnosis?.fixes?.some(f => f.priority === 'CRITICAL')) {
      githubResult = await openGitHubPR(diagnosis.fixes, { errorCount: errorIssues.length });
    }

    // 4. FIX: triggerRedeploy é acionado se:
    //    - Qualquer override foi aplicado no Firestore, OU
    //    - Há issues CRITICAL mesmo sem override (requer redeploy manual)
    //    Antes só acionava se firestoreResult.applied > 0.
    let redeployResult = null;
    const hasCritical  = errorIssues.some(i => i.severity === 'CRITICAL');
    const shouldRedeploy = NBHOOK && (firestoreResult.applied > 0 || hasCritical);

    if (shouldRedeploy) {
      const redeployReason = firestoreResult.applied > 0
        ? `${firestoreResult.applied} override(s) aplicado(s) no Firestore`
        : `${errorIssues.length} issue(s) CRITICAL detectado(s) — sem override disponível`;
      redeployResult = await triggerRedeploy(redeployReason);
    }

    // 5. Salvar no Firestore
    const healReport = {
      timestamp:          new Date().toISOString(),
      issuesReceived:     issues.length,
      criticalIssues:     errorIssues.length,
      diagnosis,
      firestoreOverrides: firestoreResult,
      githubIssue:        githubResult,
      redeploy:           redeployResult,
      aiEngine:           process.env.ANTHROPIC_API_KEY ? 'claude-haiku' : 'llama-3.3-70b',
    };

    if (db) {
      await Promise.all([
        db.collection('sentinel_heals').add({ ...healReport, ts: admin.firestore.FieldValue.serverTimestamp() }),
        db.collection('system_status').doc('last_heal').set({ ...healReport, ts: admin.firestore.FieldValue.serverTimestamp() }),
      ]).catch(() => {});
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify(healReport) };
  }

  // ── MODO SCAN (default) ───────────────────────────────────────────
  const results  = await Promise.all(ENDPOINTS.map(scanEndpoint));
  const errors   = results.filter(r => !r.ok);
  const ok       = errors.length === 0;
  const avgMs    = Math.round(results.reduce((a, b) => a + b.ms, 0) / results.length);

  let diagnosis = null;
  if (!ok) {
    diagnosis = await diagnosisViaAI(errors);
  }

  // Auto-heal em chamadas agendadas com erros críticos
  let autoHealResult = null;
  const criticalErrors = errors.filter(e => e.status >= 500 || e.status === 0);

  if (criticalErrors.length > 0 && isScheduled) {
    const fakeIssues = criticalErrors.map(e => ({
      type:     'SCAN_FAIL',
      severity: 'CRITICAL',
      route:    e.url,
      detail:   e.error,
    }));
    autoHealResult = await diagnosisViaAI(fakeIssues);
    if (autoHealResult?.fixes && db) {
      const overrideResult = await applyFirestoreOverrides(autoHealResult.fixes);
      // FIX: redeploy após scan automático também
      if (NBHOOK && overrideResult.applied > 0) {
        await triggerRedeploy(`Scan automático: ${overrideResult.applied} override(s) aplicado(s)`);
      }
    }
  }

  const issues = errors.map(e => ({
    type:     e.status >= 500 || e.status === 0 ? 'DOWN' : 'DEGRADED',
    severity: e.status >= 500 || e.status === 0 ? 'CRITICAL' : 'HIGH',
    route:    e.url,
    name:     e.name,
    detail:   e.error || `HTTP ${e.status}`,
    status:   e.status,
    ms:       e.ms,
  }));

  const routeResults = results.filter(r => !r.url.includes('/api/'));
  const fnResults    = results.filter(r =>  r.url.includes('/api/'));

  const report = {
    timestamp:      new Date().toISOString(),
    ok,
    totalEndpoints: results.length,
    okCount:        results.filter(r => r.ok).length,
    errorCount:     errors.length,
    avgMs,
    results,
    errors,
    diagnosis,
    autoHeal:       autoHealResult,
    version:        'v3.1',

    // Formato enriquecido para sentinel-dashboard
    health:      ok ? 'HEALTHY' : errors.some(e => e.status >= 500 || e.status === 0) ? 'DOWN' : 'DEGRADED',
    scannedAt:   new Date().toISOString(),
    durationMs:  avgMs * results.length,
    routeOK:     routeResults.filter(r =>  r.ok).length,
    routeFail:   routeResults.filter(r => !r.ok).length,
    fnOK:        fnResults.filter(r =>  r.ok).length,
    fnFail:      fnResults.filter(r => !r.ok).length,
    critical:    issues.filter(i => i.severity === 'CRITICAL').length,
    totalIssues: issues.length,
    issues,
    fnResults:   fnResults.map(r => ({ name: r.name, url: r.url, ok: r.ok, status: r.status, ms: r.ms, error: r.error || null })),
  };

  if (db) {
    await Promise.all([
      db.collection('sentinel_reports').add({ ...report, criadoEm: admin.firestore.FieldValue.serverTimestamp() }),
      db.collection('system_status').doc('sentinel').set({ ...report, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }),
    ]).catch(() => {});
  }

  return {
    statusCode: ok ? 200 : 207,
    headers:    CORS,
    body:       JSON.stringify(report),
  };
};
