'use strict';
const logger  = require('./logger');
const { trackRequest } = require('./metrics');

function traceMiddleware(req, res, next) {
  const start = Date.now();
  const { method, url } = req;

  res.on('finish', () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    trackRequest(url, ms, status);
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    logger[level]('http', { method, url, status, ms });
  });

  next();
}

// Wrap a single async handler (Netlify / standalone)
function trace(handler) {
  return async (req, res) => {
    const start = Date.now();
    try {
      await handler(req, res);
      const ms = Date.now() - start;
      trackRequest(req.url || '/', ms, res.statusCode || 200);
      logger.info('http', { url: req.url, ms, status: res.statusCode });
    } catch (err) {
      const ms = Date.now() - start;
      trackRequest(req.url || '/', ms, 500);
      logger.error('http', { url: req.url, ms, error: err.message });
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  };
}

module.exports = { traceMiddleware, trace };
