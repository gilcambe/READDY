'use strict';
const NexiaActionEngine = {
    async execute(action, payload, tenantSlug = 'nexia') {
        console.log(`[ACTION ENGINE] Executando: ${action} no tenant: ${tenantSlug}`);
        const db = typeof NEXIA !== 'undefined' ? NEXIA.db
                 : (typeof firebase !== 'undefined' ? firebase.firestore() : null);
        // FIX v20: guard contra db null quando Firebase não inicializou
        if (!db) throw new Error('Firebase indisponível. Verifique a configuração e tente novamente.');
        switch (action) {
            case 'create_lead':
            case 'createClient': {
                const res = await db.collection('tenants').doc(tenantSlug).collection('cadastros').add({
                    ...payload, origem: 'CORTEX_AI', status: payload.status || 'Lead',
                    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
                });
                return res.id;
            }
            case 'create_task': {
                const taskRes = await db.collection('tenants').doc(tenantSlug).collection('tasks').add({
                    ...payload, status: 'pending',
                    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
                });
                return taskRes.id;
            }
            default:
                throw new Error(`Ação desconhecida ou não suportada: ${action}`);
        }
    }
};
window.NexiaActionEngine = NexiaActionEngine;
