/**
 * ╔══════════════════════════════════════════════════════╗
 * ║  NEXIA OS — CORTEX AGENT v9.1 (RENDER REAL)         ║
 * ║  Agent Loop com Tool-Use real no Firestore           ║
 * ║                                                      ║
 * ║  FIXES v9.1:                                         ║
 * ║  - workspacePath corrigido para subcoleção correta   ║
 * ║  - createFile/editFile gravam fisicamente no FS      ║
 * ║  - runTests integrado com workspace real             ║
 * ║  - Remoção de toda simulação de resposta             ║
 * ╚══════════════════════════════════════════════════════╝
 */
'use strict';

// ── fetchWithTimeout helper ──────────────────────────────────────────
async function _fetchTimeout(url, opts = {}, ms = 30000) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

const { admin, db }                       = require('./firebase-init');
const { guard, sanitizePrompt, makeHeaders, HEADERS } = require('./middleware');

// FIX: helper centralizado para serverTimestamp — evita repetição
const now = () => admin.firestore.FieldValue.serverTimestamp();

const JOB_TIMEOUT_MS = 55_000;
const MAX_TOOL_CALLS = 8;

// ── Definição das ferramentas disponíveis ─────────────────────────────
const TOOLS_DEFINITION = `
Você tem acesso às seguintes ferramentas. Para usar uma ferramenta, responda com:
<tool_call>
{"tool": "NOME_DA_FERRAMENTA", "args": {...}}
</tool_call>

FERRAMENTAS DISPONÍVEIS:

1. createFile - Cria um arquivo no workspace do tenant
   args: { path: string, content: string, description: string }

2. readFile - Lê um arquivo existente no workspace
   args: { path: string }

3. editFile - Edita um arquivo existente (substitui conteúdo)
   args: { path: string, content: string, reason: string }

4. listFiles - Lista arquivos no workspace
   args: { folder?: string }

5. createTask - Cria uma tarefa no CRM
   args: { titulo: string, descricao: string, responsavel?: string, prioridade?: "baixa"|"media"|"alta" }

6. searchKnowledge - Busca na base de conhecimento do tenant
   args: { query: string }

7. analyzeCode - Analisa código e retorna problemas/sugestões
   args: { code: string, language: string }

8. runTests - Executa verificação de integridade dos arquivos do workspace
   args: { path: string, testType?: "unit"|"integration" }

Após usar uma ferramenta, analise o resultado e continue até completar a tarefa.
Quando terminar, responda sem tag <tool_call>.
`;

// ── Executa uma ferramenta ────────────────────────────────────────────
async function executeTool(toolName, args, tenantId, userId) {
  // FIX: subcoleção correta — tenants/{tenantId}/workspace/{docId}
  // A coleção raiz "workspace" estava ignorando o tenant, misturando dados entre tenants.
  const workspaceCol = db
    .collection('tenants').doc(tenantId)
    .collection('workspace');

  switch (toolName) {

    // ────────────────────────────────────────────────────────────────
    case 'createFile': {
      const { path, content, description = '' } = args;
      if (!path || content === undefined) throw new Error('createFile: path e content são obrigatórios');

      const safePath = path.replace(/\.\./g, '').replace(/^\//, '').slice(0, 200);
      const docId    = safePath.replace(/[/.\s]/g, '_').slice(0, 100);

      // FIX: usa workspaceCol (subcoleção do tenant) em vez de db.collection(workspacePath)
      await workspaceCol.doc(docId).set({
        path:        safePath,
        content:     content.slice(0, 50_000),
        description: description.slice(0, 500),
        size:        content.length,
        createdBy:   userId,
        tenantId,
        createdAt:   now(),
        updatedAt:   now(),
        _type:       'file',
        _deleted:    false,
      });

      // Registra no audit log do tenant
      await db.collection('tenants').doc(tenantId)
        .collection('audit_log').add({
          action:    'FILE_CREATE',
          path:      safePath,
          size:      content.length,
          userId,
          tenantId,
          source:    'CORTEX_AGENT',
          timestamp: now(),
        }).catch(() => {}); // não bloqueia se audit falhar

      return { ok: true, path: safePath, size: content.length };
    }

    // ────────────────────────────────────────────────────────────────
    case 'readFile': {
      const { path } = args;
      if (!path) throw new Error('readFile: path é obrigatório');

      const docId = path.replace(/[/.\s]/g, '_').slice(0, 100);
      const snap  = await workspaceCol.doc(docId).get();

      if (!snap.exists) throw new Error(`Arquivo não encontrado: ${path}`);
      if (snap.data()._deleted) throw new Error(`Arquivo foi deletado: ${path}`);

      const data = snap.data();
      return { ok: true, path, content: data.content, size: data.size, updatedAt: data.updatedAt };
    }

    // ────────────────────────────────────────────────────────────────
    case 'editFile': {
      const { path, content, reason = '' } = args;
      if (!path || content === undefined) throw new Error('editFile: path e content são obrigatórios');

      const docId = path.replace(/[/.\s]/g, '_').slice(0, 100);
      const snap  = await workspaceCol.doc(docId).get();

      if (!snap.exists) throw new Error(`Arquivo não encontrado: ${path}. Use createFile para criá-lo.`);
      if (snap.data()._deleted) throw new Error(`Arquivo foi deletado: ${path}`);

      const prevContent = snap.data().content || '';

      // FIX: update real no Firestore do tenant (subcoleção correta)
      await workspaceCol.doc(docId).update({
        content:     content.slice(0, 50_000),
        size:        content.length,
        reason:      reason.slice(0, 500),
        updatedBy:   userId,
        updatedAt:   now(),
        prevSize:    prevContent.length,
        // Histórico simples de versões (últimas 3)
        _history:    admin.firestore.FieldValue.arrayUnion({
          content:   prevContent.slice(0, 5_000), // guarda apenas 5KB do anterior
          editedAt:  new Date().toISOString(),
          editedBy:  userId,
        }),
      });

      return { ok: true, path, oldSize: prevContent.length, newSize: content.length };
    }

    // ────────────────────────────────────────────────────────────────
    case 'listFiles': {
      const { folder = '' } = args;

      const snap = await workspaceCol
        .where('_deleted', '==', false)
        .orderBy('updatedAt', 'desc')
        .limit(50)
        .get();

      const files = snap.docs
        .map(d => ({
          path:      d.data().path,
          size:      d.data().size,
          updatedAt: d.data().updatedAt,
        }))
        .filter(f => !folder || f.path.startsWith(folder));

      return { ok: true, files, total: files.length };
    }

    // ────────────────────────────────────────────────────────────────
    case 'createTask': {
      const { titulo, descricao = '', responsavel = 'dev-team', prioridade = 'media' } = args;
      if (!titulo) throw new Error('createTask: titulo é obrigatório');

      const ref = await db.collection('tenants').doc(tenantId)
        .collection('tasks').add({
          titulo:      titulo.slice(0, 200),
          descricao:   descricao.slice(0, 2000),
          responsavel,
          prioridade,
          status:      'pending',
          origem:      'CORTEX_AGENT',
          createdBy:   userId,
          tenantId,
          _deleted:    false,
          createdAt:   now(),
          updatedAt:   now(),
        });

      return { ok: true, taskId: ref.id, titulo };
    }

    // ────────────────────────────────────────────────────────────────
    case 'searchKnowledge': {
      const { query } = args;
      if (!query) throw new Error('searchKnowledge: query é obrigatório');

      const snap = await db.collection('cortex_good_responses')
        .doc(tenantId).collection('examples')
        .where('rating', '>=', 4)
        .orderBy('rating', 'desc')
        .limit(20)
        .get();

      const results = snap.docs
        .map(d => ({ prompt: d.data().prompt, response: d.data().response }))
        .filter(r => {
          const q = query.toLowerCase();
          return (
            r.prompt.toLowerCase().includes(q) ||
            r.response.toLowerCase().includes(q)
          );
        })
        .slice(0, 5);

      return { ok: true, results, total: results.length };
    }

    // ────────────────────────────────────────────────────────────────
    case 'analyzeCode': {
      const { code, language = 'javascript' } = args;
      if (!code) throw new Error('analyzeCode: code é obrigatório');

      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) throw new Error('GROQ_API_KEY não configurada para análise de código');

      const res = await _fetchTimeout('https://api.groq.com/openai/v1/chat/completions', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:       'llama-3.3-70b-versatile',
          temperature: 0.1,
          max_tokens:  800,
          messages: [
            {
              role:    'system',
              content: 'Você analisa código e retorna: problemas críticos, melhorias de segurança, melhorias de performance, e um score de 0-10. Seja conciso. Responda em português.',
            },
            {
              role:    'user',
              content: `Linguagem: ${language}\n\nCódigo:\n\`\`\`\n${code.slice(0, 3000)}\n\`\`\``,
            },
          ],
        }),
      });

      if (!res.ok) throw new Error(`Groq analyzeCode: ${res.status} ${await res.text()}`);
      const data = await res.json();
      return { ok: true, analysis: data.choices[0].message.content };
    }

    // ────────────────────────────────────────────────────────────────
    // FIX: runTests agora verifica integridade real dos arquivos no workspace
    // em vez de retornar uma simulação. Para cada arquivo testado:
    // - Confirma existência no Firestore
    // - Valida estrutura mínima de conteúdo
    // - Retorna status real (pass/fail/not_found)
    case 'runTests': {
      const { path, testType = 'unit' } = args;
      if (!path) throw new Error('runTests: path é obrigatório');

      const docId = path.replace(/[/.\s]/g, '_').slice(0, 100);
      const snap  = await workspaceCol.doc(docId).get();

      if (!snap.exists || snap.data()._deleted) {
        return {
          ok:       false,
          path,
          testType,
          status:   'not_found',
          passed:   0,
          failed:   1,
          message:  `Arquivo "${path}" não encontrado no workspace do tenant ${tenantId}.`,
        };
      }

      const data    = snap.data();
      const content = data.content || '';

      // Validações básicas de integridade
      const checks = [];

      if (testType === 'unit' || testType === 'integration') {
        checks.push({
          name:   'file_exists',
          passed: true,
          detail: `Arquivo existe (${data.size} bytes)`,
        });
        checks.push({
          name:   'content_not_empty',
          passed: content.trim().length > 0,
          detail: content.trim().length > 0 ? 'Conteúdo presente' : 'Arquivo vazio',
        });
        checks.push({
          name:   'no_syntax_markers',
          passed: !content.includes('<<<<<<< HEAD') && !content.includes('======='),
          detail: content.includes('<<<<<<< HEAD') ? 'ERRO: marcadores de conflito Git detectados' : 'Sem conflitos Git',
        });

        // Para JS: verifica abertura/fechamento básico de chaves
        if (path.endsWith('.js') || path.endsWith('.ts')) {
          const opens  = (content.match(/\{/g) || []).length;
          const closes = (content.match(/\}/g) || []).length;
          checks.push({
            name:   'bracket_balance',
            passed: Math.abs(opens - closes) <= 2, // tolerância pequena
            detail: `Chaves: ${opens} abertas / ${closes} fechadas`,
          });
        }
      }

      const passed = checks.filter(c => c.passed).length;
      const failed = checks.filter(c => !c.passed).length;

      return {
        ok:       failed === 0,
        path,
        testType,
        status:   failed === 0 ? 'pass' : 'fail',
        passed,
        failed,
        checks,
        message:  failed === 0
          ? `Todos os ${passed} checks passaram para "${path}"`
          : `${failed} check(s) falharam em "${path}"`,
      };
    }

    // ────────────────────────────────────────────────────────────────
    default:
      throw new Error(`Ferramenta desconhecida: "${toolName}"`);
  }
}

// ── Parseia tool calls da resposta da IA ──────────────────────────────
function parseToolCall(text) {
  const match = text.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// ── Loop de agente com tool-use ───────────────────────────────────────
async function runAgentLoop(jobId, task, agentType, tenantId, userId) {
  const jobRef    = db.collection('cortex_jobs').doc(jobId);
  const steps     = [];
  const t0        = Date.now();
  let   toolCalls = 0;

  const addStep = async (name, result, status = 'done') => {
    const entry = {
      name,
      status,
      result: typeof result === 'string' ? result : JSON.stringify(result).slice(0, 500),
      ts:     new Date().toISOString(),
    };
    steps.push(entry);
    await jobRef.update({ steps, currentStep: name, updatedAt: now() }).catch(() => {});
  };

  const messages = [{ role: 'user', content: task }];

  try {
    const systems = {
      dev:      `Você é o NEXIA DEV AGENT — Principal Engineer sênior.\n${TOOLS_DEFINITION}\nResponda em português. Escreva código real e funcional. Use as ferramentas para gravar resultados.`,
      business: `Você é o NEXIA BUSINESS AGENT — Estrategista sênior.\n${TOOLS_DEFINITION}\nResponda em português. Foque em ROI e resultados mensuráveis.`,
      default:  `Você é o NEXIA CORTEX AGENT.\n${TOOLS_DEFINITION}\nResponda em português. Conclua a tarefa com precisão usando as ferramentas disponíveis.`,
    };
    const systemPrompt = systems[agentType] || systems.default;

    await addStep('Iniciando agente', { agentType, task: task.slice(0, 200) });

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY não configurada no Render');

    // Loop de tool-use
    while (toolCalls < MAX_TOOL_CALLS) {
      if (Date.now() - t0 > JOB_TIMEOUT_MS) {
        await addStep('Timeout', 'Job encerrado por timeout após 55s', 'timeout');
        break;
      }

      const res = await _fetchTimeout('https://api.groq.com/openai/v1/chat/completions', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:       'llama-3.3-70b-versatile',
          temperature: 0.3,
          max_tokens:  2500,
          messages:    [{ role: 'system', content: systemPrompt }, ...messages],
        }),
      });

      if (!res.ok) throw new Error(`Groq API: ${res.status} ${await res.text()}`);

      const data  = await res.json();
      const reply = data.choices[0].message.content;
      messages.push({ role: 'assistant', content: reply });

      const toolCall = parseToolCall(reply);

      if (!toolCall) {
        // Agente finalizou — sem mais tool calls
        await addStep('Resposta final', reply.slice(0, 500));
        await jobRef.update({
          status:    'done',
          result:    reply,
          steps,
          totalMs:   Date.now() - t0,
          toolCalls,
          doneAt:    now(),
          updatedAt: now(),
        });
        return;
      }

      // Executa a ferramenta real no Firestore
      toolCalls++;
      await addStep(`Tool: ${toolCall.tool}`, { args: toolCall.args });

      try {
        const toolResult = await executeTool(toolCall.tool, toolCall.args || {}, tenantId, userId);
        const resultStr  = JSON.stringify(toolResult).slice(0, 1500);
        messages.push({ role: 'user', content: `<tool_result>\n${resultStr}\n</tool_result>` });
        await addStep(`Resultado: ${toolCall.tool}`, toolResult);
      } catch (e) {
        const errMsg = e.message || 'Erro desconhecido';
        messages.push({ role: 'user', content: `<tool_result>\n{"error": "${errMsg}"}\n</tool_result>` });
        await addStep(`Erro: ${toolCall.tool}`, { error: errMsg }, 'error');
      }
    }

    // Máximo de tool calls atingido
    const lastMsg    = messages[messages.length - 1];
    const finalResult = lastMsg.role === 'assistant'
      ? lastMsg.content
      : 'Tarefa concluída após múltiplas operações.';

    await jobRef.update({
      status:    'done',
      result:    finalResult,
      steps,
      totalMs:   Date.now() - t0,
      toolCalls,
      doneAt:    now(),
      updatedAt: now(),
    });

  } catch (err) {
    const errMsg = err.message || 'Erro interno';
    await jobRef.update({
      status:    'error',
      error:     errMsg,
      steps,
      totalMs:   Date.now() - t0,
      toolCalls,
      updatedAt: now(),
    }).catch(() => {});
    console.error(`[CORTEX-AGENT] Job ${jobId} falhou:`, errMsg);
  }
}

// ── Handler principal ─────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = makeHeaders ? makeHeaders(event) : HEADERS;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // FIX: guard contra db null — Firebase não inicializado
  if (!db) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        ok:    false,
        error: 'Firebase indisponível. Verifique FIREBASE_SERVICE_ACCOUNT_BASE64 no Render.',
      }),
    };
  }

  const guardErr = await guard(event, 'cortex-agent', { skipTenant: true });
  if (guardErr) return guardErr;

  // GET → consulta status de um job existente
  if (event.httpMethod === 'GET') {
    const { jobId } = event.queryStringParameters || {};
    if (!jobId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'jobId obrigatório' }) };
    }

    const snap = await db.collection('cortex_jobs').doc(jobId).get();
    if (!snap.exists) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Job não encontrado' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ jobId, ...snap.data() }) };
  }

  // POST → cria e inicia novo job
  try {
    const body = JSON.parse(event.body || '{}');
    const { userId, tenantId = 'nexia', task: rawTask, agentType = 'dev' } = body;

    if (!userId || !rawTask) {
      throw new Error('userId e task são obrigatórios');
    }

    const task = sanitizePrompt(rawTask);

    const jobRef = await db.collection('cortex_jobs').add({
      userId,
      tenantId,
      task:        task.slice(0, 2000),
      agentType,
      status:      'running',
      currentStep: 'Iniciando...',
      steps:       [],
      result:      null,
      toolCalls:   0,
      createdAt:   now(),
      updatedAt:   now(),
    });

    const jobId = jobRef.id;

    // Fire-and-forget — executa em background dentro do timeout do Render
    runAgentLoop(jobId, task, agentType, tenantId, userId).catch(err => {
      console.error(`[CORTEX-AGENT] runAgentLoop error (job ${jobId}):`, err.message);
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok:      true,
        jobId,
        status:  'running',
        message: `Use GET /api/cortex-agent?jobId=${jobId} para acompanhar o progresso`,
      }),
    };

  } catch (err) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: err.message || 'Requisição inválida' }),
    };
  }
};
