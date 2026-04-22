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
 * ║  NEXIA OS — PABX Handler v1.1                        ║
 * ║  Twilio / Zenvia integration + URA routing           ║
 * ╚══════════════════════════════════════════════════════╝
 */
const { admin, db } = require('./firebase-init');

const { requireBearerAuth, makeHeaders } = require('./middleware');

exports.handler = async (event, context) => {
  const { httpMethod, body, queryStringParameters } = event;
  const headers = makeHeaders(event);
  if (!db) return { statusCode: 503, headers: headers, body: JSON.stringify({ ok: false, error: 'Firebase indisponível — configure FIREBASE_SERVICE_ACCOUNT.' }) };
  if (httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  // CORRIGIDO v38: PABX controla chamadas telefônicas — autenticação obrigatória
  const _authErr = await requireBearerAuth(event);
  if (_authErr) return _authErr;

  try {
    if (httpMethod === 'POST') {
      const data = JSON.parse(body || '{}');
      const { type, tenantId } = data;

      // Twilio voice webhook
      if (type === 'voice' || data.CallStatus) {
        const callRef = db.collection('tenants').doc(tenantId || 'global').collection('calls');
        await callRef.add({
          callSid: data.CallSid || data.call_id,
          from: data.From || data.from,
          to: data.To || data.to,
          status: data.CallStatus || data.status,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          provider: data.CallSid ? 'twilio' : 'zenvia'
        });
        return { statusCode: 200, headers, body: JSON.stringify({ status: 'logged', callSid: data.CallSid }) };
      }

      // Zenvia SMS webhook
      if (type === 'sms' || data.message) {
        const smsRef = db.collection('tenants').doc(tenantId || 'global').collection('sms_log');
        await smsRef.add({
          from: data.from,
          to: data.to,
          message: data.message,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        return { statusCode: 200, headers, body: JSON.stringify({ status: 'received' }) };
      }

      // Outbound call via Twilio REST
      if (type === 'outbound') {
        const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM } = process.env;
        if (!TWILIO_ACCOUNT_SID) return { statusCode: 503, headers, body: JSON.stringify({ error: 'Twilio not configured' }) };
        const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`, {
          method: 'POST',
          headers: { 'Authorization': 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ To: data.to, From: TWILIO_FROM, Url: `${process.env.NEXIA_APP_URL}/api/pabx?twiml=1` })
        });
        const result = await resp.json();
        return { statusCode: 200, headers, body: JSON.stringify({ status: 'calling', sid: result.sid }) };
      }
    }

    // TwiML URA response
    if (httpMethod === 'GET' && queryStringParameters?.twiml) {
      return { statusCode: 200, headers: { 'Content-Type': 'text/xml' }, body: `<?xml version="1.0"?><Response><Say voice="Polly.Camila" language="pt-BR">Bem-vindo ao NEXIA. Aguarde um momento.</Say><Pause length="1"/></Response>` };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ status: 'online', service: 'NEXIA PABX v1.1' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
