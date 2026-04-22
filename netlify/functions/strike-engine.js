'use strict';

// ── fetchWithTimeout helper ──
async function _fetchTimeout(url, opts = {}, ms = 30000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(tid); }
}

/**
 * NEXIA OS — Strike Engine v2.0
 * Campanha de denúncia coletiva via usuários REAIS
 * POST /api/strike
 * Actions: create | join | list | status | close | add_pool_profile | remove_pool_profile | list_pool
 */

const { admin, db } = require('./firebase-init');

const { requireBearerAuth, makeHeaders } = require('./middleware');

const REPORT_LINKS = {
  youtube:   'https://support.google.com/youtube/answer/2802268',
  instagram: 'https://help.instagram.com/165828726929246',
  facebook:  'https://www.facebook.com/help/263149623790594',
  twitter:   'https://help.twitter.com/en/safety-and-security/report-a-tweet',
  tiktok:    'https://support.tiktok.com/en/safety-hc/report-a-problem/report-a-video',
  linkedin:  'https://www.linkedin.com/help/linkedin/answer/67432',
  whatsapp:  'https://faq.whatsapp.com/general/security-and-privacy/how-to-report-a-contact-or-group',
  google:    'https://support.google.com/legal/troubleshooter/1114905',
  twitch:    'https://safety.twitch.tv/s/article/Filing-a-User-Report',
  kwai:      'https://www.kwai.com/safety',
  threads:   'https://help.instagram.com/threads',
};

async function classifyViaAI(url, descricao) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { categoria:'outro', severidade:3, confianca:0.5, justificativa:'Sem GROQ_API_KEY', urgente:false };
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST',
      headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
      body: JSON.stringify({
        model:'llama-3.3-70b-versatile', max_tokens:300, temperature:0,
        messages:[{role:'user',content:
          'Classifique este conteúdo de mídia social:\nURL: '+url+'\nDescrição: '+descricao+
          '\n\nResponda APENAS JSON:\n{"categoria":"anuncio_falso|conteudo_sexual|assedio|discurso_odio|desinformacao|golpe|spam|abuso_infantil|outro","severidade":1-5,"confianca":0.0-1.0,"justificativa":"max 100 chars","urgente":true|false}'
        }]
      })
    });
    const d = await r.json();
    try { return JSON.parse(d.choices?.[0]?.message?.content?.replace(/```json\n?|```/g,'').trim() || '{}'); } catch(e) { return {}; }
  } catch { return { categoria:'outro', severidade:3, confianca:0.5, justificativa:'Erro IA', urgente:false }; }
}

exports.handler = async (event) => {
  const h = makeHeaders(event);
  if (!db) return { statusCode: 503, headers: h, body: JSON.stringify({ ok: false, error: 'Firebase indisponível — configure FIREBASE_SERVICE_ACCOUNT.' }) };
  if (event.httpMethod === 'OPTIONS') return {statusCode:200,headers:h,body:''};
  const authErr = await requireBearerAuth(event);
  if (authErr) return authErr;

  let body={};
  try{body=JSON.parse(event.body||'{}');}catch{return{statusCode:400,headers:h,body:JSON.stringify({error:'JSON inválido'})}}
  const {action, tenantId} = body;

  // ── CREATE CAMPAIGN ──────────────────────────────────────────────────────
  if (action === 'create') {
    const {url, plataforma, descricao, titulo} = body;
    if (!url || !plataforma) return {statusCode:400,headers:h,body:JSON.stringify({error:'url e plataforma obrigatórios'})};

    const classificacao = await classifyViaAI(url, descricao||'');
    const campaignId = 'STK-' + Date.now();
    const reportLink = REPORT_LINKS[plataforma] || null;

    const campaign = {
      id: campaignId,
      titulo: titulo || ('Denúncia: ' + plataforma.toUpperCase()),
      url, plataforma, descricao: descricao||'', reportLink,
      classificacao, categoria: classificacao.categoria,
      severidade: classificacao.severidade,
      status: 'ativa', criadoPor: event._uid,
      participantes: 0, meta: classificacao.urgente ? 100 : 50,
      criadoEm: new Date().toISOString()
    };

    let notificados = 0;
    if (db) {
      const writes = [];
      if (tenantId) {
        writes.push(
          db.collection('tenants').doc(tenantId).collection('strike_campaigns').doc(campaignId).set({
            ...campaign, criadoEm: admin.firestore.FieldValue.serverTimestamp()
          }),
          db.collection('tenants').doc(tenantId).collection('notifications').add({
            tipo:'strike_campaign',
            titulo:'🚨 Nova campanha: ' + campaign.titulo,
            body:'Conteúdo abusivo em '+plataforma+'. Clique para denunciar!',
            campaignId, url: reportLink, lida:false,
            criadoEm: admin.firestore.FieldValue.serverTimestamp()
          })
        );
        // Contar membros do tenant
        try {
          const members = await db.collection('tenants').doc(tenantId).collection('members').get();
          notificados += members.size;
        } catch {}
      }
      // Notificar pool global
      try {
        const poolCol = tenantId
          ? db.collection('tenants').doc(tenantId).collection('strike_pool')
          : db.collection('strike_pool_global');
        const pool = await poolCol.get();
        notificados += pool.size;
        // Salvar notificação para o pool também (email seria via webhook externo)
        if (tenantId && pool.size > 0) {
          writes.push(
            db.collection('tenants').doc(tenantId).collection('pool_notifications').add({
              campaignId, plataforma, reportLink, titulo: campaign.titulo,
              criadoEm: admin.firestore.FieldValue.serverTimestamp()
            })
          );
        }
      } catch {}
      await Promise.all(writes);
    }

    return {statusCode:201,headers:h,body:JSON.stringify({ok:true, campaign, notificados})};
  }

  // ── JOIN ─────────────────────────────────────────────────────────────────
  if (action === 'join') {
    const {campaignId} = body;
    if (!db || !tenantId || !campaignId) return {statusCode:400,headers:h,body:JSON.stringify({error:'parâmetros obrigatórios'})};

    const ref = db.collection('tenants').doc(tenantId).collection('strike_campaigns').doc(campaignId);
    const doc = await ref.get();
    if (!doc.exists) return {statusCode:404,headers:h,body:JSON.stringify({error:'Campanha não encontrada'})};

    const data = doc.data();
    const partRef = ref.collection('participantes').doc(event._uid);
    const already = await partRef.get();
    if (already.exists) {
      return {statusCode:200,headers:h,body:JSON.stringify({ok:true,jaParticipou:true,total:data.participantes,reportLink:data.reportLink})};
    }
    await Promise.all([
      partRef.set({uid:event._uid, timestamp:admin.firestore.FieldValue.serverTimestamp()}),
      ref.update({participantes:admin.firestore.FieldValue.increment(1)})
    ]);
    const total = (data.participantes||0)+1;
    return {statusCode:200,headers:h,body:JSON.stringify({ok:true,jaParticipou:false,total,reportLink:data.reportLink,instrucoes:'Abra o link oficial da '+data.plataforma+' e denuncie usando a categoria: '+data.categoria})};
  }

  // ── LIST ─────────────────────────────────────────────────────────────────
  if (action === 'list') {
    if (!db || !tenantId) return {statusCode:400,headers:h,body:JSON.stringify({error:'tenantId obrigatório'})};
    try {
      const snap = await db.collection('tenants').doc(tenantId).collection('strike_campaigns')
        .where('status','==','ativa').orderBy('criadoEm','desc').limit(30).get();
      return {statusCode:200,headers:h,body:JSON.stringify({ok:true,campaigns:snap.docs.map(d=>({id:d.id,...d.data()}))})};
    } catch(e) {
      // fallback sem orderBy se não tiver índice
      const snap = await db.collection('tenants').doc(tenantId).collection('strike_campaigns').limit(30).get();
      return {statusCode:200,headers:h,body:JSON.stringify({ok:true,campaigns:snap.docs.filter(d=>d.data().status==='ativa').map(d=>({id:d.id,...d.data()}))})};
    }
  }

  // ── STATUS ────────────────────────────────────────────────────────────────
  if (action === 'status') {
    const {campaignId} = body;
    if (!db || !tenantId || !campaignId) return {statusCode:400,headers:h,body:JSON.stringify({error:'parâmetros obrigatórios'})};
    const doc = await db.collection('tenants').doc(tenantId).collection('strike_campaigns').doc(campaignId).get();
    if (!doc.exists) return {statusCode:404,headers:h,body:JSON.stringify({error:'Não encontrada'})};
    return {statusCode:200,headers:h,body:JSON.stringify({ok:true,campaign:{id:doc.id,...doc.data()}})};
  }

  // ── CLOSE ─────────────────────────────────────────────────────────────────
  if (action === 'close') {
    const {campaignId, resultado} = body;
    if (!db || !tenantId || !campaignId) return {statusCode:400,headers:h,body:JSON.stringify({error:'parâmetros obrigatórios'})};
    await db.collection('tenants').doc(tenantId).collection('strike_campaigns').doc(campaignId).update({
      status:'encerrada', resultado:resultado||'encerrado_manualmente',
      encerradoEm:admin.firestore.FieldValue.serverTimestamp()
    });
    return {statusCode:200,headers:h,body:JSON.stringify({ok:true,message:'Campanha encerrada'})};
  }

  // ── POOL: ADD ─────────────────────────────────────────────────────────────
  if (action === 'add_pool_profile') {
    const {nome, email, telefone, descricao} = body;
    if (!nome || !email) return {statusCode:400,headers:h,body:JSON.stringify({error:'nome e email obrigatórios'})};
    if (!db || !tenantId) return {statusCode:400,headers:h,body:JSON.stringify({error:'tenantId obrigatório'})};
    const profileId = 'POOL-' + Date.now();
    await db.collection('tenants').doc(tenantId).collection('strike_pool').doc(profileId).set({
      id:profileId, nome, email, telefone:telefone||'', descricao:descricao||'',
      ativo:true, criadoPor:event._uid,
      criadoEm:admin.firestore.FieldValue.serverTimestamp()
    });
    return {statusCode:201,headers:h,body:JSON.stringify({ok:true,profileId,message:'Perfil adicionado ao pool'})};
  }

  // ── POOL: REMOVE ──────────────────────────────────────────────────────────
  if (action === 'remove_pool_profile') {
    const {profileId} = body;
    if (!db || !tenantId || !profileId) return {statusCode:400,headers:h,body:JSON.stringify({error:'parâmetros obrigatórios'})};
    await db.collection('tenants').doc(tenantId).collection('strike_pool').doc(profileId).delete();
    return {statusCode:200,headers:h,body:JSON.stringify({ok:true,message:'Perfil removido'})};
  }

  // ── POOL: LIST ────────────────────────────────────────────────────────────
  if (action === 'list_pool') {
    if (!db || !tenantId) return {statusCode:400,headers:h,body:JSON.stringify({error:'tenantId obrigatório'})};
    const snap = await db.collection('tenants').doc(tenantId).collection('strike_pool').get();
    return {statusCode:200,headers:h,body:JSON.stringify({ok:true,profiles:snap.docs.map(d=>({id:d.id,...d.data()})),total:snap.size})};
  }

  return {statusCode:400,headers:h,body:JSON.stringify({error:'Ação desconhecida: '+action+'. Use: create|join|list|status|close|add_pool_profile|remove_pool_profile|list_pool'})};
};
