# NEXIA OS — HANDOFF v19 FINAL
**Data:** 13/04/2026 | **Plataforma:** Render (100% sem Netlify)

---

## ✅ TODAS AS CORREÇÕES APLICADAS

### 🔴 CRÍTICOS
| Fix | Arquivo |
|-----|---------|
| `netlify.toml` DELETADO | — |
| `_redirects` DELETADO | — |
| `loadLastReport()` usa GET (não POST scan) | `nexia/sentinel-dashboard.html` |
| Auth padronizada com `NexiaAuth.requireAuth()` | `nexia/qa-test-center.html` |

### 🟡 ALTOS
| Fix | Arquivo |
|-----|---------|
| Botões "Aplicar Fix" individual + "Aplicar Todos" | `nexia/sentinel-dashboard.html` |
| Banner DEMO + painel CNPJ/CEP real via `/api/osint` | `nexia/osint-query.html` |
| Banner DEMO + painel CNPJ/CEP real via `/api/osint` | `nexia/pki-scanner.html` |
| 21 → **39 endpoints** monitorados, rotas `/api/` | `netlify/functions/sentinel.js` |

### 🟠 MÉDIOS
| Fix | Arquivo |
|-----|---------|
| `nav-guard.js` adicionado em 11 páginas (19/19 OK) | `nexia/*.html` |
| `RENDER_DEPLOY_HOOK` substitui `NETLIFY_BUILD_HOOK` | `render.yaml` + `sentinel.js` |
| Filtro rotas/APIs trocado para `/api/` | `netlify/functions/sentinel.js` |

### 🔵 ERROS DE CONSOLE (Firestore permissions)
| Fix | Arquivo |
|-----|---------|
| `_detectTenantByURL()` checa auth antes de query Firestore | `core/config.js` |
| `boot()` não chama Firestore para `NEXIA_MASTER` sem auth | `core/nexia-engine.js` |
| Rules para `system_status`, `sentinel_reports`, `sentinel_heals` | `firestore.rules` |
| Rules para `tenants/*/modules`, `tenants/*/config`, `tenants/*/osint_log` | `firestore.rules` |

---

## 🚀 DEPLOY NO RENDER

### Variáveis obrigatórias
```
NODE_ENV=production
NEXIA_APP_URL=https://sua-url.onrender.com
FIREBASE_SERVICE_ACCOUNT_BASE64=<base64>
GROQ_API_KEY=<key>
```

### Variáveis opcionais
```
GEMINI_API_KEY=<key>
ANTHROPIC_API_KEY=<key>
GITHUB_TOKEN=<token>
GITHUB_REPO=usuario/repo
RENDER_DEPLOY_HOOK=<url>   ← Render Dashboard → Settings → Deploy Hook
```

---

## ⚠️ DEPLOY DAS FIRESTORE RULES
Após fazer upload do projeto, publique as rules:
```bash
firebase deploy --only firestore:rules
```
Ou via Firebase Console → Firestore → Rules → cole o conteúdo de `firestore.rules`.

---

## 📋 CHECKLIST PÓS-DEPLOY

- [ ] `firebase deploy --only firestore:rules` executado
- [ ] Logs Render: server.js sobe sem erros
- [ ] Console do browser: zero erros "Missing or insufficient permissions"
- [ ] `/nexia/sentinel` → carrega relatório salvo (GET, não escaneia)
- [ ] "Run Scan" → escaneia 39 endpoints
- [ ] "Auto-Heal" → fix cards com botão "Aplicar Fix" visível
- [ ] `/nexia/osint-query` → banner DEMO + painel CNPJ funciona
- [ ] `/nexia/qa-test-center` → redireciona para /login se não autenticado
- [ ] UptimeRobot pingando a cada 5min (evita cold start no free tier)

*Gerado automaticamente — 13/04/2026*
