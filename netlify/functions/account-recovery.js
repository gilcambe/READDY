'use strict';

// ── fetchWithTimeout helper ──
async function _fetchTimeout(url, opts = {}, ms = 30000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(tid); }
}

/**
 * NEXIA OS — Account Recovery Engine v1.0
 * Recuperação de contas hackeadas via canais OFICIAIS
 * POST /api/recovery
 */

const { admin, db } = require('./firebase-init');

const { requireBearerAuth, makeHeaders } = require('./middleware');

const RECOVERY_FLOWS = {
  instagram: {
    nome:'Instagram',
    passos:[
      {n:1,titulo:'Tente recuperação pelo email',desc:'Abra o Instagram → "Esqueceu a senha?" → informe o email cadastrado',link:'https://www.instagram.com/accounts/password/reset/',tempo:'5 min'},
      {n:2,titulo:'Recuperação por telefone',desc:'Se o email foi alterado, use o número de telefone cadastrado',link:'https://www.instagram.com/accounts/password/reset/',tempo:'5 min'},
      {n:3,titulo:'Verificação de identidade por vídeo',desc:'Instagram oferece verificação por selfie-vídeo comparando com fotos do perfil. Acesse o suporte oficial.',link:'https://help.instagram.com/185206011874117',tempo:'24-48h'},
      {n:4,titulo:'Formulário de conta comprometida',desc:'Preencha o formulário oficial do Meta para contas hackeadas',link:'https://www.facebook.com/help/instagram/374546259694234',tempo:'2-7 dias'},
      {n:5,titulo:'Central de ajuda Instagram',desc:'Acesse a central oficial para contas hackeadas',link:'https://help.instagram.com/149494825257596',tempo:'variável'}
    ],
    dicas:['Verifique se o email de recuperação ainda está acessível','Tenha foto de perfil para selfie-vídeo','Reúna email/telefone usados no cadastro','Acesse de dispositivo reconhecido pelo app']
  },
  facebook: {
    nome:'Facebook',
    passos:[
      {n:1,titulo:'Conta hackeada — formulário oficial',desc:'Acesse diretamente a página de conta comprometida do Facebook',link:'https://www.facebook.com/hacked',tempo:'imediato'},
      {n:2,titulo:'Recuperação por amigos confiáveis',desc:'Facebook permite recuperar conta via amigos confiáveis pré-cadastrados',link:'https://www.facebook.com/login/identify',tempo:'30 min'},
      {n:3,titulo:'Verificação de identidade',desc:'Envie documento de identidade para verificação',link:'https://www.facebook.com/help/286768388155524',tempo:'3-7 dias'},
      {n:4,titulo:'Central Meta para contas comprometidas',desc:'Central oficial Meta para situações de comprometimento de segurança',link:'https://www.facebook.com/help/1216349518398524',tempo:'variável'}
    ],
    dicas:['Acesse facebook.com/hacked imediatamente','Tenha documento de identidade pronto','Saiba emails/telefones usados']
  },
  twitter: {
    nome:'Twitter / X',
    passos:[
      {n:1,titulo:'Redefinição de senha',desc:'Use a opção "Esqueceu a senha?" na tela de login do Twitter/X',link:'https://twitter.com/account/begin_password_reset',tempo:'5 min'},
      {n:2,titulo:'Formulário de suporte oficial',desc:'Preencha o formulário de conta comprometida',link:'https://help.twitter.com/forms/login',tempo:'24-48h'},
      {n:3,titulo:'Verificação de identidade',desc:'Envie documentos para o suporte do X',link:'https://help.twitter.com/forms/account-access/compromised',tempo:'3-7 dias'}
    ],
    dicas:['Revogue acessos de apps terceiros imediatamente','Verifique email de recuperação','Documente último acesso normal']
  },
  youtube: {
    nome:'YouTube / Google',
    passos:[
      {n:1,titulo:'Recuperação de conta Google',desc:'YouTube usa sua conta Google — recupere pelo assistente oficial',link:'https://accounts.google.com/signin/recovery',tempo:'5-30 min'},
      {n:2,titulo:'Verificação em 2 etapas',desc:'Se você tem 2FA, use os códigos de backup',link:'https://myaccount.google.com/security',tempo:'5 min'},
      {n:3,titulo:'Suporte Google para conta comprometida',desc:'Formulário específico para contas invadidas',link:'https://support.google.com/accounts/troubleshooter/2402620',tempo:'24-72h'},
      {n:4,titulo:'Revogar acessos suspeitos',desc:'Revise e revogue dispositivos/apps na central de segurança',link:'https://myaccount.google.com/device-activity',tempo:'imediato'}
    ],
    dicas:['Tenha telefone de recuperação acessível','Códigos de backup: myaccount.google.com','Verifique apps conectados à conta']
  },
  tiktok: {
    nome:'TikTok',
    passos:[
      {n:1,titulo:'Redefinição via email ou telefone',desc:'Tela de login → "Esqueceu a senha?"',link:'https://www.tiktok.com/login',tempo:'5 min'},
      {n:2,titulo:'Formulário de suporte TikTok',desc:'Reporte conta hackeada pelo suporte oficial',link:'https://www.tiktok.com/legal/report/user',tempo:'24-48h'},
      {n:3,titulo:'Central de segurança TikTok',desc:'Acesse a central de privacidade e segurança oficial',link:'https://www.tiktok.com/safety',tempo:'variável'}
    ],
    dicas:['Documente o perfil antes do acesso ser bloqueado','Tenha email/telefone do cadastro']
  },
  whatsapp: {
    nome:'WhatsApp',
    passos:[
      {n:1,titulo:'Reative pelo número de telefone',desc:'Instale o WhatsApp e faça login com seu número — isso derruba o hacker automaticamente',link:'https://faq.whatsapp.com/general/account-and-profile/stolen-accounts/',tempo:'imediato'},
      {n:2,titulo:'Ative verificação em duas etapas',desc:'Após recuperar: Configurações → Conta → Verificação em duas etapas',link:'https://faq.whatsapp.com/general/verification/how-to-turn-on-two-step-verification/',tempo:'5 min'},
      {n:3,titulo:'Email de suporte WhatsApp',desc:'Se não conseguir reativar, contate: support@whatsapp.com',link:'mailto:support@whatsapp.com',tempo:'2-5 dias'}
    ],
    dicas:['Reinstalar o app no seu celular já derruba o hacker','O número de telefone é o "dono" da conta','Nunca compartilhe o código SMS de 6 dígitos']
  },
  google: {
    nome:'Google',
    passos:[
      {n:1,titulo:'Assistente de recuperação de conta',desc:'Ferramenta oficial do Google para recuperar acesso',link:'https://accounts.google.com/signin/recovery',tempo:'5-30 min'},
      {n:2,titulo:'Verificar dispositivos conectados',desc:'Revogue acessos suspeitos remotamente',link:'https://myaccount.google.com/device-activity',tempo:'imediato'},
      {n:3,titulo:'Suporte conta comprometida',desc:'Passo a passo oficial Google',link:'https://support.google.com/accounts/troubleshooter/2402620',tempo:'24-72h'}
    ],
    dicas:['Use o assistente oficial — nunca sites de terceiros','Tenha telefone e email de recuperação','Códigos de backup: myaccount.google.com/security']
  }
};

async function generateRecoveryPlan(plataforma, situacao) {
  const flow = RECOVERY_FLOWS[plataforma];
  if (!flow) return null;
  const groqKey = process.env.GROQ_API_KEY;
  let planPersonalizado = '';
  if (groqKey && situacao) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method:'POST', headers:{'Authorization':'Bearer '+groqKey,'Content-Type':'application/json'},
        body: JSON.stringify({
          model:'llama-3.3-70b-versatile', max_tokens:500, temperature:0.2,
          messages:[{role:'user',content:'Você é especialista em segurança digital.\nUm usuário teve a conta '+flow.nome+' hackeada. Situação: "'+situacao+'"\nDê 3 recomendações específicas para esta situação. Seja prático e direto. Português, máximo 200 palavras.'}]
        })
      });
      const d = await r.json();
      planPersonalizado = d.choices?.[0]?.message?.content || '';
    } catch {}
  }
  return {...flow, planPersonalizado};
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

  if (action === 'platforms') {
    return {statusCode:200,headers:h,body:JSON.stringify({ok:true,plataformas:Object.keys(RECOVERY_FLOWS).map(k=>({id:k,nome:RECOVERY_FLOWS[k].nome}))})};
  }
  if (action === 'get_steps') {
    const {plataforma, situacao} = body;
    if (!plataforma) return {statusCode:400,headers:h,body:JSON.stringify({error:'plataforma obrigatória'})};
    const plan = await generateRecoveryPlan(plataforma, situacao);
    if (!plan) return {statusCode:404,headers:h,body:JSON.stringify({error:'Plataforma não suportada: '+plataforma})};
    return {statusCode:200,headers:h,body:JSON.stringify({ok:true,plan})};
  }
  if (action === 'create_case') {
    const {plataforma, perfil, situacao, emailContato} = body;
    if (!plataforma) return {statusCode:400,headers:h,body:JSON.stringify({error:'plataforma obrigatória'})};
    const plan = await generateRecoveryPlan(plataforma, situacao);
    const caseId = 'REC-' + Date.now();
    const caseData = {id:caseId,plataforma,perfil:perfil||'',situacao:situacao||'',emailContato:emailContato||'',status:'em_andamento',passoAtual:1,plan:plan||null,criadoPor:event._uid,criadoEm:new Date().toISOString()};
    if (db && tenantId) {
      await db.collection('tenants').doc(tenantId).collection('recovery_cases').doc(caseId).set({...caseData,criadoEm:admin.firestore.FieldValue.serverTimestamp()});
    }
    return {statusCode:201,headers:h,body:JSON.stringify({ok:true,case:caseData})};
  }
  if (action === 'list') {
    if (!db || !tenantId) return {statusCode:400,headers:h,body:JSON.stringify({error:'tenantId obrigatório'})};
    try {
      const snap = await db.collection('tenants').doc(tenantId).collection('recovery_cases').orderBy('criadoEm','desc').limit(30).get();
      return {statusCode:200,headers:h,body:JSON.stringify({ok:true,cases:snap.docs.map(d=>({id:d.id,...d.data()}))})};
    } catch(e) {
      const snap = await db.collection('tenants').doc(tenantId).collection('recovery_cases').limit(30).get();
      return {statusCode:200,headers:h,body:JSON.stringify({ok:true,cases:snap.docs.map(d=>({id:d.id,...d.data()}))})};
    }
  }
  if (action === 'update_status') {
    const {caseId, status, passoAtual, notas} = body;
    if (!db || !tenantId || !caseId) return {statusCode:400,headers:h,body:JSON.stringify({error:'parâmetros obrigatórios'})};
    await db.collection('tenants').doc(tenantId).collection('recovery_cases').doc(caseId).update({status,passoAtual:passoAtual||1,notas:notas||'',atualizadoEm:admin.firestore.FieldValue.serverTimestamp()});
    return {statusCode:200,headers:h,body:JSON.stringify({ok:true,message:'Caso atualizado'})};
  }
  return {statusCode:400,headers:h,body:JSON.stringify({error:'Ação desconhecida: '+action})};
};
