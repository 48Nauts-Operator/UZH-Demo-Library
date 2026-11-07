const $=id=>document.getElementById(id);
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('de-CH',{maximumFractionDigits:2}).format(v);
const dateLabel=(d,long=false)=>new Intl.DateTimeFormat('de-CH',{weekday:long?'long':'short',day:'numeric',month:long?'long':'short',year:long?'numeric':undefined,timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'));
const duration=m=>`${Math.floor(m/60)} Std.${m%60?' '+m%60+' Min.':''}`;
let catalogue=[],origins=[],result=null,version=0,controller=null,expanded=false,loading=false,progressTimer;
const fieldNames=['origin','destination','outboundDate','returnDate','adults','children','baggage','maxPrice','departAfter','arriveBefore','returnAfter','returnBefore'];
const airportName=id=>origins.find(a=>a.id===id)?.name||catalogue.find(a=>a.id===id)?.name||id;
function setStatus(message,error=false,busy=false){$('status').hidden=!message;$('status').className=error?'error':'';$('status').innerHTML=(busy?'<span class="spinner" aria-hidden="true"></span>':'')+'<span>'+escapeHtml(message)+'</span>';}
function setLoading(busy){loading=busy;for(const id of ['search-button','fields-button'])$(id).disabled=busy;$('search-button').querySelector('span').textContent=busy?'Flugpreise werden gesucht …':'Günstige Flüge finden';$('search-form').setAttribute('aria-busy',String(busy));}
function clearResults(){version++;controller?.abort();clearTimeout(progressTimer);result=null;expanded=false;$('results').hidden=true;$('cards').innerHTML='';$('explanation').hidden=false;setLoading(false);setStatus('');}
function showFields(show=true){$('fields').hidden=!show;$('fields-toggle').setAttribute('aria-expanded',String(show));$('fields-toggle').innerHTML=show?'Reisedaten schliessen <span aria-hidden="true">−</span>':'Reisedaten eingeben <span aria-hidden="true">＋</span>';}
function fillFields(q){for(const name of fieldNames)$(name).value=q[name]??'';$('nonstop').checked=$('search-nonstop').checked=q.nonstop;$('returnDate').min=q.outboundDate;}
function readFields(){const q=Object.fromEntries(fieldNames.map(name=>[name,$(name).value]));q.nonstop=$('nonstop').checked;return q;}
async function request(path,payload,signal){
  let response;try{response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal});}catch(e){if(e.name==='AbortError')throw e;throw new Error('Die Verbindung wurde unterbrochen. Bitte erneut versuchen.');}
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{throw new Error('Die Flugsuche ist gerade nicht erreichbar. Bitte erneut versuchen.');}
  if(!response.ok){const e=new Error(data.error||'Die Suche ist gerade nicht verfügbar.');e.useFields=data.useFields;throw e;}return data;
}
async function search(payload){
  clearResults();const current=version;controller=new AbortController();const signal=controller.signal;setLoading(true);setStatus(payload.text?'Jev liest deine Reise. Danach suchen wir passende Flugpreise.':'Wir suchen passende Flugpreise.',false,true);
  progressTimer=setTimeout(()=>{if(version===current)setStatus('Wir vergleichen Flugpreise und prüfen passende Verbindungen …',false,true);},1800);
  const timeout=setTimeout(()=>{if(version===current){controller.abort();setStatus('Die Suche dauert zu lange. Bitte erneut versuchen.',true);setLoading(false);}},100000);
  try{
    const data=await request('/api/search',payload,signal);if(current!==version)return;
    result=data;fillFields(data.query);render();setStatus('');$('results').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  }catch(e){if(current!==version||e.name==='AbortError')return;setStatus(e.message,true);if(e.useFields)showFields(true);}
  finally{clearTimeout(timeout);if(current===version){clearTimeout(progressTimer);setLoading(false);}}
}
function legHtml(f,label){
  const days=Math.round((Date.parse(f.arrival.slice(0,10)+'T12:00:00Z')-Date.parse(f.departure.slice(0,10)+'T12:00:00Z'))/86400000);
  const stop=f.stops===0?'Direkt':f.stops===1?'1 Umstieg':`${f.stops} Umstiege`;
  return `<div class="leg"><div><div class="leg-date">${escapeHtml(label)} · ${escapeHtml(new Intl.DateTimeFormat('de-CH',{day:'2-digit',month:'2-digit',timeZone:'UTC'}).format(new Date(f.departure.slice(0,10)+'T12:00:00Z')))}</div><div class="time">${escapeHtml(f.departure.slice(11))}</div><div class="airport">${escapeHtml(f.from)}</div></div><div class="route-line">${escapeHtml(duration(f.duration))}<span class="route-track"><b aria-hidden="true">${f.stops?'·':'›'}</b></span>${escapeHtml(stop)}</div><div class="leg-end"><div class="leg-date">${days?escapeHtml(dateLabel(f.arrival.slice(0,10))):'&nbsp;'}</div><div class="time">${escapeHtml(f.arrival.slice(11))}${days?`<sup>+${days}</sup>`:''}</div><div class="airport">${escapeHtml(f.to)}</div></div></div>`;
}
function detailsHtml(f){return [f,...(f.returnFlight?[f.returnFlight]:[])].map((leg,i)=>`<h4>${i?'Rückflug':'Hinflug'} · ${escapeHtml(dateLabel(leg.departure.slice(0,10),true))}</h4>`+leg.segments.map((s,j)=>`<div class="segment"><strong>${escapeHtml(s.departure.slice(11))} ${escapeHtml(s.from)} → ${escapeHtml(s.arrival.slice(11))} ${escapeHtml(s.to)}</strong><br>${escapeHtml(s.airline)} · ${escapeHtml(s.number)} · ${escapeHtml(duration(s.duration))}</div>${leg.layovers[j]?`<div class="layover">Umstieg in ${escapeHtml(leg.layovers[j].name)} · ${escapeHtml(duration(leg.layovers[j].duration))}${leg.layovers[j].overnight?' · über Nacht':''}</div>`:''}`).join('')).join('');}
function baggageText(q){if(q.baggage==='checked')return 'Aufgabegepäck: Kosten noch offen';if(q.baggage==='carry')return 'Mit Handgepäck-Filter gesucht · Regeln beim Anbieter prüfen';return 'Gepäckumfang beim Anbieter prüfen';}
function priceRoute(f,label=''){const time=`${Math.floor(f.duration/60)}h${f.duration%60?' '+f.duration%60+'m':''}`;const stops=f.stops===0?'Direkt':f.stops===1?'1 Stopp':f.stops+' Stopps';return `<div class="price-route${f.duration>=1440?' long-trip':''}">${escapeHtml(label+time+' · '+stops)}</div>`;}
function cardHtml(f,i){
  const q=result.query,total=q.adults+q.children,airlines=[...new Set([...f.airlines,...(f.returnFlight?.airlines||[])])];
  const caption=`${q.returnDate?'Hin & zurück':'Einfach'} · ${total===1?'1 Person':total+' Personen'} gesamt`;
  return `<article class="flight-card${i===0?' best':''}" data-flight="${escapeHtml(f.id)}">${i===0?`<div class="best-banner"><span>↗ ${q.baggage==='checked'?'Niedrigster Flugpreis · Gepäck noch offen':'Günstigster gefundener Flug'}</span><span>${q.returnDate?'UNTER DEN GEPRÜFTEN KOMBINATIONEN':'PREIS ZUERST'}</span></div>`:''}<div class="card-main"><div class="airline-info"><div class="airline-symbol" aria-hidden="true">↗</div><div class="airline-name">${escapeHtml(airlines.join(' / '))}</div><div class="airline-detail">Economy<br>${escapeHtml(f.segments.map(s=>s.number).join(' · '))}</div></div><div class="legs">${legHtml(f,q.returnDate?'Hin':'Abflug')}${f.returnFlight?legHtml(f.returnFlight,'Zurück'):''}</div><div class="price-section"><div class="price"><small>CHF</small>${money(f.price)}</div><div class="price-routes">${priceRoute(f,q.returnDate?'Hin: ':'')}${f.returnFlight?priceRoute(f.returnFlight,'Zurück: '):''}</div><div class="price-caption">${escapeHtml(caption)}</div><button class="book-button" data-book="${escapeHtml(f.id)}">Angebot prüfen ↗</button></div></div><div class="card-bottom"><span class="${q.baggage==='checked'?'baggage-unknown':''}">${escapeHtml(baggageText(q))}</span><button class="text-button" data-details="${escapeHtml(f.id)}" aria-expanded="false">Flugdetails ↓</button></div><div class="flight-details" id="details-${escapeHtml(f.id)}" hidden>${detailsHtml(f)}</div><div class="booking-options" id="booking-${escapeHtml(f.id)}" aria-live="polite" hidden></div></article>`;
}
function renderCards(){const visible=expanded?result.options:result.options.slice(0,3);$('cards').innerHTML=visible.map(cardHtml).join('');$('more-results').hidden=expanded||result.options.length<=3;$('more-results').textContent=`${result.options.length-3} weitere Flüge anzeigen`;}
function render(){
  const q=result.query;$('results').hidden=false;$('explanation').hidden=true;
  $('route-title').textContent=airportName(q.origin)+' → '+airportName(q.destination);
  $('route-detail').textContent=dateLabel(q.outboundDate,true)+(q.returnDate?' – '+dateLabel(q.returnDate,true):'')+` · ${q.adults} ${q.adults===1?'Erwachsene Person':'Erwachsene'}`+(q.children?` · ${q.children} ${q.children===1?'Kind':'Kinder'}`:'');
  const chips=[q.origin+' → '+q.destination,q.returnDate?'Hin & zurück':'Einfach','Economy',q.nonstop?'Nur Direktflüge':'Umsteigen möglich'];
  if(q.baggage==='carry')chips.push('Handgepäck-Filter');if(q.baggage==='checked')chips.push('Aufgabegepäck nötig');
  if(q.departAfter)chips.push('Hin: ab '+q.departAfter);if(q.arriveBefore)chips.push('Hin: an bis '+q.arriveBefore);if(q.returnAfter)chips.push('Zurück: ab '+q.returnAfter);if(q.returnBefore)chips.push('Zurück: an bis '+q.returnBefore);if(q.maxPrice)chips.push('Bis CHF '+money(q.maxPrice));
  $('criteria').innerHTML=chips.map(c=>'<span>'+escapeHtml(c)+'</span>').join('');
  const notes=[...(result.notes||[])];if(q.baggage==='checked')notes.push('Aufgabegepäck ist noch nicht verlässlich eingepreist. Die Reihenfolge vergleicht Flugpreise; der Gesamtpreis inklusive Koffer kann anders ausfallen.');if(result.partial)notes.push('Ein Teil der Rückflugpreise konnte nicht geladen werden. Hier siehst du die vollständig geprüften Optionen.');
  $('result-notices').innerHTML=notes.map(n=>'<p class="notice">'+escapeHtml(n)+'</p>').join('');
  const stamp=new Intl.DateTimeFormat('de-CH',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Zurich'}).format(new Date(result.checkedAt));
  $('result-meta').innerHTML=`<span>${q.returnDate?`Rückflüge zu ${result.examined} der günstigsten Hinflug-Optionen geprüft`:`${result.found} passende Verbindungen gefunden · nach Preis sortiert`}</span><span>Preisstand ${escapeHtml(stamp)} · Google Flights via SerpApi</span>`;
  renderCards();if(!result.options.length)$('cards').innerHTML='<div class="empty"><h3>Für diese Suche haben wir keinen passenden Flug gefunden.</h3><p>Ändere Datum, Budget oder Zeitfenster. Deine Suchdaten bleiben oben erhalten.</p></div>';
  $('source-link').hidden=!result.searchUrl;if(result.searchUrl)$('source-link').href=result.searchUrl;
}
async function book(id,button){
  if(!result)return;const current=version,searchId=result.id,box=$('booking-'+id);box.hidden=false;button.disabled=true;box.textContent='Aktuelle Buchungsangebote werden geladen …';
  try{
    const data=await request('/api/booking',{id:searchId,flightId:id},AbortSignal.timeout(60000));if(current!==version)return;
    const fallback=data.searchUrl||result.searchUrl;
    const fallbackLink=fallback?`<a class="booking-fallback" href="${escapeHtml(fallback)}" target="_blank" rel="noopener noreferrer">Auswahl bei Google Flights öffnen ↗</a>`:'';
    box.innerHTML='<h4>Aktuelle Buchungsangebote für diese Verbindung</h4>'+(data.offers.length?data.offers.map(o=>{
      const content=`<span>${escapeHtml(o.name)}${o.option?'<span class="offer-sub">'+escapeHtml(o.option)+'</span>':''}${o.baggage.length?'<span class="offer-sub">'+escapeHtml(o.baggage.join(' · '))+'</span>':''}</span><strong>CHF ${money(o.price)} ↗</strong>`;
      return o.method==='POST'?`<form action="${escapeHtml(o.url)}" method="post" target="_blank" rel="noopener noreferrer">${o.fields.map(f=>`<input type="hidden" name="${escapeHtml(f.name)}" value="${escapeHtml(f.value)}">`).join('')}<button class="offer" type="submit">${content}</button></form>`:`<a class="offer" href="${escapeHtml(o.url)}" target="_blank" rel="noopener noreferrer">${content}</a>`;
    }).join(''):'<p>Die Buchungsoptionen für diese Verbindung findest du bei Google Flights.</p>')+fallbackLink+'<p class="offer-sub">Buchungsangebote können vom Suchpreis abweichen. Endpreis und Gepäckbedingungen beim Anbieter bestätigen.</p>';
  }catch(e){if(current!==version)return;box.textContent=e.name==='TimeoutError'?'Die Buchungsangebote brauchen zu lange. Bitte erneut versuchen.':e.message;if(result.searchUrl){const a=document.createElement('a');a.className='booking-fallback';a.href=result.searchUrl;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Suche bei Google Flights öffnen ↗';box.append(document.createElement('br'),a);}}
  finally{if(current===version)button.disabled=false;}
}
function searchText(text){return search({text,nonstop:$('search-nonstop').checked});}
$('search-form').addEventListener('submit',e=>{e.preventDefault();searchText($('request').value);});
$('fields').addEventListener('submit',e=>{e.preventDefault();search({query:readFields()});});
for(const [id,other] of [['search-nonstop','nonstop'],['nonstop','search-nonstop']])$(id).addEventListener('input',()=>{$(other).checked=$(id).checked;if(result||loading)clearResults();});
$('request').addEventListener('input',()=>{if(result||loading)clearResults();});
for(const el of $('fields').querySelectorAll('input,select'))el.addEventListener('input',()=>{if(result||loading)clearResults();if(el.id==='outboundDate')$('returnDate').min=el.value;});
$('fields-toggle').addEventListener('click',()=>showFields($('fields').hidden));
$('edit-search').addEventListener('click',()=>{showFields(true);$('fields').scrollIntoView({behavior:'smooth',block:'center'});});
document.querySelectorAll('[data-example]').forEach(b=>b.addEventListener('click',()=>{$('request').value=b.dataset.example;searchText(b.dataset.example);}));
$('more-results').addEventListener('click',()=>{expanded=true;renderCards();});
$('cards').addEventListener('click',e=>{const bookButton=e.target.closest('[data-book]');if(bookButton)book(bookButton.dataset.book,bookButton);const details=e.target.closest('[data-details]');if(details){const box=$('details-'+details.dataset.details);box.hidden=!box.hidden;details.setAttribute('aria-expanded',String(!box.hidden));details.textContent=box.hidden?'Flugdetails ↓':'Flugdetails ↑';}});
for(const id of ['about-open','privacy-open'])$(id).addEventListener('click',()=>$('about').showModal());$('about-close').addEventListener('click',()=>$('about').close());$('about').addEventListener('click',e=>{if(e.target===$('about')){const r=$('about').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('about').close();}});
async function init(){
  try{const r=await fetch('/api/airports');if(!r.ok)throw new Error();const data=await r.json();catalogue=data.airports;origins=data.origins;
    for(const [id,items] of [['origin',origins],['destination',catalogue]])$(id).innerHTML=items.map(a=>`<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} · ${escapeHtml(a.id)}</option>`).join('');
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const next=new Date(today+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+((4-next.getUTCDay()+7)%7||7));
    fillFields({origin:'ZRH',destination:'FRA',outboundDate:next.toISOString().slice(0,10),adults:1,children:0,baggage:'personal',nonstop:false});$('outboundDate').min=today;
  }catch{setStatus('Die Reisedaten konnten nicht geladen werden. Bitte die Seite neu laden.',true);}
}
init();
