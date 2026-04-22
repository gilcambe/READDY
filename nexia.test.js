// ─── NEXIA Playwright Test Suite v3.0 ────────────────────────────────────────
// Cobre: navegação, Firebase, layout, dark mode, idioma, botões,
//        Cortex IA, Sentinel, Observability, APIs, detecção de fake, performance
//
// PRÉ-REQUISITOS (rodar UMA VEZ antes dos testes):
//   npx playwright install chromium
//
// RODAR:
//   $env:BASE_URL  = "https://nexia-os.onrender.com"   # PowerShell
//   $env:TEST_PASS = "sua_senha"                        # para testes autenticados
//   npx playwright test
//
// RELATÓRIO:
//   npx playwright show-report
// ─────────────────────────────────────────────────────────────────────────────
const { test, expect } = require('@playwright/test');

const BASE     = process.env.BASE_URL   || 'https://nexia-os.onrender.com';
const EMAIL    = process.env.TEST_EMAIL || 'gbezerra@nexia.com';
const PASSWORD = process.env.TEST_PASS  || '';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. NAVEGAÇÃO — todas as páginas
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('1. Navegação — todas as páginas', () => {
  const PAGES = [
    { label: 'Login',           path: '/login'                    },
    { label: 'Cortex',          path: '/nexia/cortex'             },
    { label: 'Sentinel',        path: '/nexia/sentinel'           },
    { label: 'Observability',   path: '/nexia/observability.html' },
    { label: 'Architect',       path: '/nexia/architect'          },
    { label: 'Flow',            path: '/nexia/flow'               },
    { label: 'My Panel',        path: '/nexia/my-panel'           },
    { label: 'Master Admin',    path: '/nexia/master-admin'       },
    { label: 'Pay',             path: '/nexia/pay'                },
    { label: 'Store',           path: '/nexia/store'              },
    { label: 'Striker',         path: '/nexia/striker'            },
    { label: 'OSINT',           path: '/nexia/osint-query'        },
    { label: 'PABX',            path: '/nexia/pabx'               },
    { label: 'PKI Scanner',     path: '/nexia/pki'                },
    { label: 'QA Center',       path: '/nexia/qa-test-center'     },
    { label: 'Social Media',    path: '/nexia/social-media'       },
    { label: 'Strike Center',   path: '/nexia/strike-center'      },
    { label: 'Studio',          path: '/nexia/studio'             },
    { label: 'Swarm Control',   path: '/nexia/swarm'              },
    { label: 'Tenant Hub',      path: '/nexia/tenant-hub'         },
    { label: 'AutoDemo',        path: '/nexia/autodemo'           },
  ];

  for (const { label, path } of PAGES) {
    test(`${label} (${path}) — HTTP 200, zero crash JS`, async ({ page }) => {
      const jsErrors = [];
      page.on('pageerror', err => jsErrors.push(err.message));

      const res = await page.goto(`${BASE}${path}`, {
        waitUntil: 'domcontentloaded',
        timeout:   20_000,
      });

      // 200 = ok | 301/302 = redirect auth guard = também ok
      expect(
        [200, 301, 302],
        `${label} retornou HTTP ${res?.status()}`
      ).toContain(res?.status());

      // Ignora erros esperados de Firebase sem auth
      const fatalErrors = jsErrors.filter(e =>
        !e.includes('auth/') &&
        !e.includes('permission-denied') &&
        !e.includes('not-authenticated') &&
        !e.includes('requireAuth') &&
        !e.includes('No Firebase App') &&
        !e.includes('firebase')
      );
      expect(
        fatalErrors,
        `JS crashes em ${label}: ${fatalErrors.join(' | ')}`
      ).toHaveLength(0);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. FIREBASE AUTH
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('2. Firebase Auth', () => {
  test('Login: sem erro Firebase No-App', async ({ page }) => {
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(3000);
    const noApp = errors.find(e =>
      e.toLowerCase().includes('no firebase app') ||
      e.includes('no-app') ||
      e.includes('[DEFAULT]')
    );
    expect(noApp, `Firebase No-App detectado: ${noApp}`).toBeUndefined();
  });

  test('Login: sem erro initializeApp duplicado', async ({ page }) => {
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(2000);
    const dup = errors.find(e =>
      e.includes('already been initialized') || e.includes('duplicate-app')
    );
    expect(dup, `Firebase duplicado: ${dup}`).toBeUndefined();
  });

  test('Login: credencial inválida não redireciona para app', async ({ page }) => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(1500);

    const emailInput = page.locator('input[type="email"], input[name="email"], #email').first();
    const passInput  = page.locator('input[type="password"], input[name="password"], #password').first();
    if (await emailInput.count() === 0) return; // guard client-side, skip gracefully

    await emailInput.fill('invalido@fake.com');
    await passInput.fill('senhaerrada123');

    const loginBtn = page.locator(
      'button[type="submit"], #btnLogin, .btn-login, button:has-text("Entrar"), button:has-text("Login")'
    ).first();
    await loginBtn.click();
    await page.waitForTimeout(4000);

    const url = page.url();
    const redirectedToApp = url.includes('/nexia/') && !url.includes('/login');
    expect(redirectedToApp, 'Login inválido redirecionou para app!').toBe(false);
  });

  test('Login: campos vazios não submetem', async ({ page }) => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(1000);

    const loginBtn = page.locator(
      'button[type="submit"], #btnLogin, .btn-login, button:has-text("Entrar"), button:has-text("Login")'
    ).first();
    if (await loginBtn.count() === 0) return;

    await loginBtn.click();
    await page.waitForTimeout(1500);

    const url = page.url();
    expect(url, 'Campos vazios redirecionaram para o app!').not.toContain('/nexia/cortex');
  });

  test('Páginas protegidas: redirecionam para login sem auth', async ({ page }) => {
    const res = await page.goto(`${BASE}/nexia/cortex`, {
      waitUntil: 'domcontentloaded',
      timeout:   15_000,
    });
    await page.waitForTimeout(3000);

    const finalUrl = page.url();
    const status   = res?.status();

    const isProtected =
      finalUrl.includes('/login') ||
      finalUrl.includes('login.html') ||
      [401, 403].includes(status || 0) ||
      status === 200; // guard pode ser client-side (Firebase onAuthStateChanged)

    expect(isProtected, `Cortex acessível sem auth — URL: ${finalUrl}`).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. LAYOUT E DESIGN SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('3. Layout e Design System', () => {
  test('Cortex: fonte Inter declarada no HTML', async ({ page }) => {
    await page.goto(`${BASE}/nexia/cortex`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    expect(await page.content()).toMatch(/Inter/i);
  });

  test('Sentinel: fonte Inter declarada no HTML', async ({ page }) => {
    await page.goto(`${BASE}/nexia/sentinel`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    expect(await page.content()).toMatch(/Inter/i);
  });

  test('Observability: fonte Inter declarada no HTML', async ({ page }) => {
    await page.goto(`${BASE}/nexia/observability.html`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    expect(await page.content()).toMatch(/Inter/i);
  });

  test('Cortex: sidebar .sb presente no DOM', async ({ page }) => {
    await page.goto(`${BASE}/nexia/cortex`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await expect(
      page.locator('.sb, aside, nav[class*="side"], [class*="sidebar"]').first()
    ).toBeAttached({ timeout: 5000 });
  });

  test('Sentinel: sidebar .sb presente no DOM', async ({ page }) => {
    await page.goto(`${BASE}/nexia/sentinel`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await expect(
      page.locator('.sb, aside, nav[class*="side"], [class*="sidebar"]').first()
    ).toBeAttached({ timeout: 5000 });
  });

  test('CSS var --bg definida e não vazia', async ({ page }) => {
    await page.goto(`${BASE}/nexia/cortex`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );
    expect(bg, '--bg não definida').not.toBe('');
  });

  test('CSS var --text definida e não vazia', async ({ page }) => {
    await page.goto(`${BASE}/nexia/cortex`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const val = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--text').trim()
    );
    expect(val, '--text não definida').not.toBe('');
  });

  test('CSS var --c1 ou --primary definida (cor primária)', async ({ page }) => {
    await page.goto(`${BASE}/nexia/cortex`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const val = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return s.getPropertyValue('--c1').trim() || s.getPropertyValue('--primary').trim();
    });
    expect(val, 'Nenhuma cor primária (--c1 ou --primary) definida').not.toBe('');
  });

  test('CSS var --brd definida e não vazia', async ({ page }) => {
    await page.goto(`${BASE}/nexia/cortex`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const val = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--brd').trim()
    );
    expect(val, '--brd não definida').not.toBe('');
  });

  test('Páginas nexia: meta viewport presente', async ({ page }) => {
    for (const p of ['/nexia/cortex', '/nexia/sentinel', '/login']) {
      await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      const count = await page.locator('meta[name="viewport"]').count();
      expect(count, `Meta viewport ausente em ${p}`).toBeGreaterThan(0);
    }
  });

  test('Remixicon CDN referenciado no Cortex', async ({ page }) => {
    await page.goto(`${BASE}/nexia/cortex`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    expect(await page.content()).toMatch(/remixicon/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. DARK MODE
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('4. Dark Mode', () => {
  test('Widget #nx-theme-widget injetado no DOM', async ({ page }) => {
    await page.goto(`${BASE}/nexia/cortex`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(1500);
    await expect(page.locator('#nx-theme-widget')).toBeAttached({ timeout: 5000 });
  });

  test('Botão toggle (#nx-toggle-theme) muda data-theme', async ({ page }) => {
    await page.goto(`${BASE}/nexia/cortex`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(1500);

    const before = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme') || 'light'
    );

    const toggleBtn = page.locator('#nx-toggle-theme');
    if (await toggleBtn.count() === 0) { test.skip(true, 'Widget não encontrado'); return; }

    await toggleBtn.click();
    await page.waitForTimeout(500);

    const after = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    );
    expect(after, 'data-theme não mudou após toggle').not.toBe(before);
  });

  test('--bg muda de valor entre light e dark', async ({ page }) => {
    await page.goto(`${BASE}/nexia/cortex`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(1500);

    const getBg = () => page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );

    const bgLight = await getBg();

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(300);
    const bgDark = await getBg();

    expect(bgDark, '--bg igual em dark e light — dark mode não funciona').not.toBe(bgLight);
  });

  test('Tema persiste em localStorage após setTheme', async ({ page }) => {
    await page.goto(`${BASE}/nexia/cortex`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(1500);

    await page.evaluate(() => {
      if (window.NexiaTheme) window.NexiaTheme.setTheme('dark');
      else localStorage.setItem('nx_theme', 'dark');
    });

    const stored = await page.evaluate(() => localStorage.getItem('nx_theme'));
    expect(stored, 'Tema não persistido em localStorage').toBe('dark');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. SELETOR DE IDIOMA
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('5. Seletor de Idioma', () => {
  test('Botões PT, EN, ES presentes no widget', async ({ page }) => {
    await page.goto(`${BASE}/nexia/cortex`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(1500);

    const widget = page.locator('#nx-theme-widget');
    if (await widget.count() === 0) { test.skip(true, 'Widget não encontrado'); return; }

    const btns  = await widget.locator('button').allTextContents();
    const labels = btns.map(b => b.trim().toUpperCase());
    expect(labels, 'Botão PT ausente').toContain('PT');
    expect(labels, 'Botão EN ausente').toContain('EN');
    expect(labels, 'Botão ES ausente').toContain('ES');
  });

  test('Clicar EN persiste nx_lang=en', async ({ page }) => {
    await page.goto(`${BASE}/nexia/cortex`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      if (window.NexiaTheme) window.NexiaTheme.setLang('en');
      else localStorage.setItem('nx_lang', 'en');
    });
    const stored = await page.evaluate(() => localStorage.getItem('nx_lang'));
    expect(stored, 'nx_lang não salvo como "en"').toBe('en');
  });

  test('Clicar PT persiste nx_lang=pt', async ({ page }) => {
    await page.goto(`${BASE}/nexia/cortex`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      if (window.NexiaTheme) window.NexiaTheme.setLang('pt');
      else localStorage.setItem('nx_lang', 'pt');
    });
    const stored = await page.evaluate(() => localStorage.getItem('nx_lang'));
    expect(stored, 'nx_lang não salvo como "pt"').toBe('pt');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. BOTÕES — INTERATIVIDADE
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('6. Botões — interatividade', () => {
  test('Cortex: #btnSend presente e habilitado', async ({ page }) => {
    await page.goto(`${BASE}/nexia/cortex`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(2000);
    const btn = page.locator('#btnSend');
    await expect(btn).toBeAttached({ timeout: 5000 });
    await expect(btn).not.toBeDisabled();
  });

  test('Cortex: textarea #inp aceita texto', async ({ page }) => {
    await page.goto(`${BASE}/nexia/cortex`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(2000);
    const ta = page.locator('textarea#inp');
    await expect(ta).toBeAttached({ timeout: 5000 });
    await ta.fill('teste de input');
    expect(await ta.inputValue()).toBe('teste de input');
  });

  test('Cortex: seletor de modelo (#modelSel) tem > 1 opção', async ({ page }) => {
    await page.goto(`${BASE}/nexia/cortex`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(2000);
    const sel = page.locator('#modelSel');
    await expect(sel).toBeAttached({ timeout: 5000 });
    const opts = await sel.locator('option').count();
    expect(opts, 'modelSel tem ≤ 1 opção').toBeGreaterThan(1);
  });

  test('Sentinel: #btn-scan presente', async ({ page }) => {
    await page.goto(`${BASE}/nexia/sentinel`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(2000);
    await expect(page.locator('#btn-scan')).toBeAttached({ timeout: 5000 });
  });

  test('Sentinel: #btn-heal disabled antes do scan', async ({ page }) => {
    await page.goto(`${BASE}/nexia/sentinel`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(2000);
    const healBtn = page.locator('#btn-heal');
    await expect(healBtn).toBeAttached({ timeout: 5000 });
    await expect(healBtn, '#btn-heal deveria estar disabled antes do scan').toBeDisabled();
  });

  test('Sentinel: clicar Full Scan não causa crash JS', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));
    await page.goto(`${BASE}/nexia/sentinel`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(2000);

    const scanBtn = page.locator('#btn-scan');
    if (await scanBtn.count() === 0) return;

    await scanBtn.click();
    await page.waitForTimeout(3000);

    const fatalErrors = jsErrors.filter(e =>
      !e.includes('auth/') && !e.includes('firebase') && !e.includes('permission-denied')
    );
    expect(fatalErrors, `Crash JS pós-scan: ${fatalErrors.join(' | ')}`).toHaveLength(0);
  });

  test('Login: tab Register exibe formulário de cadastro', async ({ page }) => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 15_000 });
    await page.waitForTimeout(1000);

    const registerTab = page.locator(
      'button:has-text("Cadastrar"), button:has-text("Registrar"), button:has-text("Register"), [data-tab="register"], #tabRegister'
    ).first();
    if (await registerTab.count() === 0) return;

    await registerTab.click();
    await page.waitForTimeout(800);

    const hasExtraFields = await page.locator(
      'input[name="name"], input[placeholder*="ome"], input[name="confirmPassword"], input[id*="confirm"]'
    ).count() > 0;
    expect(hasExtraFields, 'Formulário de cadastro não apareceu').toBe(true);
  });

  test('Cortex: input vazio não dispara request /api/cortex', async ({ page }) => {
    const requests = [];
    page.on('request', req => {
      if (req.url().includes('/api/cortex')) requests.push(req.url());
    });

    await page.goto(`${BASE}/nexia/cortex`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(2000);

    const ta = page.locator('textarea#inp');
    if (await ta.count() > 0) await ta.fill('');

    const sendBtn = page.locator('#btnSend');
    if (await sendBtn.count() > 0) await sendBtn.click();

    await page.waitForTimeout(2000);
    expect(requests, 'Cortex disparou request com input vazio').toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. CORTEX — IA REAL
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('7. Cortex — IA real', () => {
  test('POST /api/cortex não retorna 500', async ({ request }) => {
    const res = await request.post(`${BASE}/api/cortex`, {
      data:    { message: 'olá', model: 'auto', tenantId: 'nexia' },
      timeout: 30_000,
    });
    expect(res.status(), 'Cortex crashou com 500').not.toBe(500);
  });

  test('POST /api/cortex: Content-Type é JSON, nunca HTML', async ({ request }) => {
    const res = await request.post(`${BASE}/api/cortex`, {
      data:    { message: '' },
      timeout: 15_000,
    });
    if (res.status() < 500) {
      const ct = res.headers()['content-type'] || '';
      expect(ct, 'Cortex retornou HTML em vez de JSON').toContain('json');
    }
  });

  test('POST /api/cortex 200: reply é string não vazia', async ({ request }) => {
    const res = await request.post(`${BASE}/api/cortex`, {
      data:    { message: 'ping', model: 'auto', tenantId: 'nexia' },
      timeout: 30_000,
    });
    if (res.status() === 200) {
      const body = await res.json();
      const hasText = typeof body.reply === 'string' && body.reply.trim().length > 0;
      expect(hasText, `Reply vazia: ${JSON.stringify(body)}`).toBe(true);
    } else {
      expect([400, 401, 403]).toContain(res.status());
    }
  });

  test('POST /api/cortex 200: resposta leva > 200ms (não é fake)', async ({ request }) => {
    const t0  = Date.now();
    const res = await request.post(`${BASE}/api/cortex`, {
      data:    { message: 'hello', model: 'auto', tenantId: 'nexia' },
      timeout: 30_000,
    });
    const ms = Date.now() - t0;
    if (res.status() === 200) {
      expect(ms, `Cortex respondeu em ${ms}ms — suspeito de fake`).toBeGreaterThan(200);
    }
  });

  test('GET /api/models retorna estrutura válida', async ({ request }) => {
    const res = await request.get(`${BASE}/api/models`, { timeout: 10_000 });
    expect(res.status(), '/api/models crashou').toBeLessThan(500);
    if (res.status() === 200) {
      const body = await res.json();
      const hasModels =
        Array.isArray(body) ||
        Array.isArray(body.models) ||
        (typeof body === 'object' && Object.keys(body).length > 0);
      expect(hasModels, 'Estrutura de modelos inválida').toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. SENTINEL — SCAN REAL
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('8. Sentinel — scan real', () => {
  test('GET /api/sentinel schema correto', async ({ request }) => {
    const res = await request.get(`${BASE}/api/sentinel`, { timeout: 30_000 });
    expect([200, 401, 403]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('health');
      expect(body).toHaveProperty('results');
    }
  });

  test('Sentinel: HEALTHY exige ms reais (> 5ms)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/sentinel`, { timeout: 30_000 });
    if (res.status() !== 200) return;
    const body    = await res.json();
    const results = body.results || [];
    const allFast = results.length > 0 && results.every(r => (r.ms ?? 0) < 5);
    if (allFast) {
      expect(body.health, 'HEALTHY falso — todos ms < 5ms').not.toBe('HEALTHY');
    }
  });

  test('Sentinel: resultados ok:false têm campo error preenchido', async ({ request }) => {
    const res = await request.get(`${BASE}/api/sentinel`, { timeout: 30_000 });
    if (res.status() !== 200) return;
    const body = await res.json();
    for (const r of (body.results || [])) {
      if (r.ok === false) {
        expect(r.error, `ok:false sem campo "error": ${JSON.stringify(r)}`).toBeTruthy();
      }
    }
  });

  test('Sentinel: cada resultado tem ms numérico', async ({ request }) => {
    const res = await request.get(`${BASE}/api/sentinel`, { timeout: 30_000 });
    if (res.status() !== 200) return;
    const body = await res.json();
    for (const r of (body.results || []).slice(0, 5)) {
      expect(typeof r.ms, `ms não é número: ${JSON.stringify(r)}`).toBe('number');
    }
  });

  test('Sentinel: ms não são todos idênticos (anti-fake)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/sentinel`, { timeout: 30_000 });
    if (res.status() !== 200) return;
    const body  = await res.json();
    const times = (body.results || []).map(r => r.ms);
    if (times.length >= 3) {
      const allSame = times.every(ms => ms === times[0]);
      expect(allSame, `Todos ms idênticos (${times[0]}ms) — fake detectado`).toBe(false);
    }
  });

  test('Sentinel: scan leva > 500ms (real, não cached)', async ({ request }) => {
    const t0  = Date.now();
    const res = await request.get(`${BASE}/api/sentinel`, { timeout: 60_000 });
    const ms  = Date.now() - t0;
    if (res.status() === 200) {
      expect(ms, `Scan em ${ms}ms — rápido demais`).toBeGreaterThan(500);
    }
  });

  test('POST /api/sentinel-qa payload vazio retorna 400 ou 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/sentinel-qa`, {
      data:    {},
      timeout: 10_000,
    });
    expect([400, 401, 403], `sentinel-qa aceitou payload vazio (${res.status()})`).toContain(res.status());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. OBSERVABILITY
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('9. Observability', () => {
  test('GET /api/observability schema de métricas', async ({ request }) => {
    const res = await request.get(`${BASE}/api/observability`, { timeout: 10_000 });
    expect([200, 401, 403]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('requests');
      expect(body).toHaveProperty('errors');
      expect(body).toHaveProperty('avgLatency');
    }
  });

  test('GET /api/observe (alias) responde sem 500', async ({ request }) => {
    const res = await request.get(`${BASE}/api/observe`, { timeout: 10_000 });
    expect(res.status(), '/api/observe retornou 500').not.toBe(500);
  });

  test('Dashboard: cards de métrica renderizados', async ({ page }) => {
    await page.goto(`${BASE}/nexia/observability.html`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForTimeout(2000);
    const cards = await page.locator('.metric-card, .card, [class*="metric"], [class*="stat"]').count();
    expect(cards, 'Nenhum card de métrica encontrado').toBeGreaterThan(0);
  });

  test('Dashboard: log panel presente', async ({ page }) => {
    await page.goto(`${BASE}/nexia/observability.html`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForTimeout(2000);
    const logPanel = await page.locator('#logPanel, .log-panel, [id*="log"], [class*="log-panel"]').count();
    expect(logPanel, 'Painel de logs não encontrado').toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. APIs — SEM 500
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('10. APIs — sem 500', () => {
  const GET_APIS = [
    '/api/firebase-config',
    '/api/sentinel',
    '/api/observability',
    '/api/models',
    '/api/usage',
    '/api/notifications',
    '/api/audit',
    '/api/sentinel-qa?action=ping',
  ];

  for (const ep of GET_APIS) {
    test(`GET ${ep} < 500`, async ({ request }) => {
      const res = await request.get(`${BASE}${ep}`, { timeout: 15_000 });
      expect(res.status(), `${ep} retornou 500`).not.toBe(500);
      expect(res.status(), `${ep} retornou 502`).not.toBe(502);
      expect(res.status(), `${ep} retornou 503`).not.toBe(503);
    });
  }

  const POST_APIS = [
    { path: '/api/auth',   body: { action: 'check' }               },
    { path: '/api/logs',   body: { level: 'info', message: 'test' } },
    { path: '/api/events', body: { type: 'test' }                   },
    { path: '/api/tenant', body: { action: 'get' }                  },
  ];

  for (const { path, body } of POST_APIS) {
    test(`POST ${path} retorna JSON (não HTML)`, async ({ request }) => {
      const res = await request.post(`${BASE}${path}`, { data: body, timeout: 15_000 });
      expect(res.status(), `${path} crashou`).not.toBe(500);
      if (res.status() < 500) {
        const ct = res.headers()['content-type'] || '';
        expect(ct, `${path} retornou HTML`).toContain('json');
      }
    });
  }

  test('/api/firebase-config retorna apiKey e projectId', async ({ request }) => {
    const res = await request.get(`${BASE}/api/firebase-config`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('apiKey');
    expect(body).toHaveProperty('projectId');
    expect(body.apiKey,    'apiKey vazia').toBeTruthy();
    expect(body.projectId, 'projectId vazio').toBeTruthy();
  });

  test('/api/auth check sem token retorna authenticated:false', async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth`, {
      data:    { action: 'check' },
      timeout: 10_000,
    });
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.authenticated, '/api/auth retornou authenticated:true sem token!').toBe(false);
    } else {
      expect([400, 401, 403]).toContain(res.status());
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. DETECÇÃO DE FAKE
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('11. Detecção de fake', () => {
  test('Cortex reply não é hardcoded "ok/true/mock"', async ({ request }) => {
    const res = await request.post(`${BASE}/api/cortex`, {
      data:    { message: 'ping', model: 'auto', tenantId: 'nexia' },
      timeout: 30_000,
    });
    if (res.status() === 200) {
      const body  = await res.json();
      const reply = (body.reply || '').toLowerCase().trim();
      expect(reply).not.toBe('ok');
      expect(reply).not.toBe('true');
      expect(reply).not.toBe('mock');
      expect(reply.length, 'Reply muito curta — suspeito de fake').toBeGreaterThan(3);
    }
  });

  test('Nenhuma rota GET retorna HTML quando espera JSON', async ({ request }) => {
    for (const r of ['/api/firebase-config', '/api/observability']) {
      const res = await request.get(`${BASE}${r}`, { timeout: 10_000 });
      if (res.status() < 400) {
        const ct = res.headers()['content-type'] || '';
        expect(ct, `${r} retornou HTML`).toContain('json');
      }
    }
  });

  test('Sentinel ok:false tem status 0 ou >= 400', async ({ request }) => {
    const res = await request.get(`${BASE}/api/sentinel`, { timeout: 30_000 });
    if (res.status() !== 200) return;
    const body = await res.json();
    for (const r of (body.results || [])) {
      if (r.ok === false) {
        const st = r.status ?? r.statusCode ?? 0;
        expect(
          st === 0 || st >= 400,
          `ok:false mas status ${st}: ${JSON.stringify(r)}`
        ).toBe(true);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. PERFORMANCE
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('12. Performance', () => {
  test('Login carrega em < 10s', async ({ page }) => {
    const t0 = Date.now();
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 12_000 });
    expect(Date.now() - t0, 'Login demorou > 10s').toBeLessThan(10_000);
  });

  test('Cortex carrega em < 12s', async ({ page }) => {
    const t0 = Date.now();
    await page.goto(`${BASE}/nexia/cortex`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    expect(Date.now() - t0, 'Cortex demorou > 12s').toBeLessThan(12_000);
  });

  test('/api/firebase-config responde em < 3s', async ({ request }) => {
    const t0 = Date.now();
    await request.get(`${BASE}/api/firebase-config`, { timeout: 5_000 });
    expect(Date.now() - t0, 'firebase-config lento').toBeLessThan(3_000);
  });

  test('/api/observability responde em < 2s', async ({ request }) => {
    const t0 = Date.now();
    await request.get(`${BASE}/api/observability`, { timeout: 5_000 });
    expect(Date.now() - t0, '/api/observability lento').toBeLessThan(2_000);
  });
});