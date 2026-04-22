/**
 * NEXIA OS — seed-firebase.js
 * Popula o Firestore com estrutura base para novo deploy.
 *
 * USO:
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json node seed-firebase.js
 *
 * REQUISITOS:
 *   npm install firebase-admin (já incluso no package.json como dep)
 *   Arquivo serviceAccountKey.json baixado do Firebase Console →
 *   Configurações do projeto → Contas de serviço → Gerar nova chave privada
 */
'use strict';

const admin = require('firebase-admin');

// ── Inicialização ──────────────────────────────────────────────────────────
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('[SEED] ERRO: defina GOOGLE_APPLICATION_CREDENTIALS ou FIREBASE_SERVICE_ACCOUNT');
  process.exit(1);
}

let credential;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
} else {
  credential = admin.credential.applicationDefault();
}

admin.initializeApp({ credential, projectId: 'nexia-c8710' });
const db = admin.firestore();

// ── Dados Seed ─────────────────────────────────────────────────────────────
const TENANTS = [
  {
    slug: 'nexia',
    name: 'NEXIA CORPORATION',
    theme: 'dark',
    role: 'master',
    modules: ['all'],
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    config: {
      brand: {
        primaryColor: '#00e5ff',
        logoUrl: '/favicon.svg',
        whatsappPhone: '5511944037259',
        supportEmail: 'suporte@nexia.app'
      }
    }
  },
  {
    slug: 'viajante-pro',
    name: 'Viajante Pro Oficial',
    theme: 'dark',
    role: 'tenant',
    modules: ['turismo', 'financeiro', 'logistica'],
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    config: {
      brand: {
        primaryColor: '#7c3aed',
        logoUrl: '/viajante-pro/assets/logo.svg',
        whatsappPhone: '5511944037259',
        supportEmail: 'suporte@viajantepro.com'
      }
    }
  },
  {
    slug: 'ces',
    name: 'CES Brasil 2027',
    theme: 'light',
    role: 'tenant',
    modules: ['eventos', 'matchmaking', 'compliance'],
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    config: {
      brand: {
        primaryColor: '#f59e0b',
        logoUrl: '/ces/assets/logo.svg',
        whatsappPhone: '5511944037259',
        supportEmail: 'suporte@cesbrasil.com'
      }
    }
  },
  {
    slug: 'bezsan',
    name: 'Bezsan Leilões',
    theme: 'dark',
    role: 'tenant',
    modules: ['leiloes', 'financeiro'],
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    config: {
      brand: {
        primaryColor: '#f59e0b',
        logoUrl: '/bezsan/assets/logo.svg',
        whatsappPhone: '5511944037259',
        supportEmail: 'suporte@bezsan.com'
      }
    }
  },
  {
    slug: 'splash',
    name: 'Splash Festas',
    theme: 'dark',
    role: 'tenant',
    modules: ['eventos', 'financeiro'],
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    config: {
      brand: {
        primaryColor: '#ec4899',
        logoUrl: '/splash/assets/logo.svg',
        whatsappPhone: '5511944037259',
        supportEmail: 'suporte@splashfestas.com'
      }
    }
  }
];

// ── Runner ─────────────────────────────────────────────────────────────────
async function seed() {
  console.log('[SEED] Iniciando seed do Firestore — nexia-c8710...\n');
  const batch = db.batch();

  for (const tenant of TENANTS) {
    const { slug, config, ...tenantData } = tenant;

    // Documento principal do tenant
    const tenantRef = db.collection('tenants').doc(slug);
    batch.set(tenantRef, tenantData, { merge: true });
    console.log(`  ✔ tenant/${slug}`);

    // Sub-coleção config/brand
    const brandRef = tenantRef.collection('config').doc('brand');
    batch.set(brandRef, config.brand, { merge: true });
    console.log(`  ✔ tenant/${slug}/config/brand`);
  }

  await batch.commit();
  console.log('\n[SEED] ✅ Firestore populado com sucesso!\n');
  console.log('PRÓXIMOS PASSOS:');
  console.log('  1. Execute: node set-master-role.js <email-do-admin>');
  console.log('  2. Acesse /login e faça login com o email de admin');
  console.log('  3. Navegue para /nexia/nexia-master-admin.html\n');
  process.exit(0);
}

seed().catch(err => {
  console.error('[SEED] ERRO FATAL:', 'Internal error');
  process.exit(1);
});
