/**
 * NEXIA OS — set-master-role.js
 * Define o role 'master' para um usuário existente no Firebase Auth/Firestore.
 *
 * USO:
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json node set-master-role.js <email>
 *
 * EXEMPLO:
 *   node set-master-role.js admin@nexia.app
 *
 * REQUISITOS:
 *   - Usuário já deve ter feito cadastro no Firebase Auth (via /login → criar conta)
 *   - Arquivo serviceAccountKey.json do Firebase Console
 */
'use strict';

const admin = require('firebase-admin');

const email = process.argv[2];
if (!email) {
  console.error('[SET-MASTER] ERRO: informe o email do usuário');
  console.error('  Uso: node set-master-role.js <email>');
  process.exit(1);
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('[SET-MASTER] ERRO: defina GOOGLE_APPLICATION_CREDENTIALS ou FIREBASE_SERVICE_ACCOUNT');
  process.exit(1);
}

let credential;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
} else {
  credential = admin.credential.applicationDefault();
}

admin.initializeApp({ credential, projectId: 'nexia-c8710' });
const db    = admin.firestore();
const auth  = admin.auth();

async function setMaster() {
  console.log(`[SET-MASTER] Buscando usuário: ${email}...\n`);

  // 1. Busca o usuário no Firebase Auth
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch (e) {
    console.error(`[SET-MASTER] ❌ Usuário não encontrado no Firebase Auth: ${email}`);
    console.error('  → O usuário precisa ter se cadastrado primeiro via /login');
    process.exit(1);
  }

  const uid = userRecord.uid;
  console.log(`[SET-MASTER] ✔ Usuário encontrado: uid=${uid}`);

  // 2. Atualiza/cria documento no Firestore
  const userRef = db.collection('users').doc(uid);
  await userRef.set({
    uid,
    email,
    displayName: userRecord.displayName || email.split('@')[0],
    role:        'master',
    tenantSlug:  'nexia',
    tenant:      'nexia',
    updatedAt:   admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  console.log(`[SET-MASTER] ✔ Firestore atualizado: users/${uid} → role=master, tenantSlug=nexia`);

  // 3. Define Custom Claims no Firebase Auth (reforço opcional)
  await auth.setCustomUserClaims(uid, { role: 'master', tenantSlug: 'nexia' });
  console.log(`[SET-MASTER] ✔ Custom Claims definidos no Firebase Auth`);

  // 4. Adiciona como membro do tenant nexia
  const memberRef = db.collection('tenants').doc('nexia').collection('members').doc(uid);
  await memberRef.set({
    uid,
    email,
    displayName: userRecord.displayName || email.split('@')[0],
    role:        'master',
    joinedAt:    admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  console.log(`[SET-MASTER] ✔ Adicionado como membro master do tenant nexia\n`);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ SUCESSO! ${email} agora é MASTER do NEXIA OS`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\nPRÓXIMOS PASSOS:');
  console.log('  1. O usuário deve SAIR e fazer LOGIN novamente (para renovar o token)');
  console.log('  2. Acesse: /nexia/nexia-master-admin.html');
  console.log('  3. Se ainda não funcionar: limpe o cache do navegador (Ctrl+Shift+R)\n');

  process.exit(0);
}

setMaster().catch(err => {
  console.error('[SET-MASTER] ERRO FATAL:', 'Internal error');
  process.exit(1);
});
