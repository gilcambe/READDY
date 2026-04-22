# NEXIA OS v12 — Guia de Deploy no LocalWeb

## Status do Sistema (pós audit_v101)

| Métrica | Antes (v11) | Depois (v12) |
|---------|------------|--------------|
| Score Global | 73/100 | ~85/100 |
| Rotas FALHA | 3 | 0 |
| Rotas ERRO | 6 | ~2 (auth-redirect esperado) |
| APIs OK | 36/36 | 42/42 |
| MIME Errors | 4 | 0 |
| JS Exceptions | 1 | 0 |

## Correções Aplicadas

- ✅ `studio.html` — JS syntax error (`</script>` literal em string)
- ✅ `nexia-store.html` + `ces-app-executivo.html` — MIME error theme.css removido
- ✅ `../core/` → `/core/` — caminhos absolutos em 28 arquivos
- ✅ `osint-query.html` — página criada (era 404)
- ✅ `autocommit.js` — retorna 400 ao invés de 500
- ✅ `flow.html` — handler gracioso para Firebase permission denied
- ✅ Mobile overflow CSS em todas as páginas
- ✅ Firebase Resilience v12 em todas as páginas
- ✅ SEO meta descriptions em 27 páginas
- ✅ `sentinel.js v3.0` — heal mode real com GitHub + Netlify Build Hook
- ✅ `audit_v101.js` — auth-redirect tratado como aviso, não erro

---

## Arquitetura de Hospedagem

```
LocalWeb (estáticos)          Netlify (serverless)
┌─────────────────────┐      ┌──────────────────────────┐
│  HTML/CSS/JS        │      │  42 Netlify Functions    │
│  /core/             │ ───► │  Firebase Admin SDK      │
│  /ces/              │      │  Groq/Anthropic IA       │
│  /nexia/            │      │  Firestore               │
│  /splash/           │      └──────────────────────────┘
│  .htaccess          │
└─────────────────────┘
```

---

## Passo a Passo de Deploy

### 1. Preparação

```bash
# Extraia o ZIP
unzip NEXIA_V12_FIXED.zip -d nexia-os/
cd nexia-os/

# Instale dependências
npm install

# Teste local
netlify dev
# Acesse http://localhost:8888
```

### 2. Deploy das Functions no Netlify

```bash
# Login no Netlify (primeira vez)
netlify login

# Link ao site existente OU crie novo
netlify link
# ou: netlify init

# Deploy em produção
netlify deploy --prod
```

### 3. Variáveis de Ambiente no Netlify

Acesse: **Netlify → Site → Site configuration → Environment variables**

| Variável | Valor | Obrigatório |
|----------|-------|-------------|
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | `$(cat service-account.json \| base64 -w 0)` | ✅ Sim |
| `NEXIA_APP_URL` | `https://seudominio.localweb.com.br` | ✅ Sim |
| `GROQ_API_KEY` | Sua chave Groq | Recomendado |
| `ANTHROPIC_API_KEY` | Sua chave Anthropic | Opcional |
| `GITHUB_TOKEN` | Token GitHub | Opcional (auto-heal) |
| `NETLIFY_BUILD_HOOK` | URL do webhook | Opcional (redeploy) |
| `METRICS_SECRET` | String aleatória | Recomendado |

### 4. Upload para o LocalWeb

**Via FTP (FileZilla):**
- Host: `ftp.seudominio.localweb.com.br`
- Porta: `21`
- Usuario/Senha: suas credenciais LocalWeb
- Destino: `/public_html/`
- **NÃO envie** a pasta `netlify/functions/`

**Via SSH:**
```bash
ssh usuario@seudominio.localweb.com.br
cd public_html/
# Faça upload do ZIP e extraia:
unzip NEXIA_V12_FIXED.zip
# Mova os arquivos para a raiz (exceto netlify/)
```

### 5. Crie o .htaccess no LocalWeb

O arquivo `.htaccess` já está incluído no ZIP. Faça upload dele também.

> ⚠️ **IMPORTANTE:** Edite a linha do proxy para apontar para **SEU** site Netlify:
> ```
> RewriteRule ^api/(.*)$ https://SEU-SITE.netlify.app/api/$1 [P,L]
> RewriteRule ^\.netlify/functions/(.*)$ https://SEU-SITE.netlify.app/.netlify/functions/$1 [P,L]
> ```

### 6. Configure SSL no LocalWeb

Painel LocalWeb → **SSL/TLS** → Ativar Let's Encrypt gratuito

### 7. Atualize NEXIA_APP_URL

Volte ao Netlify e atualize a variável:
```
NEXIA_APP_URL = https://seudominio.localweb.com.br
```

### 8. Teste Final

```bash
# Rode o audit apontando para o domínio LocalWeb
NEXIA_URL=https://seudominio.localweb.com.br node audit_v101.js --open
```

---

## Solução de Problemas

### Functions retornam 404
→ Verifique se o proxy no .htaccess aponta para a URL correta do Netlify

### MIME type errors (/core/config.js)
→ O .htaccess proxy deve estar funcionando. Verifique os logs do Apache.

### Firebase: Missing permissions
→ Normal para usuários não logados. O sistema mostra aviso gracioso.

### Score baixo no audit
→ Execute `npm run audit:v101:heal` para diagnóstico automático com IA

---

## Variáveis opcionais para ativar o Sentinel Auto-Heal

```bash
# No Netlify Environment Variables:

# 1. Para diagnóstico IA no Sentinel
ANTHROPIC_API_KEY=sk-ant-...
# OU
GROQ_API_KEY=gsk_...

# 2. Para abrir GitHub Issues automáticos com fixes
GITHUB_TOKEN=ghp_...
GITHUB_REPO=sua-org/nexia-os

# 3. Para redeploy automático após aplicar fixes
NETLIFY_BUILD_HOOK=https://api.netlify.com/build_hooks/...
# (pegue em Netlify → Site → Build hooks → Add build hook)
```

---

*NEXIA OS v12 — audit_v101 — Gerado automaticamente*
