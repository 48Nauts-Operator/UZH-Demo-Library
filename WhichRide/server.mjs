import {createDailyLimit,DailyLimitError} from '../shared/daily-limit.mjs';
import http from 'node:http';
import {readFile, mkdir, writeFile, rename} from 'node:fs/promises';
import {randomBytes, createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {AppError, validateSearch, normalizeConnections, buildQuestions, applyJudgments} from './src/journeys.mjs';
import {createFareService} from './src/fares.mjs';
import {readSbbFares} from './src/fare-browser.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
try { process.loadEnvFile(root + '.env.local'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const dailyLimit=createDailyLimit({file:root+'.runtime/daily-usage.json',limit:Number(process.env.DAILY_SEARCH_LIMIT||100)});
const key = process.env.TYPESAFE_API_KEY || '';
const sessions = new Map(), searches = new Map(), rate = new Map();
const fareService=createFareService(readSbbFares);
const maxCalls = Number(process.env.JEV_TOTAL_CALL_LIMIT || 200);
await mkdir(root + '.runtime', {recursive: true, mode: 0o700});
let ledger = {calls: 0};
try { ledger = JSON.parse(await readFile(root + '.runtime/usage.json','utf8')); } catch(e) { if(e.code !== 'ENOENT') throw e; }
let reservation = Promise.resolve();
async function reserveCall() {
  const operation = reservation.then(async () => {
    if (ledger.calls >= maxCalls) throw new AppError('Das Testkontingent ist aufgebraucht. Die Fahrplansuche bleibt verfügbar.', 429);
    ledger.calls++;
    await writeFile(root + '.runtime/usage.tmp', JSON.stringify(ledger), {mode: 0o600});
    await rename(root + '.runtime/usage.tmp', root + '.runtime/usage.json');
  });
  reservation = operation.catch(() => {}); return operation;
}
const securityHeaders = {'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", 'Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
function json(res, data, status = 200) { res.writeHead(status, {...securityHeaders, 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {...options, signal: AbortSignal.timeout(22000)});
  if (response.status === 402 && url.startsWith('https://api.typesafe.ai/')) throw new AppError('Jev ist vorübergehend pausiert: Das Guthaben für die persönliche Sortierung ist aufgebraucht. Die Fahrplansuche funktioniert weiterhin.',503);
  if (!response.ok) throw new AppError('Ein Datendienst ist gerade nicht erreichbar. Bitte später erneut versuchen.', 502);
  return response.json();
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('JSON erforderlich.', 415);
  let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 4096) throw new AppError('Eingabe zu lang.', 413); }
  try { return JSON.parse(text); } catch { throw new AppError('Ungültige Anfrage.'); }
}
function rateLimit(req, kind, limit) {
  const ip = process.env.TRUST_PROXY === '1' ? req.headers['cf-connecting-ip'] || req.socket.remoteAddress : req.socket.remoteAddress;
  const id = createHash('sha256').update(String(ip)).digest('hex') + kind;
  let entry = rate.get(id); if (!entry || entry.until < Date.now()) entry = {n:0, until:Date.now()+60000};
  rate.set(id, entry); if (++entry.n > limit) throw new AppError('Kurz durchatmen: bitte in einer Minute erneut versuchen.',429);
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) throw new AppError('Anfrage von einer anderen Website abgelehnt.',403);
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError('Anfrage von einer anderen Website abgelehnt.',403);
}
const files = {'/':'index.html','/index.html':'index.html','/app.js':'app.js','/sbb-links.js':'sbb-links.js','/cities.json':'../data/swiss-cities.json','/style.css':'style.css','/favicon.svg':'favicon.svg'};
const mime = {html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',json:'application/json'};
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res,{ok:true,jevAvailable:!!key});
    if (req.method === 'GET' && url.pathname === '/api/stations') {
      rateLimit(req,'stations',40); const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2 || q.length > 80) return json(res,{stations:[]});
      const data = await fetchJSON('https://transport.opendata.ch/v1/locations?' + new URLSearchParams({query:q,type:'station'}));
      return json(res,{stations:(data.stations || []).filter(s=>s.id).slice(0,7).map(s=>({id:s.id,name:s.name}))});
    }
    if (req.method === 'POST' && url.pathname === '/api/journeys') {
      sameOrigin(req); rateLimit(req,'search',12); const input = await body(req), query = validateSearch(input);
      await dailyLimit();
      const cacheKey = JSON.stringify(query); let result = searches.get(cacheKey);
      if (!result || result.expires < Date.now()) {
        const data = await fetchJSON('https://transport.opendata.ch/v1/connections?' + new URLSearchParams(query));
        result = {journeys:normalizeConnections(data), fetchedAt:new Date().toISOString(), expires:Date.now()+30000};
        if(searches.size > 300) searches.delete(searches.keys().next().value);
        searches.set(cacheKey,result);
      }
      if(sessions.size > 500) sessions.delete(sessions.keys().next().value);
      const id = randomBytes(24).toString('hex');
      sessions.set(id,{...result,expires:Date.now()+10*60000,results:new Map(),pending:new Map()});
      return json(res,{id,journeys:result.journeys,fetchedAt:result.fetchedAt,jevAvailable:!!key});
    }
    if (req.method === 'POST' && url.pathname === '/api/fares') {
      sameOrigin(req);rateLimit(req,'fares',60);const input=await body(req);
      const session=sessions.get(input.id);
      if(!session || session.expires<Date.now())throw new AppError('Bitte die Verbindungen neu laden; die Suche ist abgelaufen.',410);
      return json(res,fareService.request(session.journeys,input.reduction));
    }
    if (req.method === 'POST' && url.pathname === '/api/rank') {
      sameOrigin(req); rateLimit(req,'rank',8); const input = await body(req);
      const session = sessions.get(input.id), preferences = typeof input.preferences === 'string' ? input.preferences.trim() : '';
      if (!session || session.expires < Date.now()) throw new AppError('Bitte die Verbindungen neu laden; die Suche ist abgelaufen.',410);
      if (preferences.length < 5 || preferences.length > 600) throw new AppError('Bitte 5 bis 600 Zeichen zu deiner Reise eingeben.');
      if (!session.journeys.length) throw new AppError('Bitte zuerst Verbindungen suchen.');
      if (!key) throw new AppError('Die persönliche Sortierung ist gerade nicht verfügbar.',503);
      if (session.results.has(preferences)) return json(res,{...session.results.get(preferences),cached:true});
      if (session.pending.has(preferences)) return json(res,await session.pending.get(preferences));
      const operation = (async () => {
        await dailyLimit('rankings');
        await reserveCall(); const start = performance.now();
        const request = buildQuestions(session.journeys, preferences);
        const data = await fetchJSON('https://api.typesafe.ai/v1/systemone', {method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model:'jev-1.13.0',...request})});
        const ranked = applyJudgments(session.journeys,data.answers);
        const result = {journeys:ranked,model:data.model,latencyMs:Math.round(performance.now()-start),rankedAt:new Date().toISOString(),cached:false};
        session.results.set(preferences,result); return result;
      })();
      session.pending.set(preferences,operation);
      try { return json(res,await operation); } finally { session.pending.delete(preferences); }
    }
    if (req.method === 'GET' && files[url.pathname]) {
      const name = files[url.pathname]; res.writeHead(200,{...securityHeaders,'Content-Type':mime[name.split('.').pop()]+'; charset=utf-8','Cache-Control':'no-cache'});
      return res.end(await readFile(root+'public/'+name));
    }
    json(res,{error:'Nicht gefunden.'},404);
  } catch (e) {
    if (!res.headersSent) json(res,{error:(e instanceof AppError || e instanceof DailyLimitError) ? e.message : 'Der Dienst ist gerade nicht erreichbar. Bitte erneut versuchen.'},(e instanceof AppError || e instanceof DailyLimitError) ? e.status : 502);
    else res.end();
  }
});
setInterval(() => { for(const [k,v] of sessions) if(v.expires < Date.now()) sessions.delete(k); for(const [k,v] of rate) if(v.until < Date.now()) rate.delete(k); },60000).unref();
server.listen(Number(process.env.PORT || 3360),process.env.HOST || '127.0.0.1',()=>console.log(`WhichRide listening on http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3360} · Jev ${key ? 'ready':'unavailable'}`));
