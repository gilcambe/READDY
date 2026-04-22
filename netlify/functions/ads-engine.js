'use strict';

// ── fetchWithTimeout helper ──
async function _fetchTimeout(url, opts = {}, ms = 30000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(tid); }
}

/**
 * NEXIA OS — Ads Engine v1.0
 * Módulo de tráfego pago — módulo separado vendido pela Nexia
 * Geração de criativos: 100% GRÁTIS via Groq
 * Criar campanhas: requer credenciais do CLIENTE (Meta/Google)
 * POST /api/ads
 */

const { admin, db } = require('./firebase-init');

const { requireBearerAuth, makeHeaders } = require('./middleware');

async function generateAdCreative(produto, publico, objetivo, tom) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY não configurada');
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:'POST', headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
    body: JSON.stringify({
      model:'llama-3.3-70b-versatile', max_tokens:1500, temperature:0.7,
      messages:[{role:'user',content:
        'Você é um copywriter especialista em tráfego pago.\n\n'+
        'Produto/Serviço: '+produto+'\nPúblico-alvo: '+publico+'\nObjetivo: '+objetivo+'\nTom: '+(tom||'profissional')+'\n\n'+
        'Gere criativos para:\n1) META ADS: headline(40c), texto_principal(125c), descricao(30c), cta, segmentacao[]\n'+
        '2) GOOGLE ADS: titulo1(30c), titulo2(30c), titulo3(30c), descricao1(90c), descricao2(90c), keywords[10]\n'+
        '3) STORIES/REELS: gancho, texto(150c), hashtags[5]\n\n'+
        'Responda APENAS JSON:\n{"meta":{"headline":"","texto_principal":"","descricao":"","cta":"","segmentacao":[]},"google":{"titulo1":"","titulo2":"","titulo3":"","descricao1":"","descricao2":"","keywords":[]},"stories":{"gancho":"","texto":"","hashtags":[]},"dicas":[]}'
      }]
    })
  });
  const d = await r.json();
  const raw = d.choices?.[0]?.message?.content || '{}';
  try { return JSON.parse(raw.replace(/```json\n?|```/g,'').trim()); } catch(e) { return null; }
}

async function createMetaCampaign(config) {
  const token = process.env.META_ADS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  if (!token || !adAccountId) throw new Error('META_ADS_TOKEN e META_AD_ACCOUNT_ID não configurados no Netlify');
  const campRes = await fetch('https://graph.facebook.com/v18.0/'+adAccountId+'/campaigns', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({name:config.nome,objective:config.objetivo||'OUTCOME_LEADS',status:'PAUSED',special_ad_categories:[],access_token:token})
  });
  const camp = await campRes.json();
  if (camp.error) throw new Error('Meta Campaign: '+camp.error.message);
  const adsetRes = await fetch('https://graph.facebook.com/v18.0/'+adAccountId+'/adsets', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({name:config.nome+' - AdSet',campaign_id:camp.id,daily_budget:Math.round((config.orcamentoDiario||10)*100),billing_event:'IMPRESSIONS',optimization_goal:'LEAD_GENERATION',targeting:{geo_locations:{countries:config.paises||['BR']},age_min:config.idadeMin||18,age_max:config.idadeMax||65},status:'PAUSED',access_token:token})
  });
  const adset = await adsetRes.json();
  if (adset.error) throw new Error('Meta AdSet: '+adset.error.message);
  return {campaignId:camp.id, adSetId:adset.id, status:'criado_pausado'};
}

async function createGoogleCampaign(config) {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!devToken || !customerId || !refreshToken) throw new Error('Configure: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_REFRESH_TOKEN');
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type:'refresh_token',client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken})
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Google Ads OAuth: falha no refresh token');
  const headers = {'Authorization':'Bearer '+tokenData.access_token,'developer-token':devToken,'Content-Type':'application/json'};
  const gRes = await fetch('https://googleads.googleapis.com/v15/customers/'+customerId+'/campaigns:mutate', {
    method:'POST', headers,
    body: JSON.stringify({operations:[{create:{name:config.nome,advertisingChannelType:'SEARCH',status:'PAUSED',manualCpc:{},networkSettings:{targetGoogleSearch:true,targetSearchNetwork:true,targetContentNetwork:false}}}]})
  });
  const gData = await gRes.json();
  if (gData.error) throw new Error('Google Ads: '+gData.error.message);
  return {resourceName:gData.results?.[0]?.resourceName, status:'criado_pausado'};
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

  if (action === 'generate_creative') {
    const {produto, publico, objetivo, tom} = body;
    if (!produto || !publico) return {statusCode:400,headers:h,body:JSON.stringify({error:'produto e publico obrigatórios'})};
    try {
      const creative = await generateAdCreative(produto, publico, objetivo||'gerar leads', tom||'profissional');
      if (db && tenantId) {
        await db.collection('tenants').doc(tenantId).collection('ad_creatives').add({produto,publico,objetivo,tom,creative,criadoPor:event._uid,criadoEm:admin.firestore.FieldValue.serverTimestamp()});
      }
      return {statusCode:200,headers:h,body:JSON.stringify({ok:true,creative})};
    } catch(e) { return {statusCode:500,headers:h,body:JSON.stringify({error:'Internal error'})}; }
  }
  if (action === 'create_meta') {
    const {nome, objetivo, orcamentoDiario, paises, idadeMin, idadeMax} = body;
    if (!nome) return {statusCode:400,headers:h,body:JSON.stringify({error:'nome obrigatório'})};
    try {
      const result = await createMetaCampaign({nome,objetivo,orcamentoDiario,paises,idadeMin,idadeMax});
      if (db && tenantId) { await db.collection('tenants').doc(tenantId).collection('ad_campaigns').add({plataforma:'meta',nome,resultado:result,criadoEm:admin.firestore.FieldValue.serverTimestamp()}); }
      return {statusCode:201,headers:h,body:JSON.stringify({ok:true,campanha:result})};
    } catch(e) { return {statusCode:500,headers:h,body:JSON.stringify({error:'Internal error'})}; }
  }
  if (action === 'create_google') {
    const {nome} = body;
    if (!nome) return {statusCode:400,headers:h,body:JSON.stringify({error:'nome obrigatório'})};
    try {
      const result = await createGoogleCampaign(body);
      if (db && tenantId) { await db.collection('tenants').doc(tenantId).collection('ad_campaigns').add({plataforma:'google',nome,resultado:result,criadoEm:admin.firestore.FieldValue.serverTimestamp()}); }
      return {statusCode:201,headers:h,body:JSON.stringify({ok:true,campanha:result})};
    } catch(e) { return {statusCode:500,headers:h,body:JSON.stringify({error:'Internal error'})}; }
  }
  if (action === 'list') {
    if (!db || !tenantId) return {statusCode:400,headers:h,body:JSON.stringify({error:'tenantId obrigatório'})};
    const [camps, creatives] = await Promise.all([
      db.collection('tenants').doc(tenantId).collection('ad_campaigns').orderBy('criadoEm','desc').limit(20).get().catch(()=>({docs:[]})),
      db.collection('tenants').doc(tenantId).collection('ad_creatives').orderBy('criadoEm','desc').limit(10).get().catch(()=>({docs:[]}))
    ]);
    return {statusCode:200,headers:h,body:JSON.stringify({ok:true,campanhas:camps.docs.map(d=>({id:d.id,...d.data()})),criativos:creatives.docs.map(d=>({id:d.id,...d.data()}))})};
  }
  return {statusCode:400,headers:h,body:JSON.stringify({error:'Ação desconhecida: '+action})};
};
