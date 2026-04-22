/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  NEXIA OS — AUTODEV ENGINE v3.0 (CORTEX AUTO-PROGRAMMER)        ║
 * ║  O Cortex se auto-programa: cria módulos, corrige bugs,          ║
 * ║  integra ao backend, store e faz deploy automático.              ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */


// ── fetchWithTimeout helper ──
async function _fetchTimeout(url, opts = {}, ms = 30000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(tid); }
}

const { admin, db } = require('./firebase-init');

// FIX v41: import auth middleware — this endpoint was completely unauthenticated
const { HEADERS, makeHeaders, requireBearerAuth } = require('./middleware');

// ── Modelos disponíveis ─────────────────────────────────────────
const GROQ_KEY = process.env.GROQ_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

async function callGroq(systemPrompt, userMsg, model = 'llama-4-scout-17b-16e-instruct') {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }],
      max_tokens: 8000,
      temperature: 0.3
    })
  });
  const d = await r.json();
  return d.choices?.[0]?.message?.content || '';
}

async function callClaude(systemPrompt, userMsg) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }]
    })
  });
  const d = await r.json();
  return d.content?.[0]?.text || '';
}

// ── Actions do AutoDev ──────────────────────────────────────────
const VALID_ACTIONS = ['generate_project','list_projects','review','fix','refactor','test','docs','explain','optimize','security',
  'criar_modulo','corrigir_bug','gerar_funcao','deploy','criar_funcao_netlify','criar_ui','atualizar_store'];

// ── Sistema de Auto-Programação ─────────────────────────────────
async function autoProgram(action, spec, tenantId, userId) {
  const timestamp = Date.now();
  const jobId = `autodev_${timestamp}`;

  // Log do job
  if (db) {
    await db.collection(`tenants/${tenantId}/autodev_jobs`).doc(jobId).set({
      jobId, action, spec, status: 'running', startedAt: admin.firestore.FieldValue.serverTimestamp(),
      userId, progress: 0
    });
  }

  try {
    let result = {};

    if (action === 'criar_modulo' || action === 'generate_project') {
      result = await gerarModuloCompleto(spec, tenantId, jobId);
    } else if (action === 'corrigir_bug' || action === 'fix') {
      result = await corrigirBug(spec, tenantId, jobId);
    } else if (action === 'gerar_funcao' || action === 'criar_funcao_netlify') {
      result = await gerarFuncaoNetlify(spec, tenantId, jobId);
    } else if (action === 'criar_ui') {
      result = await gerarUI(spec, tenantId, jobId);
    } else if (action === 'atualizar_store') {
      result = await atualizarStore(spec, tenantId, jobId);
    } else if (action === 'review' || action === 'security') {
      result = await revisarCodigo(spec, tenantId, jobId);
    } else if (action === 'list_projects') {
      result = await listarProjetos(tenantId);
    } else if (action === 'docs') {
      result = await gerarDocs(spec, tenantId, jobId);
    } else {
      result = await execucaoGenerica(action, spec, tenantId, jobId);
    }

    // Atualizar job como concluído
    if (db) {
      await db.collection(`tenants/${tenantId}/autodev_jobs`).doc(jobId).update({
        status: 'completed', completedAt: admin.firestore.FieldValue.serverTimestamp(),
        progress: 100, result
      });
    }

    return { ok: true, jobId, action, result };

  } catch (err) {
    if (db) {
      await db.collection(`tenants/${tenantId}/autodev_jobs`).doc(jobId).update({
        status: 'error', error: 'Internal error', completedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    return { ok: false, jobId, error: 'Internal error' };
  }
}

// ── 1. Gerar Módulo Completo ─────────────────────────────────────
async function gerarModuloCompleto(spec, tenantId, jobId) {
  updateProgress(tenantId, jobId, 10, 'Analisando especificação...');

  const systemPrompt = `Você é o CORTEX AUTO-PROGRAMMER da NEXIA OS.
Gere um módulo COMPLETO e FUNCIONAL baseado na especificação.
RETORNE APENAS JSON válido com esta estrutura:
{
  "moduleId": "slug-do-modulo",
  "nome": "Nome do Módulo",
  "categoria": "IA|Comunicação|Marketing|Vendas|Financeiro|Operações|Segurança|Analytics|Automação",
  "descricao": "Descrição completa",
  "preco": 97,
  "schema_firestore": {
    "collection": "nome_collection",
    "campos": [{"nome": "campo", "tipo": "string|number|boolean|timestamp", "obrigatorio": true}]
  },
  "funcao_netlify": {
    "nome": "nome-da-funcao",
    "codigo": "// código JavaScript completo da função Netlify"
  },
  "ui_html": "<!-- HTML completo da tela do módulo -->",
  "rotas_api": [{"metodo": "GET|POST|PUT|DELETE", "path": "/api/nome-da-funcao", "descricao": ""}],
  "permissoes": ["admin", "member"],
  "dependencias": ["firebase", "groq"],
  "integracao_store": {
    "icon_svg": "<svg>...</svg>",
    "tags": ["tag1", "tag2"],
    "plano_minimo": "starter|pro|enterprise"
  }
}`;

  updateProgress(tenantId, jobId, 30, 'Gerando arquitetura...');
  const raw = await callClaude(systemPrompt, `Especificação: ${spec}`);

  let moduleData;
  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    moduleData = JSON.parse(clean);
  } catch(e) {
    moduleData = { moduleId: 'modulo-gerado', nome: 'Módulo Gerado', descricao: spec, raw };
  }

  updateProgress(tenantId, jobId, 60, 'Salvando no Firestore...');

  // Salvar módulo no Firestore
  if (db && moduleData.moduleId) {
    await db.collection('modules').doc(moduleData.moduleId).set({
      ...moduleData,
      status: 'active',
      criadoPor: 'cortex-autodev',
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
      tenantId
    });

    // Adicionar à store
    await db.collection('store').doc(moduleData.moduleId).set({
      id: moduleData.moduleId,
      nome: moduleData.nome,
      categoria: moduleData.categoria || 'Outros',
      descricao: moduleData.descricao,
      preco: moduleData.preco || 97,
      tags: moduleData.integracao_store?.tags || [],
      icon_svg: moduleData.integracao_store?.icon_svg || '',
      plano_minimo: moduleData.integracao_store?.plano_minimo || 'starter',
      ativo: true,
      criadoPor: 'autodev',
      criadoEm: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  updateProgress(tenantId, jobId, 90, 'Integrando à plataforma...');

  return {
    moduleId: moduleData.moduleId,
    nome: moduleData.nome,
    funcao_gerada: moduleData.funcao_netlify?.nome,
    schema: moduleData.schema_firestore,
    store_atualizada: true,
    instrucoes_deploy: [
      `1. Copie o código de funcao_netlify.codigo para /netlify/functions/${moduleData.funcao_netlify?.nome}.js`,
      `2. Copie o ui_html para /nexia/${moduleData.moduleId}.html`,
      `3. Adicione a rota em _redirects: /nexia/${moduleData.moduleId} /nexia/${moduleData.moduleId}.html 200`,
      `4. Faça git push para deploy automático via Netlify`
    ]
  };
}

// ── 2. Corrigir Bug ─────────────────────────────────────────────
async function corrigirBug(spec, tenantId, jobId) {
  updateProgress(tenantId, jobId, 20, 'Analisando bug...');

  const systemPrompt = `Você é o CORTEX BUG FIXER da NEXIA OS.
Analise o bug e retorne JSON:
{
  "diagnostico": "Explicação do bug",
  "causa_raiz": "Causa raiz",
  "solucao": "Solução aplicada",
  "codigo_corrigido": "// código corrigido",
  "arquivo_alvo": "caminho/do/arquivo.js",
  "teste_sugerido": "Como testar a correção"
}`;

  const fix = await callGroq(systemPrompt, `Bug report: ${spec}`);
  let fixData;
  try { fixData = JSON.parse(fix.replace(/```json|```/g, '').trim()); }
  catch(e) { fixData = { diagnostico: fix, solucao: 'Ver diagnóstico' }; }

  // Log do fix
  if (db) {
    await db.collection(`tenants/${tenantId}/bug_fixes`).add({
      spec, fix: fixData, timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  return fixData;
}

// ── 3. Gerar Função Netlify ──────────────────────────────────────
async function gerarFuncaoNetlify(spec, tenantId, jobId) {
  updateProgress(tenantId, jobId, 20, 'Gerando função...');

  const systemPrompt = `Você é o CORTEX FUNCTION GENERATOR da NEXIA OS.
Gere uma função Netlify COMPLETA e funcional. Retorne JSON:
{
  "nome_funcao": "nome-da-funcao",
  "descricao": "O que faz",
  "codigo": "// Código JavaScript COMPLETO da função Netlify serverless\\nexports.handler = async (event, context) => {\\n  // implementação real\\n};",
  "variaveis_env": ["FIREBASE_SERVICE_ACCOUNT", "GROQ_API_KEY"],
  "exemplo_request": {"method": "POST", "body": {}},
  "exemplo_response": {}
}`;

  const raw = await callClaude(systemPrompt, `Especificação: ${spec}`);
  let funcData;
  try { funcData = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
  catch(e) { funcData = { nome_funcao: 'nova-funcao', codigo: raw }; }

  if (db) {
    await db.collection(`tenants/${tenantId}/generated_functions`).add({
      ...funcData, spec, geradoEm: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  return funcData;
}

// ── 4. Gerar UI HTML ────────────────────────────────────────────
async function gerarUI(spec, tenantId, jobId) {
  updateProgress(tenantId, jobId, 20, 'Gerando interface...');

  const systemPrompt = `Você é o CORTEX UI GENERATOR da NEXIA OS.
Gere uma tela HTML completa seguindo o Design System Obsidian & Gold da NEXIA:
- Fundo dark: #0A0A0F
- Acento dourado: #C8A96E
- Off-white: #F5F3EE
- Cards com border-radius: 10px
- Fonte: Inter
- Toggle dark/light mode com data-theme
Retorne JSON:
{
  "nome_arquivo": "modulo-nome.html",
  "titulo": "Título da Tela",
  "html_completo": "<!DOCTYPE html>... código HTML completo ..."
}`;

  const raw = await callClaude(systemPrompt, `Tela necessária: ${spec}`);
  let uiData;
  try { uiData = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
  catch(e) { uiData = { nome_arquivo: 'nova-tela.html', html_completo: raw }; }

  if (db) {
    await db.collection(`tenants/${tenantId}/generated_uis`).add({
      ...uiData, spec, geradoEm: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  return uiData;
}

// ── 5. Atualizar Store ───────────────────────────────────────────
async function atualizarStore(spec, tenantId, jobId) {
  if (!db) return { ok: false, error: 'Firebase indisponível' };

  const modulos = spec.modulos || [];
  const batch = db.batch();

  for (const mod of modulos) {
    const ref = db.collection('store').doc(mod.id);
    batch.set(ref, { ...mod, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }

  await batch.commit();
  return { ok: true, atualizados: modulos.length };
}

// ── 6. Revisão de Código ────────────────────────────────────────
async function revisarCodigo(spec, tenantId, jobId) {
  const systemPrompt = `Você é o CORTEX CODE REVIEWER da NEXIA OS.
Revise o código e retorne JSON:
{
  "score": 85,
  "problemas": [{"tipo": "bug|performance|security|style", "descricao": "", "linha": 0, "sugestao": ""}],
  "pontos_positivos": [],
  "sugestoes_gerais": "",
  "codigo_melhorado": ""
}`;

  const raw = await callGroq(systemPrompt, `Código para revisar: ${spec}`);
  try { return JSON.parse(raw.replace(/```json|```/g, '').trim()); }
  catch(e) { return { score: 0, raw }; }
}

// ── 7. Listar Projetos ───────────────────────────────────────────
async function listarProjetos(tenantId) {
  if (!db) return { projetos: [] };
  const snap = await db.collection(`tenants/${tenantId}/autodev_jobs`)
    .orderBy('startedAt', 'desc').limit(20).get();
  return { projetos: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
}

// ── 8. Gerar Docs ────────────────────────────────────────────────
async function gerarDocs(spec, tenantId, jobId) {
  const raw = await callGroq(
    'Gere documentação técnica completa em Markdown para o seguinte sistema da NEXIA OS:',
    spec
  );
  if (db) {
    await db.collection(`tenants/${tenantId}/docs`).add({
      spec, markdown: raw, geradoEm: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  return { markdown: raw };
}

// ── 9. Execução Genérica ─────────────────────────────────────────
async function execucaoGenerica(action, spec, tenantId, jobId) {
  const raw = await callGroq(
    `Você é o CORTEX da NEXIA OS executando a ação: ${action}. Responda em JSON.`,
    `Especificação: ${spec}`
  );
  try { return JSON.parse(raw.replace(/```json|```/g, '').trim()); }
  catch(e) { return { resultado: raw }; }
}

// ── Helper: Atualizar progresso ──────────────────────────────────
async function updateProgress(tenantId, jobId, progress, message) {
  if (!db) return;
  try {
    await db.collection(`tenants/${tenantId}/autodev_jobs`).doc(jobId).update({ progress, message });
  } catch(e) { /* intentional no-op: optional cleanup step */ }
}

// ── Handler principal ────────────────────────────────────────────
exports.handler = async (event) => {
  // FIX v41: CRITICAL — endpoint was fully unauthenticated, allowing anyone to
  // consume AI API quota, write to Firestore store/modules, and list tenant jobs.
  // Now requires valid Firebase Bearer token (any authenticated user).
  const authErr = await requireBearerAuth(event);
  if (authErr) return authErr;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS };

  try {
    const body = JSON.parse(event.body || '{}');
    const { action, spec, tenantId = 'nexia', userId = 'system', jobId } = body;

    // GET: listar jobs
    if (event.httpMethod === 'GET') {
      const tid = event.queryStringParameters?.tenantId || 'nexia';
      if (!db) return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ jobs: [] }) };
      const snap = await db.collection(`tenants/${tid}/autodev_jobs`)
        .orderBy('startedAt', 'desc').limit(20).get();
      return { statusCode: 200, headers: HEADERS,
        body: JSON.stringify({ jobs: snap.docs.map(d => ({ id: d.id, ...d.data() })) }) };
    }

    // POST: executar ação
    if (!action) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: `Ação inválida: "${action}"`, validActions: VALID_ACTIONS }) };
    if (!VALID_ACTIONS.includes(action)) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: `Ação inválida: "${action}"`, validActions: VALID_ACTIONS }) };

    const result = await autoProgram(action, spec || '', tenantId, userId);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify(result) };

  } catch (err) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
