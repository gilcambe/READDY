'use strict';
/* GET /api/observability — real-time metrics from in-process store */
const CORS = { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type' };

// Fallback in-memory store for cold starts
const _local = { reqs:0, errs:0, lats:[], byPath:{}, startedAt:Date.now() };

function getStore() {
  // In server.js context, global._obsMetrics is available
  return (typeof global !== 'undefined' && global._obsMetrics) ? global._obsMetrics : _local;
}

function calcMetrics(s) {
  const lats = s.lats || s.latency || [];
  const avg  = lats.length ? Math.round(lats.reduce((a,b)=>a+b,0)/lats.length) : 0;
  const sorted = [...lats].sort((a,b)=>a-b);
  const p95  = sorted[Math.floor(sorted.length*0.95)]||0;
  const p99  = sorted[Math.floor(sorted.length*0.99)]||0;
  const reqs = s.reqs||s.requests||0;
  const errs = s.errs||s.errors||0;
  const errRate = reqs ? +(((errs/reqs)*100).toFixed(1)) : 0;
  const byPath = s.byPath||{};
  const paths = Object.entries(byPath).map(([p,d])=>({
    path:p, count:d.count||0, errors:d.errors||0,
    avgMs: (d.lats||d.latency||[]).length
      ? Math.round((d.lats||d.latency||[]).reduce((a,b)=>a+b,0)/(d.lats||d.latency||[]).length) : 0
  })).sort((a,b)=>b.count-a.count).slice(0,20);
  return { requests:reqs, errors:errs, errRate, avgLatency:avg, p95, p99,
    uptimeMs: Date.now()-(s.startedAt||Date.now()), paths, ts: new Date().toISOString() };
}

exports.handler = async (event) => {
  if (event.httpMethod==='OPTIONS') return {statusCode:204,headers:CORS,body:''};
  if (event.httpMethod==='POST') {
    try {
      const b = JSON.parse(event.body||'{}'');
      const s = _local;
      s.reqs++; s.lats.push(b.ms||0);
      if((b.status||200)>=500) s.errs++;
      if(!s.byPath[b.path]) s.byPath[b.path]={count:0,errors:0,lats:[]};
      s.byPath[b.path].count++; s.byPath[b.path].lats.push(b.ms||0);
      if((b.status||200)>=500) s.byPath[b.path].errors++;
      return {statusCode:200,headers:CORS,body:JSON.stringify({ok:true})};
    } catch(e) { return {statusCode:400,headers:CORS,body:JSON.stringify({error:e.message})}; }
  }
  return {statusCode:200,headers:CORS,body:JSON.stringify(calcMetrics(getStore()))};
};
