'use strict';
const logger = require('./logger');
const { getMetrics } = require('./metrics');

const THRESHOLDS = {
  avgLatency: parseInt(process.env.ALERT_LATENCY_MS) || 1500,
  errRate:    parseFloat(process.env.ALERT_ERROR_RATE) || 5.0,
  p99:        parseInt(process.env.ALERT_P99_MS) || 3000
};

let lastAlert = {};

function checkAlerts() {
  const m = getMetrics();
  if (m.requests < 5) return; // not enough data

  const checks = [
    { key: 'latency', cond: m.avgLatency > THRESHOLDS.avgLatency, msg: `Avg latency ${m.avgLatency}ms > ${THRESHOLDS.avgLatency}ms`, severity: 'WARN'  },
    { key: 'errRate', cond: m.errRate    > THRESHOLDS.errRate,    msg: `Error rate ${m.errRate}% > ${THRESHOLDS.errRate}%`,          severity: 'ERROR' },
    { key: 'p99',     cond: m.p99        > THRESHOLDS.p99,        msg: `P99 latency ${m.p99}ms > ${THRESHOLDS.p99}ms`,               severity: 'WARN'  }
  ];

  for (const c of checks) {
    const now = Date.now();
    if (c.cond && (!lastAlert[c.key] || now - lastAlert[c.key] > 60_000)) {
      lastAlert[c.key] = now;
      logger[c.severity === 'ERROR' ? 'error' : 'warn']('ALERT', { alert: c.key, msg: c.msg, metrics: m });
    }
  }
}

let _interval = null;
function startAlerts(intervalMs = 15_000) {
  if (_interval) return;
  _interval = setInterval(checkAlerts, intervalMs);
}

module.exports = { checkAlerts, startAlerts };
