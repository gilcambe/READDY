'use strict';

// ── fetchWithTimeout helper — evita fetch() pendurado indefinidamente ──
async function _fetchTimeout(url, opts = {}, ms = 30000, _legacyOpts) {
  // Backward-compat: old call convention was _fetchTimeout(url, {}, ms, opts)
  if (_legacyOpts && typeof _legacyOpts === 'object') opts = _legacyOpts;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

/**
 * NEXIA OS — AutoCommit v1.0
 * Permite ao Cortex fazer commits diretos no GitHub
 * POST /api/autocommit
 * Body: { file, content, message, branch? }
 * Header: Authorization: Bearer <firebase_token>
 */

const { guard, makeHeaders } = require('./middleware');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO || 'SEU_USUARIO/nexiaos';
const GITHUB_API   = 'https://api.github.com';

exports.handler = async (event) => {
  const headers = makeHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  // Auth guard — apenas master pode fazer commits (FIX v41: requiredRole enforced in guard())
  const authErr = await guard(event, 'autocommit', { requiredRole: 'master' });
  if (authErr) return authErr;

  if (!GITHUB_TOKEN) return { statusCode: 400, headers, body: JSON.stringify({ error: 'GITHUB_TOKEN não configurado. Adicione no Netlify → Environment Variables.' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const { file, content, message = 'chore: auto-update via CORTEX', branch = 'main' } = body;

  if (!file || !content) return { statusCode: 400, headers, body: JSON.stringify({ error: 'file e content são obrigatórios' }) };

  // Sanitize file path — prevent directory traversal
  const safePath = file.replace(/\.\.\//g, '').replace(/^\//, '');

  try {
    // 1. Get current file SHA (required for update)
    const getRes = await _fetchTimeout(`${GITHUB_API}/repos/${GITHUB_REPO}/contents/${safePath}?ref=${branch}`, {}, 10000, {
      headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
    });

    let sha = undefined;
    if (getRes.status === 200) {
      const existing = await getRes.json();
      sha = existing.sha;
    } else if (getRes.status !== 404) {
      const err = await getRes.json();
      return { statusCode: 500, headers, body: JSON.stringify({ error: `GitHub GET falhou: ${'Internal error'}` }) };
    }

    // 2. Commit the file
    const commitBody = {
      message,
      content: Buffer.from(content).toString('base64'),
      branch,
      ...(sha ? { sha } : {})
    };

    const putRes = await _fetchTimeout(`${GITHUB_API}/repos/${GITHUB_REPO}/contents/${safePath}`, {}, 10000, {
      method: 'PUT',
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commitBody)
    });

    if (!putRes.ok) {
      const err = await putRes.json();
      return { statusCode: 500, headers, body: JSON.stringify({ error: `GitHub commit falhou: ${'Internal error'}` }) };
    }

    const result = await putRes.json();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        file: safePath,
        sha: result.content?.sha,
        commit: result.commit?.sha,
        url: result.content?.html_url,
        message: `✅ Commit feito: ${safePath}`
      })
    };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
