// playwright.config.js — NEXIA OS v52
// ─────────────────────────────────────────────────────────────────────────────
// USA O CHROME LOCAL DA MÁQUINA (sem baixar nada externo)
// Headless = roda em background, sem abrir janela
// ─────────────────────────────────────────────────────────────────────────────
const { defineConfig } = require('@playwright/test');
const path = require('path');

// Caminhos comuns do Chrome no Windows — usa o primeiro que existir
const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.CHROME_PATH || '',
].filter(Boolean);

function findChrome() {
  const fs = require('fs');
  for (const p of CHROME_PATHS) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  // fallback: usa o channel 'chrome' e deixa o Playwright achar sozinho
  return undefined;
}

const executablePath = findChrome();

module.exports = defineConfig({
  testFiles: ['nexia.test.js'],
  timeout:   90_000,   // 90s — suficiente para Render cold start
  retries:   1,
  workers:   2,

  use: {
    baseURL: process.env.BASE_URL || 'https://nexia-os.onrender.com',
    ignoreHTTPSErrors: true,   // ← resolve erros SSL corporativo
    headless: true,            // ← roda em background sem abrir janela
    screenshot: 'only-on-failure',
    video:      'retain-on-failure',
    trace:      'retain-on-failure',

    // Chrome local — sem download
    ...(executablePath
      ? { executablePath }
      : { channel: 'chrome' }),  // fallback: usa Chrome instalado via channel

    launchOptions: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--ignore-certificate-errors',   // ← segunda camada SSL fix
        '--disable-gpu',
      ],
    },
  },

  projects: [
    {
      name: 'chrome-local',
      use: {
        ...(executablePath
          ? { executablePath }
          : { channel: 'chrome' }),
        headless: true,
        ignoreHTTPSErrors: true,
      },
    },
  ],

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
});