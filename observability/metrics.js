'use strict';
const store = {
  requests: 0,
  errors: 0,
  latency: [],
  byPath: {},
  startedAt: Date.now()
};

function trackRequest(path, ms, status) {
  store.requests++;
  store.latency.push(ms);
  if (store.latency.length > 1000) store.latency.shift(); // rolling window
  if (!store.byPath[path]) store.byPath[path] = { count: 0, errors: 0, latency: [] };
  store.byPath[path].count++;
  store.byPath[path].latency.push(ms);
  if (status >= 500) { store.errors++; store.byPath[path].errors++; }
}

function getMetrics() {
  const lats = store.latency;
  const avg = lats.length ? Math.round(lats.reduce((a,b)=>a+b,0)/lats.length) : 0;
  const sorted = [...lats].sort((a,b)=>a-b);
  const p95 = sorted[Math.floor(sorted.length*0.95)] || 0;
  const p99 = sorted[Math.floor(sorted.length*0.99)] || 0;
  const uptimeMs = Date.now() - store.startedAt;
  const errRate = store.requests ? ((store.errors/store.requests)*100).toFixed(1) : '0.0';
  const paths = Object.entries(store.byPath).map(([p, d]) => ({
    path: p,
    count: d.count,
    errors: d.errors,
    avgMs: d.latency.length ? Math.round(d.latency.reduce((a,b)=>a+b,0)/d.latency.length) : 0
  }));
  return { requests: store.requests, errors: store.errors, errRate: parseFloat(errRate),
    avgLatency: avg, p95, p99, uptimeMs, paths };
}

module.exports = { trackRequest, getMetrics };
