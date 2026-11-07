import {readFile,mkdir,writeFile,rename,readdir,unlink} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {AppError,searchParams,normalizeFlights,providerTimestamp,googleLink} from './core.mjs';
import {buildInterpretation,applyInterpretation} from './interpret.mjs';

export async function credentials(){
  return {serpKey:process.env.SERP_API_KEY||'',jevKey:process.env.TYPESAFE_API_KEY||''};
}
export async function createServices(root,keys){
  const runtime=root+'.runtime/';await mkdir(runtime+'cache',{recursive:true,mode:0o700});
  let ledger={fares:0,jev:0};
  try{ledger=JSON.parse(await readFile(runtime+'usage.json','utf8'));if(!Number.isInteger(ledger.fares)||!Number.isInteger(ledger.jev))throw new Error('Invalid usage ledger');}catch(e){if(e.code!=='ENOENT')throw e;}
  let queue=Promise.resolve();let quota=null;const inflight=new Map(),interpretations=new Map();
  async function cleanup(){
    for(const [id,entry] of interpretations)if(entry.expires<Date.now())interpretations.delete(id);
    for(const name of await readdir(runtime+'cache')){if(!name.endsWith('.json'))continue;try{const path=runtime+'cache/'+name;const entry=JSON.parse(await readFile(path,'utf8'));if(entry.expires<Date.now())await unlink(path);}catch{}}
  }
  await cleanup();
  setInterval(()=>{cleanup().catch(()=>{});},5*60000).unref();
  const reserve=Number(process.env.SERP_MONTHLY_RESERVE||25);
  async function reserveCall(kind){
    const action=queue.then(async()=>{
      const limit=Number(kind==='fares'?(process.env.FLIGHT_TOTAL_CALL_LIMIT||100):(process.env.JEV_TOTAL_CALL_LIMIT||100));
      if(ledger[kind]>=limit)throw new AppError('Das Suchkontingent dieser Testseite ist aufgebraucht. Bitte später erneut versuchen.',429);
      if(kind==='fares'){
        if(!quota||quota.until<Date.now()){
          const u=new URL('https://serpapi.com/account.json');u.searchParams.set('api_key',keys.serpKey);
          let r;try{r=await fetch(u,{signal:AbortSignal.timeout(10000)});}catch{throw new AppError('Die Flugsuche ist gerade nicht erreichbar. Bitte erneut versuchen.',503);}
          if(!r.ok)throw new AppError('Die Flugsuche ist vorübergehend nicht verfügbar.',503);
          const p=await r.json();if(!Number.isFinite(p.total_searches_left))throw new AppError('Die Flugsuche ist vorübergehend nicht verfügbar.',503);
          quota={left:p.total_searches_left,until:Date.now()+60000};
        }
        if(quota.left<=reserve)throw new AppError('Das verfügbare Suchkontingent ist ausgeschöpft. Bitte später erneut versuchen.',429);
        quota.left--;
      }
      ledger[kind]++;await writeFile(runtime+'usage.tmp',JSON.stringify(ledger),{mode:0o600});await rename(runtime+'usage.tmp',runtime+'usage.json');
    });queue=action.catch(()=>{});return action;
  }
  async function provider(params){
    if(!keys.serpKey)throw new AppError('Die Verbindung zu den Flugpreisen ist noch nicht eingerichtet.',503);
    const hash=createHash('sha256').update(JSON.stringify(params)).digest('hex');
    const path=runtime+'cache/'+hash+'.json';
    try{const c=JSON.parse(await readFile(path,'utf8'));if(c.expires>Date.now())return c.payload;}catch{}
    if(inflight.has(hash))return inflight.get(hash);
    const work=(async()=>{
      await reserveCall('fares');
      const u=new URL('https://serpapi.com/search.json');for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));u.searchParams.set('api_key',keys.serpKey);
      let r;try{r=await fetch(u,{signal:AbortSignal.timeout(55000)});}catch{throw new AppError('Die Preissuche dauert gerade zu lange. Bitte erneut versuchen.',504);}
      const p=await r.json().catch(()=>null);
      if(!r.ok)throw new AppError(r.status===429?'Die Flugsuche ist stark ausgelastet. Bitte in einer Minute erneut versuchen.':'Die Flugpreise sind gerade nicht erreichbar. Bitte erneut versuchen.',r.status===429?429:502);
      if(!p||p.error){if(typeof p?.error==='string'&&/no (?:flights|results)|hasn.t returned any results/i.test(p.error))return {...p,other_flights:[],error:undefined};throw new AppError('Für diese Anfrage konnten keine Flugpreise geladen werden. Bitte die Reisedaten prüfen.',502);}
      // Persist only the fields the application needs; no API key or provider debug URLs.
      const payload={search_metadata:{created_at:p.search_metadata?.created_at,google_flights_url:p.search_metadata?.google_flights_url},best_flights:p.best_flights,other_flights:p.other_flights,booking_options:p.booking_options,baggage_prices:p.baggage_prices,selected_flights:p.selected_flights};
      const tmp=path+'.'+randomBytes(4).toString('hex')+'.tmp';await writeFile(tmp,JSON.stringify({expires:Date.now()+5*60000,payload}),{mode:0o600});await rename(tmp,path);
      return payload;
    })();inflight.set(hash,work);try{return await work;}finally{inflight.delete(hash);}
  }
  async function interpret(text){
    if(typeof text!=='string'||text.trim().length<5||text.length>600)throw new AppError('Beschreibe die Reise mit 5 bis 600 Zeichen.');
    if(!keys.jevKey)throw new AppError('Die Texteingabe ist gerade nicht verfügbar. Bitte nutze die Reisedaten-Felder.',503,{useFields:true});
    const request=buildInterpretation(text.trim());const id=createHash('sha256').update(JSON.stringify(request.state)).digest('hex');
    const hit=interpretations.get(id);if(hit&&hit.expires>Date.now())return hit.value;
    await reserveCall('jev');const start=performance.now();
    let r;try{r=await fetch('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:'Bearer '+keys.jevKey,'Content-Type':'application/json'},body:JSON.stringify({model:'jev-1.13.0',...request}),signal:AbortSignal.timeout(22000)});}catch{throw new AppError('Die Texteingabe braucht zu lange. Bitte nutze die Reisedaten-Felder.',503,{useFields:true});}
    if(!r.ok)throw new AppError('Die Texteingabe ist gerade nicht verfügbar. Bitte nutze die Reisedaten-Felder.',503,{useFields:true});
    const data=await r.json();const value={...applyInterpretation(request,data.answers),interpretationMs:Math.round(performance.now()-start),model:data.model};
    if(interpretations.size>100)interpretations.delete(interpretations.keys().next().value);interpretations.set(id,{value,expires:Date.now()+10*60000});return value;
  }
  async function search(q){
    const start=performance.now(),params=searchParams(q),payload=await provider(params);
    const outward=normalizeFlights(payload,q);
    let options=outward.slice(0,30),partial=false,examined=outward.length;
    if(q.returnDate){
      // Complete the three cheapest outward candidates automatically, so cards show both legs.
      const candidates=outward.filter(f=>f.departureToken).slice(0,3);
      const results=await Promise.allSettled(candidates.map(async f=>{
        const p=await provider({...params,departure_token:f.departureToken});
        const returning=normalizeFlights(p,q,{returning:true})[0];
        if(!returning)return null;
        return {...f,id:f.id+'-'+returning.id,price:returning.price,returnFlight:returning,bookingToken:returning.bookingToken,departureToken:null,checkedAt:providerTimestamp(p)};
      }));
      partial=results.some(r=>r.status==='rejected');
      options=results.filter(r=>r.status==='fulfilled'&&r.value).map(r=>r.value).sort((a,b)=>a.price-b.price||a.duration+a.returnFlight.duration-b.duration-b.returnFlight.duration);
      if(candidates.length && !options.length && partial)throw results.find(r=>r.status==='rejected').reason;
      examined=candidates.length;
    }
    return {options,checkedAt:providerTimestamp(payload),searchUrl:googleLink(payload),found:outward.length,examined,partial,searchMs:Math.round(performance.now()-start)};
  }
  async function booking(q,flight){
    if(!flight.bookingToken)throw new AppError('Für diesen Flug ist kein Buchungsangebot verfügbar. Bitte öffne die Suche bei Google Flights.',404);
    const p=await provider({...searchParams(q),booking_token:flight.bookingToken});
    const offers=[];
    for(const row of p.booking_options||[]){
      // Separate tickets need more than one purchase; do not present their partial prices as totals.
      const o=row.together;if(!o||!Number.isFinite(o.price)||o.price<=0)continue;
      const req=o.booking_request;let url;
      try{url=new URL(req?.url);if(url.protocol!=='https:'||url.username||url.password)continue;}catch{continue;}
      let fields=[];
      if(typeof req?.post_data==='string'&&req.post_data){
        // Google hands off some fares using a POST token, not an ordinary link.
        if(url.hostname!=='www.google.com'||url.pathname!=='/travel/clk/f'||req.post_data.length>32000)continue;
        fields=[...new URLSearchParams(req.post_data)].map(([name,value])=>({name,value}));
        if(!fields.length||fields.length>8||fields.some(f=>!/^\w{1,40}$/.test(f.name)))continue;
      }
      offers.push({name:String(o.book_with||'Anbieter').slice(0,160),price:o.price,url:url.href,method:fields.length?'POST':'GET',fields,option:String(o.option_title||'').slice(0,180),baggage:Array.isArray(o.baggage_prices)?o.baggage_prices.filter(x=>typeof x==='string').slice(0,6):[],airline:!!o.airline});
    }
    return {offers:offers.sort((a,b)=>a.price-b.price).slice(0,6),checkedAt:providerTimestamp(p),searchUrl:googleLink(p)};
  }
  return {interpret,search,booking};
}
