#!/usr/bin/env node
'use strict';
/**
 * NEXIA Code Audit — detects fake/mock patterns, broken error handling,
 * TDZ risks, and missing Firebase guards.
 */
const fs   = require('fs');
const path = require('path');

const RED_FLAGS = [
  { pattern: /return\s+\{\s*ok\s*:\s*true\s*\}/g,       msg: 'return {ok:true} — possível fake de sucesso' },
  { pattern: /catch\s*\([^)]*\)\s*\{[^}]*return\s+true/g,msg: 'catch retorna true — esconde erro' },
  { pattern: /\[\s*\]\s*\/\/\s*mock/gi,                   msg: 'array mock encontrado' },
  { pattern: /placeholder/gi,                             msg: 'placeholder encontrado' },
  { pattern: /setTimeout\(\s*resolve/g,                   msg: 'fake async delay' },
  { pattern: /firebase\.auth\(\)\s*\./g,                  msg: 'firebase.auth() sem checar apps.length — pode causar No App error' },
];

const JS_ONLY = [
  { pattern: /let\s+(\w+)\s*=/, msg: 'let declarado — verificar TDZ' }
];

let totalIssues = 0;

function scanFile(filePath) {
  const ext  = path.extname(filePath);
  const src  = fs.readFileSync(filePath, 'utf-8');
  const rel  = path.relative(process.cwd(), filePath);
  const flags = [...RED_FLAGS, ...(ext === '.js' ? JS_ONLY : [])];
  const issues = [];

  for (const { pattern, msg } of flags) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m;
    while ((m = re.exec(src)) !== null) {
      const line = src.slice(0, m.index).split('\n').length;
      issues.push({ line, msg, snippet: m[0].trim().slice(0,80) });
    }
  }

  // Firebase guard check
  if (src.includes('firebase.auth()') && !src.includes('firebase.apps')) {
    issues.push({ line: '?', msg: '🚨 CRÍTICO: firebase.auth() sem firebase.apps.length check', snippet: '' });
  }

  if (issues.length) {
    console.log(`\n📄 ${rel}`);
    issues.forEach(i => {
      console.log(`   L${i.line}: [${i.msg}]${i.snippet ? ' → ' + i.snippet : ''}`);
      totalIssues++;
    });
  }
}

function walk(dir, depth = 0) {
  if (depth > 6) return;
  if (dir.startsWith('/dev') || dir.startsWith('/proc') || dir.startsWith('/sys')) return;
  const skip = ['node_modules', '.git', 'dist', '.next'];
  for (const f of fs.readdirSync(dir)) {
    if (skip.includes(f)) continue;
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) { walk(full, depth+1); continue; }
    if (/\.(js|html)$/.test(f)) scanFile(full);
  }
}

console.log('🔍 NEXIA Audit iniciado...\n');
walk(process.cwd());
console.log(`\n${'─'.repeat(50)}`);
if (totalIssues === 0) {
  console.log('✅ Nenhum problema encontrado.');
} else {
  console.log(`⚠️  ${totalIssues} problema(s) encontrado(s). Revise antes do deploy.`);
  process.exitCode = 1;
}
