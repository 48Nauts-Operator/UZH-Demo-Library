import {createDailyLimit,DailyLimitError} from '../shared/daily-limit.mjs';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {AppError,publicFlight} from './src/core.mjs';
import {resolveSearchInput} from './src/search-input.mjs';
import {airports,originChoices} from './src/airports.mjs';
import {credentials,createServices} from './src/services.mjs';
import QRCode from 'qrcode';

const root=fileURLToPath(new URL('.',import.meta.url));
try{process.loadEnvFile(root+'.env.local');}catch(error){if(error.code!=='ENOENT')throw error;}
const dailyLimit=createDailyLimit({file:root+'.runtime/daily-usage.json',limit:Number(process.env.DAILY_SEARCH_LIMIT||100)});
const keys=await credentials(),services=await createServices(root,keys);
const sessions=new Map(),rates=new Map();let active=0;
const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://www.google.com/travel/clk/f",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
function json(res,data,status=200){res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function sameOrigin(req){if(req.headers['sec-fetch-site']==='cross-site')throw new AppError('Diese Anfrage ist nicht erlaubt.',403);if(req.headers.origin){let u;try{u=new URL(req.headers.origin);}catch{throw new AppError('Ungültige Anfrage.',403);}if(u.host!==req.headers.host)throw new AppError('Diese Anfrage ist nicht erlaubt.',403);}}
function limit(req,kind,max){const ip=process.env.TRUST_PROXY==='1'?(req.headers['cf-connecting-ip']||req.socket.remoteAddress):req.socket.remoteAddress;const id=createHash('sha256').update(String(ip)+kind).digest('hex');let r=rates.get(id);if(!r||r.until<Date.now())r={n:0,until:Date.now()+60000};rates.set(id,r);if(++r.n>max)throw new AppError('Bitte einen Moment warten und in einer Minute erneut suchen.',429);}
async function body(req){if(!req.headers['content-type']?.startsWith('application/json'))throw new AppError('Ungültiges Anfrageformat.',415);let value='';for await(const chunk of req){value+=chunk;if(Buffer.byteLength(value)>4096)throw new AppError('Die Eingabe ist zu lang.',413);}try{return JSON.parse(value);}catch{throw new AppError('Die Anfrage konnte nicht gelesen werden.');}}
const files={'/':'index.html','/index.html':'index.html','/try':'try.html','/try/':'try.html','/try.js':'try.js','/try.css':'try.css','/app.js':'app.js','/style.css':'style.css','/favicon.svg':'favicon.svg'};
const qrCache=new Map();
const mime={html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&url.pathname==='/api/health')return json(res,{ok:true,faresAvailable:!!keys.serpKey,jevAvailable:!!keys.jevKey});
    if(req.method==='GET'&&url.pathname==='/api/airports')return json(res,{airports,origins:originChoices});
    if(req.method==='GET'&&url.pathname==='/api/qr.svg'){
      const value=url.searchParams.get('origin')||'';
      let origin;try{origin=new URL(value);}catch{throw new AppError('Ungültige Website-Adresse.');}
      if(value.length>300||origin.origin!==value||origin.host!==req.headers.host||origin.username||origin.password||!['https:','http:'].includes(origin.protocol))throw new AppError('Bitte den QR-Code auf dieser Website öffnen.');
      if(origin.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(origin.hostname))throw new AppError('Bitte die HTTPS-Adresse verwenden.');
      const target=origin.origin+'/';
      if(!qrCache.has(target)){
        const svg=await QRCode.toString(target,{type:'svg',errorCorrectionLevel:'M',margin:4,width:800,color:{dark:'#172d64',light:'#ffffff'}});
        if(qrCache.size>=16)qrCache.delete(qrCache.keys().next().value);qrCache.set(target,svg);
      }
      res.writeHead(200,{...headers,'Content-Type':'image/svg+xml','Cache-Control':'private, max-age=300'});return res.end(qrCache.get(target));
    }
    if(req.method==='POST'&&url.pathname==='/api/search'){
      sameOrigin(req);limit(req,'search',8);const input=await body(req);
      if(active>=3)throw new AppError('Es laufen gerade mehrere Suchen. Bitte gleich erneut versuchen.',429);
      active++;
      try{
        await dailyLimit();
        const interpretation=await resolveSearchInput(input,services.interpret);
        const result=await services.search(interpretation.query);
        const id=randomBytes(18).toString('hex');
        if(sessions.size>=150)sessions.delete(sessions.keys().next().value);
        sessions.set(id,{query:interpretation.query,options:result.options,expires:Date.now()+15*60000,bookings:new Map()});
        const options=result.options.map(f=>({...publicFlight(f),returnFlight:f.returnFlight?publicFlight(f.returnFlight):null,canBook:!!f.bookingToken}));
        return json(res,{...result,options,...interpretation,id});
      }finally{active--;}
    }
    if(req.method==='POST'&&url.pathname==='/api/booking'){
      sameOrigin(req);limit(req,'booking',8);const input=await body(req),session=sessions.get(input.id);
      if(!session||session.expires<Date.now())throw new AppError('Diese Suche ist abgelaufen. Bitte die Flugpreise neu laden.',410);
      const flight=session.options.find(f=>f.id===input.flightId);if(!flight)throw new AppError('Dieser Flug gehört nicht zur aktuellen Suche.',404);
      if(!session.bookings.has(flight.id))session.bookings.set(flight.id,services.booking(session.query,flight).catch(e=>{session.bookings.delete(flight.id);throw e;}));
      return json(res,await session.bookings.get(flight.id));
    }
    if(req.method==='GET'&&files[url.pathname]){const name=files[url.pathname];res.writeHead(200,{...headers,'Content-Type':mime[name.split('.').at(-1)]+'; charset=utf-8','Cache-Control':'no-cache'});return res.end(await readFile(root+'public/'+name));}
    json(res,{error:'Nicht gefunden.'},404);
  }catch(e){if(!res.headersSent)json(res,{error:(e instanceof AppError || e instanceof DailyLimitError)?e.message:'Die Suche konnte nicht abgeschlossen werden. Bitte erneut versuchen.',...((e instanceof AppError || e instanceof DailyLimitError)?e.details:{})},(e instanceof AppError || e instanceof DailyLimitError)?e.status:502);else res.end();}
});
server.requestTimeout=120000;server.headersTimeout=15000;
setInterval(()=>{for(const [k,v] of sessions)if(v.expires<Date.now())sessions.delete(k);for(const [k,v] of rates)if(v.until<Date.now())rates.delete(k);},60000).unref();
server.listen(Number(process.env.PORT||3361),process.env.HOST||'127.0.0.1',()=>console.log('WhichFlight ready on port '+(process.env.PORT||3361)));
