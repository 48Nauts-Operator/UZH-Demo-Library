import {sbbSearchUrl, sbbJourneyUrl} from './sbb-links.js';
const $ = id => document.getElementById(id);
const state = {search: null, ranked: null, searchVersion: 0, rankVersion: 0, fareVersion:0, fares:null, fareLoading:false, ranking: false, selected: null};
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock = value => new Intl.DateTimeFormat('de-CH',{timeZone:'Europe/Zurich',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const swissDate = value => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
const duration = n => n >= 60 ? `${Math.floor(n/60)} Std. ${n%60 ? n%60+' Min.':''}`.trim() : `${n} Min.`;
const tomorrow = new Date(Date.now()+86400000);
$('date').value = swissDate(tomorrow); $('date').min = swissDate(new Date());
$('date').max = swissDate(new Date(Date.now()+179*86400000));

async function api(path, data) {
  const response = await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(35000)});
  const result = await response.json(); if(!response.ok) throw new Error(result.error || 'Bitte erneut versuchen.'); return result;
}
function message(id,text,error=false) { $(id).textContent=text; $(id).classList.toggle('error',error); }
function setRanking(value) {
  state.ranking=value; $('rank-button').disabled=value;
  $('rank-button').innerHTML=value ? 'Jev vergleicht <span class="loading-spark" aria-hidden="true">✳</span>' : 'Für mich sortieren <span aria-hidden="true">✳</span>';
  $('personal-results').setAttribute('aria-busy',String(value));
}
function personalPlaceholder() {
  $('personal-results').innerHTML='<div class="empty-personal"><span class="large-spark" aria-hidden="true">✳</span><h4>Deine Reise ist persönlich.<br>Dein Fahrplan jetzt auch.</h4><p>Ergänze oben deine Wünsche.<br>Jev vergleicht die Verbindungen für dich.</p><span class="empty-arrow" aria-hidden="true">↑</span></div>';
  $('personal-description').textContent='Hier macht dein Kontext den Unterschied.';
  alignRows();
}
function evidence(j) {
  return ({duration:`${duration(j.durationMinutes)} unterwegs`,changes:j.transfers ? `${j.transfers} Umstiege auf dieser Reise`:'Direkt ans Ziel, ohne Umstieg',
    departure:`Abfahrt um ${clock(j.departure)}`,arrival:`Ankunft um ${clock(j.arrival)}`,work:`${j.longestTrainMinutes} Min. am Stück im Zug`,
    transfer:`${j.minTransferMinutes} Min. für den kürzesten Umstieg`,walk:`${j.walkingMinutes} Min. erfasste Fusswege`,none:'Keine passende Angabe im Fahrplan'})[j.reason];
}
function sbbUrl(j) {
  return sbbJourneyUrl(j, $('reduction').value);
}
function updateFareLinks() {
  if(!state.search)return;
  const first=state.search.journeys[0], query=state.search.query;
  $('sbb-search-link').href=sbbSearchUrl({...first,day:query.date,time:query.time,mode:query.mode,reduction:$('reduction').value});
  document.querySelectorAll('.journey .sbb-link').forEach(link=>{
    const j=state.search.journeys.find(j=>j.id===link.closest('.journey').dataset.journey);
    if(j)link.href=sbbUrl(j);
  });
}
const francs=value=>new Intl.NumberFormat('de-CH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
function priceContent(j) {
  const fare=state.fares?.fares.find(f=>f.journeyId===j.id);
  if(!fare)return `<span class="price-pending">${state.fareLoading?'SBB-Preis wird geladen …':'Kein bestätigter SBB-Preis'}</span>`;
  const cheapest=state.fares.fares.length>1 && state.fares.fares.some(f=>f.amountCHF>fare.amountCHF) && fare.amountCHF===Math.min(...state.fares.fares.map(f=>f.amountCHF));
  return `<a class="price-value" href="${escape(fare.sourceUrl)}" target="_blank" rel="noreferrer"><small>ab</small> CHF ${francs(fare.amountCHF)} <span aria-hidden="true">↗</span></a><span class="price-caption">${cheapest?'<strong>Günstigster angezeigter Preis</strong>':fare.supersaver?'Sparbillett':'SBB-Abpreis'}${cheapest&&fare.supersaver?' · Sparbillett':''}</span>`;
}
function refreshFareCards() {
  document.querySelectorAll('.journey-price').forEach(el=>{
    const j=state.search?.journeys.find(j=>j.id===el.closest('.journey').dataset.journey);
    if(j)el.innerHTML=priceContent(j);
  });alignRows();
}
async function loadFares() {
  const version=++state.fareVersion,id=state.search?.id,reduction=$('reduction').value;
  state.fares=null;state.fareLoading=!!id;refreshFareCards();if(!id)return;
  message('fare-status','SBB-Preise werden für diese Verbindungen geladen …');
  const current=()=>version===state.fareVersion && id===state.search?.id;
  try {
    for(let attempt=0;attempt<60;attempt++) {
      if(!current())return;
      const result=await api('/api/fares',{id,reduction});if(!current())return;
      if(result.status==='error')throw new Error(result.error);
      if(result.status==='ready') {
        state.fares=result;state.fareLoading=false;refreshFareCards();
        message('fare-status',result.fares.length ? `SBB-Preisstand ${clock(result.checkedAt)} Uhr · ${result.fares.length} von ${result.total} Verbindungen · ${reduction==='half-fare'?'mit Halbtax':'ohne Ermässigung'}. Ab-Preise können sich ändern; Sparbillette sind zuggebunden.` : 'SBB-Preise konnten diesen Verbindungen nicht eindeutig zugeordnet werden. Bitte direkt bei SBB prüfen.');
        return;
      }
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
    throw new Error('Die SBB-Preisabfrage dauert gerade länger. Bitte direkt bei SBB prüfen.');
  }catch(e){if(current()){state.fareLoading=false;refreshFareCards();message('fare-status',e.message,true);}}
}
$('reduction').addEventListener('change',()=>{updateFareLinks();loadFares();});
function card(j,index,personal=false) {
  const moved=j.originalRank-(index+1), best=personal && index===0 && j.status==='fits' && j.fit>=2.5;
  const status=j.status==='unknown' ? 'Angaben fehlen' : j.status==='conflict' ? 'Passt nicht zu allen Vorgaben' : best ? 'Beste Wahl für dich' : 'Passt zu deinen Wünschen';
  const movedText=moved>0 ? `↑ ${moved} ${moved===1?'Platz':'Plätze'} nach vorn` : moved<0 ? `↓ ${-moved} ${moved===-1?'Platz':'Plätze'}` : '↔ Gleicher Platz';
  const lines=[...new Set(j.sections.map(s=>s.line))];
  const dayChange=swissDate(new Date(j.departure))!==swissDate(new Date(j.arrival));
  return `<article class="journey ${best?'best':''} ${personal?escape(j.status):''} ${personal?'result-enter':''}" data-journey="${escape(j.id)}" data-side="${personal?'personal':'original'}" tabindex="0" aria-label="Verbindung ${j.originalRank}: ${clock(j.departure)} bis ${clock(j.arrival)}">
    ${best?'<div class="best-banner"><span aria-hidden="true">★</span> Beste Wahl für dich <span class="best-by">Jev empfiehlt</span></div>':''}
    <div class="journey-meta">${personal?`<span class="match-tag ${escape(j.status)}">${status}</span><span class="movement ${moved<0?'down':moved===0?'same':''}">${movedText}</span>`:`<span class="order-label">VERBINDUNG ${String(j.originalRank).padStart(2,'0')}</span><span class="order-label">${j.forecastAvailable?'Mit Prognose':'Fahrplan'}</span>`}</div>
    <div class="journey-times"><div class="time"><strong>${clock(j.departure)}</strong><small>${escape(j.from)}</small></div><div class="track"><span class="duration">${duration(j.durationMinutes)}</span><div class="track-line" aria-hidden="true"><i></i>${'<i></i>'.repeat(Math.min(j.transfers,4))}<i></i></div><span class="track-caption">${j.transfers?`${j.transfers} ${j.transfers===1?'Umstieg':'Umstiege'}`:'Direktverbindung'}</span></div><div class="time"><strong>${clock(j.arrival)}</strong><small>${escape(j.to)}${dayChange?' · +1 Tag':''}</small></div></div>
    <div class="journey-bottom"><div class="line-badges">${lines.map(l=>`<span class="line-badge">${escape(l)}</span>`).join('')}</div><button type="button" class="details-toggle" aria-expanded="false">Verlauf ansehen ↓</button></div>
    <div class="journey-price">${priceContent(j)}</div>
    ${personal?`<div class="fact-row"><span class="fact-text">${j.status==='conflict'?'!':'↳'} ${escape(evidence(j))}</span><span class="fit-value" title="Jevs Einschätzung auf einer Skala von 0 bis 4. Keine Wahrscheinlichkeit.">Passung ${j.fit.toFixed(1)} / 4</span></div>${j.status==='unknown'?'<p class="unknown-note">Ein wichtiger Wunsch lässt sich mit diesen Daten nicht prüfen.</p>':''}${j.status==='conflict'?'<p class="unknown-note">Mindestens eine ausdrückliche Vorgabe wird laut Bewertung nicht erfüllt.</p>':''}`:''}
    <div class="journey-details" hidden>${j.sections.map(s=>`<div class="leg"><span class="leg-line">${escape(s.line)}</span><div><strong>${s.departure?clock(s.departure):'–'} ${escape(s.from)}</strong><small>${s.platform?'Gleis '+escape(s.platform)+' · ':''}${s.minutes===null?'Dauer unbekannt':duration(s.minutes)}</small><strong>${s.arrival?clock(s.arrival):'–'} ${escape(s.to)}</strong>${s.arrivalPlatform?`<small>Gleis ${escape(s.arrivalPlatform)}</small>`:''}</div></div>`).join('')}<a class="sbb-link" href="${escape(sbbUrl(j))}" target="_blank" rel="noreferrer">Bei SBB prüfen & Billette suchen ↗</a></div>
  </article>`;
}

function alignRows() {
  requestAnimationFrame(()=>{
    const left=[...document.querySelectorAll('#original-results .journey')],right=[...document.querySelectorAll('#personal-results .journey')];
    for(const card of [...left,...right])card.style.minHeight='';
    for(let i=0;i<Math.min(left.length,right.length);i++){
      const height=Math.ceil(Math.max(left[i].getBoundingClientRect().height,right[i].getBoundingClientRect().height));
      left[i].style.minHeight=right[i].style.minHeight=height+'px';
    }
  });
}
window.addEventListener('resize',alignRows);
function renderOriginal() { $('original-results').innerHTML=state.search.journeys.map((j,i)=>card(j,i)).join('');alignRows(); }
function renderRanked() { $('personal-results').innerHTML=state.ranked.journeys.map((j,i)=>card(j,i,true)).join('');alignRows(); }

$('search-form').addEventListener('submit',async event=>{
  event.preventDefault(); const version=++state.searchVersion; ++state.rankVersion; setRanking(false);
  ++state.fareVersion;state.fares=null;state.fareLoading=false;
  state.search=null;state.ranked=null; $('workspace').hidden=true; $('welcome').hidden=true;
  $('search-button').disabled=true; $('search-button').textContent='Fahrplan wird geladen …';
  message('search-status','Wir suchen echte Verbindungen für deine Reise.'); message('rank-status','');
  const query=Object.fromEntries(new FormData(event.target));
  try {
    const data=await api('/api/journeys',query); if(version!==state.searchVersion)return;
    if(!data.journeys.length){message('search-status','Keine Verbindung gefunden. Versuche eine andere Zeit oder prüfe die Haltestellen.');$('welcome').hidden=false;return;}
    state.search={...data,query};$('workspace').hidden=false; personalPlaceholder();renderOriginal();
    updateFareLinks();
    loadFares();
    $('route-title').textContent=`${data.journeys[0].from} → ${data.journeys[0].to}`;
    $('route-subtitle').textContent=`${new Intl.DateTimeFormat('de-CH',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Zurich'}).format(new Date(query.date+'T12:00:00Z'))} · ${data.journeys.length} Verbindungen · ${query.mode==='arrival'?'Ankunft bis':'Abfahrt ab'} ${query.time}`;
    $('data-note').textContent=`Fahrplandaten abgerufen um ${clock(data.fetchedAt)} Uhr. Angezeigte Zeiten berücksichtigen verfügbare Prognosen. Umsteigezeiten sind keine Anschlussgarantie. Für aktuelle Angaben und Preise bitte bei SBB prüfen.`;
    $('rank-button').disabled=!data.jevAvailable;
    message('search-status',''); if(!data.jevAvailable)message('rank-status','Die persönliche Sortierung ist gerade nicht verfügbar. Du kannst die Verbindungen trotzdem ansehen.',true);
    $('workspace').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){if(version===state.searchVersion){message('search-status',e.name==='TimeoutError'?'Die Fahrplansuche dauert gerade zu lange. Bitte erneut versuchen.':e.message,true);$('welcome').hidden=false;}}
  finally{if(version===state.searchVersion){$('search-button').disabled=false;$('search-button').innerHTML='Verbindungen zeigen <span aria-hidden="true">↗</span>';}}
});

$('rank-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!state.search || state.ranking)return;
  const preferences=$('preferences').value.trim();if(preferences.length<5){$('preferences').reportValidity();return;}
  const version=++state.rankVersion, id=state.search.id;setRanking(true);
  message('rank-status','Jev vergleicht jede Verbindung mit deinen Wünschen …');
  try{
    const data=await api('/api/rank',{id,preferences});if(version!==state.rankVersion || id!==state.search?.id)return;
    state.ranked={...data,preferences};renderRanked();
    const changes=data.journeys.filter((j,i)=>j.originalRank!==i+1).length;
    const supported=data.journeys.some(j=>j.status==='fits');
    const summary=!supported?'Keine Verbindung erfüllt alle Wünsche nachweisbar.':changes?`${changes} Verbindungen haben einen neuen Platz.`:'Diese Reihenfolge passt bereits zu deinen Wünschen.';
    $('personal-description').textContent=summary;
    message('rank-status',`${summary} ${data.cached?'Bewertung wiederverwendet.':`Bewertet in ${(data.latencyMs/1000).toFixed(1)} Sekunden.`}`);
  }catch(e){if(version===state.rankVersion)message('rank-status',e.name==='TimeoutError'?'Jev braucht gerade zu lange. Bitte erneut versuchen.':e.message,true);}
  finally{if(version===state.rankVersion)setRanking(false);}
});

$('preferences').addEventListener('input',()=>{
  if(state.ranked || state.ranking){++state.rankVersion;state.ranked=null;setRanking(false);personalPlaceholder();message('rank-status','Wünsche geändert. Klicke auf «Für mich sortieren», um neu zu vergleichen.');}
  document.querySelectorAll('[data-preference]').forEach(b=>b.classList.toggle('active',b.dataset.preference===$('preferences').value));
});
document.querySelectorAll('[data-preference]').forEach(button=>button.addEventListener('click',()=>{
  $('preferences').value=button.dataset.preference;$('preferences').dispatchEvent(new Event('input'));$('rank-form').requestSubmit();
}));
document.querySelectorAll('[data-route]').forEach(button=>button.addEventListener('click',()=>{
  const [from,to]=button.dataset.route.split('|');$('from').value=from;$('to').value=to;$('search-form').requestSubmit();
}));
$('swap').addEventListener('click',()=>{const from=$('from').value;$('from').value=$('to').value;$('to').value=from;});
document.querySelector('.compare-grid').addEventListener('click',event=>{
  const button=event.target.closest('.details-toggle');if(!button)return;
  const details=button.closest('.journey').querySelector('.journey-details');details.hidden=!details.hidden;button.setAttribute('aria-expanded',String(!details.hidden));button.textContent=details.hidden?'Verlauf ansehen ↓':'Verlauf schliessen ↑';
  alignRows();
});
for(const event of ['pointerover','focusin'])document.querySelector('.compare-grid').addEventListener(event,e=>{
  const card=e.target.closest('.journey');if(!card)return;
  document.querySelectorAll('.journey').forEach(j=>j.classList.toggle('highlight',j.dataset.journey===card.dataset.journey));
});
document.querySelector('.compare-grid').addEventListener('pointerleave',()=>document.querySelectorAll('.journey').forEach(j=>j.classList.remove('highlight')));
for(const name of ['from','to']){
  let timer,seq=0;$(name).addEventListener('input',()=>{
    clearTimeout(timer);const n=++seq,q=$(name).value.trim();if(q.length<2)return;
    timer=setTimeout(async()=>{try{const response=await fetch('/api/stations?q='+encodeURIComponent(q));if(!response.ok)return;const data=await response.json();if(n===seq)$(name+'-options').innerHTML=data.stations.map(s=>`<option value="${escape(s.name)}"></option>`).join('');}catch{}},300);
  });
}
fetch('/cities.json').then(r=>r.ok?r.json():[]).then(cities=>{
  const options=[{name:'Zürich HB'},...cities];
  for(const name of ['from','to']) if(!$(name+'-options').children.length) $(name+'-options').innerHTML=options.map(s=>`<option value="${escape(s.name)}"></option>`).join('');
}).catch(()=>{});
for(const id of ['about-button','privacy-button'])$(id).addEventListener('click',()=>$('about').showModal());
$('close-about').addEventListener('click',()=>$('about').close());
$('about').addEventListener('click',e=>{if(e.target===$('about')){const r=$('about').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('about').close();}});
