// ── fetchWithTimeout helper ──────────────────────────────────────
async function _fetchTimeout(url, opts = {}, ms = 30000, _legacyOpts) {
  if (_legacyOpts && typeof _legacyOpts === 'object') opts = _legacyOpts;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

const { requireBearerAuth, makeHeaders } = require('./middleware');
// ═══════════════════════════════════════════════════════════════
// NEXIA NF-e & NFS-e Engine — Integração SEFAZ
// POST /api/nfe
// actions: emit_nfe, emit_nfse, cancel, query_status,
//          consult_cnpj, get_series, list
// ═══════════════════════════════════════════════════════════════
const { admin, db } = require('./firebase-init');

// ── NFe.io API (abstração SEFAZ) ────────────────────────────────
// Usamos NFe.io como intermediário que abstrai SEFAZ de todos os estados
const NFEIO_BASE = 'https://api.nfe.io/v1';

async function nfeioCall(path, method = 'GET', body = null, apiKey = null) {
  const key = apiKey || process.env.NFEIO_API_KEY;
  if (!key) throw new Error('NFEIO_API_KEY not configured');

  const opts = {
    method,
    headers: {
      'Authorization': key,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await _fetchTimeout(`${NFEIO_BASE}${path}`, {}, 15000, opts);
  let data;
  try {
    data = await res.json();
  } catch {
    const raw = await res.text();
    data = { raw };
  }

  if (!res.ok) {
    const errMsg = data.message || data.error || `NFe.io error ${res.status}`;
    throw new Error(errMsg);
  }
  return data;
}

exports.handler = async (event) => {
  const headers = makeHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  // FIX v20: guard contra db null quando Firebase não está configurado
  if (!db) return { statusCode: 503, headers: makeHeaders ? makeHeaders(event) : HEADERS, body: JSON.stringify({ ok: false, error: 'Firebase indisponível — configure FIREBASE_SERVICE_ACCOUNT.' }) };

  // CORRIGIDO v38: NFe envolve dados fiscais — autenticação obrigatória
  const _authErr = await requireBearerAuth(event);
  if (_authErr) return _authErr;
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const { action, tenantId } = body;

    if (!action || !tenantId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'action and tenantId required' }) };
    }

    // Load tenant fiscal config
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();
    const tenantData = tenantDoc.data() || {};
    const fiscalCfg = tenantData.fiscalConfig || {};
    const companyId = fiscalCfg.nfeioCompanyId || body.companyId;
    const apiKey = fiscalCfg.nfeioApiKey; // per-tenant key if available

    // ── ACTION: emit_nfe (Nota Fiscal de Produto) ─────────────
    if (action === 'emit_nfe') {
      const { items, customer, paymentInfo, orderId, nature } = body;

      if (!items?.length || !customer) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'items and customer required' }) };
      }
      if (!companyId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'companyId not configured for this tenant' }) };
      }

      const nfePayload = buildNFePayload(items, customer, paymentInfo, nature);

      const result = await nfeioCall(
        `/companies/${companyId}/productinvoices`,
        'POST',
        nfePayload,
        apiKey
      );

      const nfeId = result.id || result.invoiceId;

      // Save to Firestore
      const nfeRef = await db.collection('tenants').doc(tenantId)
        .collection('fiscal_docs').add({
          type: 'nfe',
          nfeioId: nfeId,
          orderId: orderId || null,
          customer,
          items,
          totalValue: items.reduce((s, i) => s + (i.quantity * i.unitPrice), 0),
          status: result.status || 'pending',
          xmlUrl: result.xmlUrl || null,
          danfeUrl: result.danfeUrl || null,
          createdAt: FieldValue.serverTimestamp(),
          raw: result
        });

      // Send to customer by email if provided
      if (customer.email && result.danfeUrl) {
        await sendFiscalDocByEmail(tenantId, customer, result, 'NF-e');
      }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          success: true,
          nfeId,
          firestoreId: nfeRef.id,
          status: result.status,
          xmlUrl: result.xmlUrl,
          danfeUrl: result.danfeUrl,
          accessKey: result.accessKey
        })
      };
    }

    // ── ACTION: emit_nfse (Nota Fiscal de Serviço) ────────────
    if (action === 'emit_nfse') {
      const { service, customer, borrower, orderId } = body;

      if (!service || !customer) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'service and customer required' }) };
      }
      if (!companyId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'companyId not configured' }) };
      }

      const nfsePayload = {
        cityServiceCode: service.cityServiceCode || fiscalCfg.defaultCityServiceCode || '01.01',
        federalServiceCode: service.federalServiceCode || '1.01',
        description: service.description,
        servicesAmount: service.amount,
        deductionsAmount: service.deductions || 0,
        issRate: service.issRate || fiscalCfg.defaultIssRate || 0.05,
        issAmountWithheld: service.withholding || false,
        borrower: {
          federalTaxNumber: (customer.cnpj || customer.cpf || '').replace(/\D/g, ''),
          name: customer.name,
          email: customer.email,
          address: customer.address || {}
        }
      };

      const result = await nfeioCall(
        `/companies/${companyId}/serviceinvoices`,
        'POST',
        nfsePayload,
        apiKey
      );

      const nfseId = result.id;

      await db.collection('tenants').doc(tenantId)
        .collection('fiscal_docs').add({
          type: 'nfse',
          nfeioId: nfseId,
          orderId: orderId || null,
          customer,
          service,
          totalValue: service.amount,
          status: result.status || 'pending',
          pdfUrl: result.pdfUrl || null,
          xmlUrl: result.xmlUrl || null,
          createdAt: FieldValue.serverTimestamp()
        });

      if (customer.email && result.pdfUrl) {
        await sendFiscalDocByEmail(tenantId, customer, result, 'NFS-e');
      }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          success: true,
          nfseId,
          status: result.status,
          pdfUrl: result.pdfUrl,
          xmlUrl: result.xmlUrl,
          invoiceNumber: result.number
        })
      };
    }

    // ── ACTION: cancel ─────────────────────────────────────────
    if (action === 'cancel') {
      const { nfeioId, docType, reason } = body;
      if (!nfeioId || !docType) return { statusCode: 400, headers, body: JSON.stringify({ error: 'nfeioId and docType required' }) };
      if (!companyId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'companyId not configured' }) };

      const endpoint = docType === 'nfe'
        ? `/companies/${companyId}/productinvoices/${nfeioId}`
        : `/companies/${companyId}/serviceinvoices/${nfeioId}`;

      const result = await nfeioCall(endpoint, 'DELETE', { reason: reason || 'Cancelamento solicitado pelo cliente' }, apiKey);

      // Update Firestore
      const snap = await db.collection('tenants').doc(tenantId)
        .collection('fiscal_docs').where('nfeioId', '==', nfeioId).limit(1).get();
      if (!snap.empty) {
        await snap.docs[0].ref.update({ status: 'cancelled', cancelledAt: FieldValue.serverTimestamp() });
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, status: 'cancelled', result }) };
    }

    // ── ACTION: query_status ───────────────────────────────────
    if (action === 'query_status') {
      const { nfeioId, docType } = body;
      if (!nfeioId || !docType || !companyId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'nfeioId, docType, companyId required' }) };
      }

      const endpoint = docType === 'nfe'
        ? `/companies/${companyId}/productinvoices/${nfeioId}`
        : `/companies/${companyId}/serviceinvoices/${nfeioId}`;

      const result = await nfeioCall(endpoint, 'GET', null, apiKey);

      // Sync status to Firestore
      const snap = await db.collection('tenants').doc(tenantId)
        .collection('fiscal_docs').where('nfeioId', '==', nfeioId).limit(1).get();
      if (!snap.empty) {
        await snap.docs[0].ref.update({
          status: result.status,
          xmlUrl: result.xmlUrl || null,
          danfeUrl: result.danfeUrl || result.pdfUrl || null,
          accessKey: result.accessKey || null,
          number: result.number || null,
          updatedAt: FieldValue.serverTimestamp()
        });
      }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          status: result.status,
          number: result.number,
          accessKey: result.accessKey,
          xmlUrl: result.xmlUrl,
          danfeUrl: result.danfeUrl || result.pdfUrl,
          rejectReason: result.rejectReason
        })
      };
    }

    // ── ACTION: list ───────────────────────────────────────────
    if (action === 'list') {
      const { docType, limit: lim = 20, startAfter } = body;
      let q = db.collection('tenants').doc(tenantId)
        .collection('fiscal_docs')
        .orderBy('createdAt', 'desc')
        .limit(parseInt(lim));
      if (docType) q = q.where('type', '==', docType);

      const snap = await q.get();
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.()?.toISOString() }));

      return { statusCode: 200, headers, body: JSON.stringify({ docs, total: docs.length }) };
    }

    // ── ACTION: consult_cnpj ───────────────────────────────────
    if (action === 'consult_cnpj') {
      const { cnpj } = body;
      if (!cnpj) return { statusCode: 400, headers, body: JSON.stringify({ error: 'cnpj required' }) };
      const clean = cnpj.replace(/\D/g, '');
      // Use ReceitaWS (public API — no key needed)
      const res = await _fetchTimeout(`https://www.receitaws.com.br/v1/cnpj/${clean}`, {}, 15000);
      const data = await res.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };

  } catch (err) {
    console.error('NFe engine error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error' }) };
  }
};

// ── Build NF-e payload ──────────────────────────────────────────
function buildNFePayload(items, customer, paymentInfo, nature) {
  return {
    nature: nature || '1', // 1 = venda
    operationType: '1', // 1 = saída
    recipient: {
      federalTaxNumber: (customer.cnpj || customer.cpf || '').replace(/\D/g, ''),
      name: customer.name,
      email: customer.email,
      address: {
        country: 'BRA',
        postalCode: (customer.address?.cep || '').replace(/\D/g, ''),
        street: customer.address?.street || '',
        number: customer.address?.number || 'S/N',
        district: customer.address?.district || '',
        city: customer.address?.city || '',
        state: customer.address?.state || 'SP'
      }
    },
    items: items.map((item, i) => ({
      code: item.code || `ITEM${i + 1}`,
      description: item.description,
      quantity: item.quantity,
      unitOfMeasure: item.unit || 'UN',
      unitPrice: item.unitPrice,
      totalPrice: item.quantity * item.unitPrice,
      ncm: item.ncm || '00000000',
      cfop: item.cfop || '5102',
      icmsOrigin: item.icmsOrigin || 0,
      icmsTaxationCode: item.icmsTaxationCode || '400'
    })),
    payments: paymentInfo ? [{
      method: paymentInfo.method || '99', // 99 = outros
      amount: items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
    }] : []
  };
}

// ── Send fiscal doc by email via NEXIA notifications ────────────
async function sendFiscalDocByEmail(tenantId, customer, result, type) {
  try {
    const docUrl = result.danfeUrl || result.pdfUrl;
    await _fetchTimeout(`${process.env.NEXIA_APP_URL || process.env.URL}/api/notifications`, {}, 15000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send_email',
        tenantId,
        to: customer.email,
        subject: `Sua ${type} foi emitida — NEXIA`,
        html: `<p>Olá, ${customer.name}!</p>
          <p>Sua <strong>${type}</strong> foi emitida com sucesso.</p>
          <p><a href="${docUrl}" style="background:#0057FF;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">📄 Baixar ${type}</a></p>
          <p style="color:#666;font-size:12px">Documento gerado automaticamente pelo NEXIA OS.</p>`
      })
    });
  } catch (e) {
    console.warn('Failed to send fiscal doc email:', 'Internal error');
  }
}
