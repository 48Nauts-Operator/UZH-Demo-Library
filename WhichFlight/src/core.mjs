import {createHash} from 'node:crypto';
import {airports, originChoices} from './airports.mjs';
export class AppError extends Error {constructor(message,status=400,details={}){super(message);this.status=status;this.details=details;}}
export function swissToday(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function addDays(date,n){return new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);}
export function validDate(s){return typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s+'T12:00:00Z')) && new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;}
export function validateQuery(input,today=swissToday()){
  if(!input || typeof input!=='object')throw new AppError('Bitte die Reisedaten prüfen.');
  const q={};
  for(const [field,choices] of [['origin',originChoices],['destination',airports]]){
    if(!choices.some(a=>a.id===input[field]))throw new AppError('Bitte einen Flughafen aus der Liste wählen.');q[field]=input[field];
  }
  if(q.origin.split(',').some(a=>q.destination.split(',').includes(a)))throw new AppError('Start und Ziel müssen verschieden sein.');
  q.outboundDate=input.outboundDate;q.returnDate=input.returnDate || null;
  if(!validDate(q.outboundDate)||q.outboundDate<today||q.outboundDate>addDays(today,330))throw new AppError('Bitte ein Abflugdatum innerhalb der nächsten 330 Tage wählen.');
  if(q.returnDate && (!validDate(q.returnDate)||q.returnDate<q.outboundDate||q.returnDate>addDays(today,330)))throw new AppError('Der Rückflug muss am oder nach dem Hinflug liegen, innerhalb der nächsten 330 Tage.');
  for(const [field,def,min,max] of [['adults',1,1,6],['children',0,0,6]]){q[field]=Number(input[field]??def);if(!Number.isInteger(q[field])||q[field]<min||q[field]>max)throw new AppError('Bitte die Anzahl Reisender prüfen (maximal 6).');}
  if(q.adults+q.children>6)throw new AppError('Die Suche unterstützt bis zu 6 Reisende.');
  q.baggage=input.baggage||'personal';if(!['personal','carry','checked'].includes(q.baggage))throw new AppError('Bitte das Gepäck prüfen.');
  q.nonstop=input.nonstop===true;
  for(const field of ['departAfter','arriveBefore','returnAfter','returnBefore']){q[field]=input[field] || null;if(q[field] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(q[field]))throw new AppError('Bitte die Uhrzeit prüfen.');}
  q.maxPrice=input.maxPrice==null||input.maxPrice===''?null:Number(input.maxPrice);
  if(q.maxPrice!==null && (!Number.isFinite(q.maxPrice)||q.maxPrice<1||q.maxPrice>100000))throw new AppError('Bitte das Budget in CHF prüfen.');
  return q;
}
export function searchParams(q){
  const p={engine:'google_flights',departure_id:q.origin,arrival_id:q.destination,outbound_date:q.outboundDate,type:q.returnDate?'1':'2',currency:'CHF',hl:'en',gl:'ch',adults:String(q.adults),children:String(q.children),sort_by:'2',show_hidden:'true'};
  if(q.returnDate)p.return_date=q.returnDate;
  if(q.nonstop)p.stops='1';
  if(q.baggage==='carry')p.bags=String(q.adults+q.children);
  if(q.maxPrice!==null)p.max_price=String(Math.ceil(q.maxPrice));
  // Provider bounds cover whole hours; exact limits are applied again to the returned flights.
  const times=(after,before)=>`${after?Number(after.slice(0,2)):0},23,0,${before?Number(before.slice(0,2)):23}`;
  if(q.departAfter||q.arriveBefore)p.outbound_times=times(q.departAfter,q.arriveBefore);
  if(q.returnDate&&(q.returnAfter||q.returnBefore))p.return_times=times(q.returnAfter,q.returnBefore);
  return p;
}
function safeText(v,max=180){return typeof v==='string'?v.slice(0,max):'';}
function validStamp(v){return typeof v==='string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v) && validDate(v.slice(0,10));}
export function normalizeFlights(payload,q,{returning=false}={}){
  const seen=new Set();const list=[...(Array.isArray(payload.best_flights)?payload.best_flights:[]),...(Array.isArray(payload.other_flights)?payload.other_flights:[])].sort((a,b)=>(a.price??Infinity)-(b.price??Infinity));
  const results=[];
  for(const f of list){
    if(!Array.isArray(f.flights)||!f.flights.length||!Number.isFinite(f.price)||f.price<=0||!Number.isFinite(f.total_duration))continue;
    const segments=f.flights.map(s=>({from:safeText(s.departure_airport?.id,3),to:safeText(s.arrival_airport?.id,3),departure:safeText(s.departure_airport?.time,16),arrival:safeText(s.arrival_airport?.time,16),airline:safeText(s.airline),number:safeText(s.flight_number,20),duration:s.duration,extensions:(s.extensions||[]).filter(v=>typeof v==='string').slice(0,8)}));
    if(segments.some(s=>!validStamp(s.departure)||!validStamp(s.arrival)||!/^\w{3}$/.test(s.from)||!/^\w{3}$/.test(s.to)))continue;
    const first=segments[0],last=segments.at(-1),day=returning?q.returnDate:q.outboundDate;
    if(first.departure.slice(0,10)!==day)continue;
    if(!(returning?q.destination:q.origin).split(',').includes(first.from)||!(returning?q.origin:q.destination).split(',').includes(last.to))continue;
    const after=returning?q.returnAfter:q.departAfter,before=returning?q.returnBefore:q.arriveBefore;
    if(after && first.departure.slice(11)<after)continue;
    if(before && (last.arrival.slice(0,10)!==day||last.arrival.slice(11)>before))continue;
    if(q.nonstop&&segments.length>1)continue;
    if(q.maxPrice!==null&&f.price>q.maxPrice)continue;
    const signature=segments.map(s=>[s.number,s.from,s.to,s.departure].join('|')).join('/');
    if(seen.has(signature))continue;seen.add(signature);
    results.push({id:createHash('sha256').update(signature).digest('hex').slice(0,16),price:f.price,segments,departure:first.departure,arrival:last.arrival,from:first.from,to:last.to,duration:f.total_duration,stops:segments.length-1,airlines:[...new Set(segments.map(s=>s.airline))],layovers:(f.layovers||[]).map(l=>({id:safeText(l.id),name:safeText(l.name),duration:l.duration,overnight:!!l.overnight})),bookingToken:safeText(f.booking_token,12000)||null,departureToken:safeText(f.departure_token,12000)||null});
  }
  return results.sort((a,b)=>a.price-b.price||a.duration-b.duration||a.departure.localeCompare(b.departure));
}
export function providerTimestamp(payload){const t=payload?.search_metadata?.created_at;const d=typeof t==='string'?new Date(t.replace(' UTC','Z').replace(' ','T')):new Date();return Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString();}
export function googleLink(payload){try{const u=new URL(payload?.search_metadata?.google_flights_url);return u.protocol==='https:'&&u.hostname==='www.google.com'&&u.pathname.startsWith('/travel/flights')?u.href:null;}catch{return null;}}
export function publicFlight(f){const {bookingToken,departureToken,...rest}=f;return rest;}
