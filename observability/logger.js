'use strict';
const LEVELS = { INFO: 0, WARN: 1, ERROR: 2 };
const MIN_LEVEL = process.env.LOG_LEVEL ? LEVELS[process.env.LOG_LEVEL] || 0 : 0;

function log(level, message, meta = {}) {
  if ((LEVELS[level] || 0) < MIN_LEVEL) return;
  const entry = {
    level,
    message,
    ...meta,
    ts: new Date().toISOString(),
    service: 'nexia-os'
  };
  console.log(JSON.stringify(entry));
}

module.exports = {
  info:  (msg, meta) => log('INFO',  msg, meta),
  warn:  (msg, meta) => log('WARN',  msg, meta),
  error: (msg, meta) => log('ERROR', msg, meta),
  raw:   log
};
