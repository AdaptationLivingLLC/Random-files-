import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);
const root = fileURLToPath(new URL('./public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function identity(req) {
  // Only trust proxy identity when the proxy presents an explicitly configured secret.
  const brokerTrusted = process.env.BROKER_SECRET && equal(req.headers['x-still-broker-secret'], process.env.BROKER_SECRET);
  const trusted = brokerTrusted || process.env.PROXY_SECRET && equal(req.headers['x-still-proxy-secret'], process.env.PROXY_SECRET);
  const onVercel = process.env.VERCEL === '1';
  const ip = trusted ? req.headers['x-still-client-ip'] : onVercel ? req.headers['x-real-ip'] || req.socket.remoteAddress : req.socket.remoteAddress;
  const zone = trusted ? req.headers['x-still-timezone'] : process.env.VERCEL === '1' ? req.headers['x-vercel-ip-timezone'] : (!production && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip) ? process.env.DEV_TIMEZONE || 'America/Phoenix' : null);
  if (!ip || ip.length > 100) throw new Error('Location unavailable');
  if (zone) new Intl.DateTimeFormat('en-US', { timeZone: zone });
  return { ip, zone };
}
function reply(res, status, obj) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
async function body(req) {
  let value = ''; for await (const chunk of req) { value += chunk; if (value.length > 8192) throw new Error('Request too large'); }
  return JSON.parse(value || '{}');
}
export async function handleRequest(req,res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'");
  if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  try {
    const path = new URL(req.url,'http://localhost').pathname;
    if (!path.startsWith('/api/')) {
      if (req.method !== 'GET') return reply(res,405,{error:'Method not allowed'});
      const file = ({'/':'index.html','/collection':'index.html','/style.css':'style.css','/app.js':'app.js','/common.js':'common.js','/codec.js':'codec.js','/veil.js':'veil.js','/offline.html':'VeilDrop-Decoder-Offline.html'})[path];
      if (!file) return reply(res,404,{error:'Not found'});
      const content = await readFile(root+file);
      if (file === 'VeilDrop-Decoder-Offline.html') res.setHeader('Content-Disposition','attachment; filename=VeilDrop-Decoder-Offline.html');
      res.writeHead(200,{'Content-Type':types[file.slice(file.lastIndexOf('.'))]}); return res.end(content);
    }
    if (!['/api/context','/api/login','/api/logout','/api/open','/api/heartbeat'].includes(path)) return reply(res,403,{error:'This is the decoder website.'});
    if (!process.env.BROKER_ORIGIN || !process.env.BROKER_SECRET) return reply(res,503,{error:'The key broker connection is not configured.'});
    if (!['GET','POST'].includes(req.method)) return reply(res,405,{error:'Method not allowed'});
    if (req.method === 'POST') {
      const origins = (process.env.PUBLIC_ORIGINS || process.env.PUBLIC_ORIGIN || `http://localhost:${port}`).split(',').map(v=>v.trim());
      if (!origins.includes(req.headers.origin)) return reply(res,403,{error:'Request origin rejected'});
    }
    const {ip,zone} = identity(req);
    const payload = req.method === 'POST' ? JSON.stringify(await body(req)) : undefined;
    const upstream = await fetch(new URL(path,process.env.BROKER_ORIGIN),{method:req.method,headers:{'Content-Type':'application/json','x-still-broker-secret':process.env.BROKER_SECRET,'x-still-site':'decoder','x-still-client-ip':ip,'x-still-timezone':zone||'',Origin:req.headers.origin||'',Cookie:req.headers.cookie||''},body:payload,redirect:'error',signal:AbortSignal.timeout(10000)});
    const setCookie=upstream.headers.get('set-cookie'); if(setCookie)res.setHeader('Set-Cookie',setCookie);
    res.writeHead(upstream.status,{'Content-Type':'application/json'});res.end(await upstream.text());
  } catch { reply(res,400,{error:'Unable to complete the request.'}); }
}
export const server = http.createServer(handleRequest);
