import {sbbJourneyUrl} from '../public/sbb-links.js';
import {AppError} from './journeys.mjs';

export function parseFareRows(rows) {
  const unique = new Map();
  for (const row of rows || []) {
    const price = row.text?.match(/from CHF\s*([\d,]+\.\d{2})/);
    const line = row.text?.match(/, (?:Train|Bus|Tram|Ship|Cableway), ([^,]+),/);
    const amountCHF = price ? Number(price[1].replaceAll(',','')) : NaN;
    if (!Number.isFinite(amountCHF) || amountCHF <= 0 || !line || !Number.isFinite(Date.parse(row.departure)) || !Number.isFinite(Date.parse(row.arrival))) continue;
    const fare = {departure:row.departure,arrival:row.arrival,line:line[1].replace(/\s/g,'').toUpperCase(),
      transfers:Number(row.text.match(/(\d+) changes?\b/)?.[1] || 0),amountCHF,supersaver:row.text.includes('Supersaver tickets'),
      disrupted:/Real time information:|Cancellation/i.test(row.text)};
    const key = JSON.stringify([fare.departure,fare.arrival,fare.line,fare.transfers,fare.amountCHF]);
    unique.set(key,fare);
  }
  return [...unique.values()];
}

export function matchFares(journeys, offers, reduction) {
  const matches = (j,f) => !f.disrupted && Date.parse(j.scheduledDeparture || j.departure) === Date.parse(f.departure)
    && Date.parse(j.scheduledArrival || j.arrival) === Date.parse(f.arrival) && j.transfers === f.transfers
    && j.sections.find(s=>s.kind!=='walk')?.line.replace(/\s/g,'').toUpperCase() === f.line;
  return journeys.flatMap(j => {
    const candidates = offers.filter(f=>matches(j,f));
    if (candidates.length !== 1 || journeys.filter(other=>matches(other,candidates[0])).length !== 1) return [];
    const f=candidates[0];
    return [{journeyId:j.id,amountCHF:f.amountCHF,supersaver:f.supersaver,sourceUrl:sbbJourneyUrl(j,reduction)}];
  });
}

export function createFareService(reader, {now=Date.now, ttl=120000, maxPending=4, maxStarts=12}={}) {
  const jobs=new Map(); let tail=Promise.resolve(), pending=0, starts=[];
  return {
    request(journeys,reduction) {
      if (!['half-fare','none'].includes(reduction)) throw new AppError('Bitte Halbtax oder ohne Ermässigung wählen.');
      if (!journeys.length) throw new AppError('Bitte zuerst Verbindungen suchen.');
      const sorted=[...journeys].sort((a,b)=>Date.parse(a.scheduledDeparture||a.departure)-Date.parse(b.scheduledDeparture||b.departure));
      const first=sorted[0],nextUrl=sorted.length>4?sbbJourneyUrl(sorted[4],reduction):null;
      const url=sbbJourneyUrl(first,reduction), time=now();
      for (const [key,job] of jobs) if(job.expires<=time && job.status!=='pending')jobs.delete(key);
      let job=jobs.get(url);
      if(!job) {
        starts=starts.filter(t=>t>time-60000);
        if(pending>=maxPending || starts.length>=maxStarts) throw new AppError('Die Preisabfrage ist gerade ausgelastet. Bitte gleich erneut versuchen.',429);
        starts.push(time);pending++;
        job={status:'pending',expires:Infinity}; jobs.set(url,job);
        const operation=tail.then(async()=>{
          try {
            const result=await reader({url,nextUrl,reduction,from:first.from,to:first.to});
            const offers=parseFareRows(result.rows);
            if(!offers.length)throw new Error('No readable fares');
            Object.assign(job,{status:'ready',offers,checkedAt:result.checkedAt,expires:now()+ttl});
          }catch {
            Object.assign(job,{status:'error',error:'SBB-Preise konnten gerade nicht geladen werden. Bitte direkt bei SBB prüfen oder erneut versuchen.',expires:now()+15000});
          }finally{pending--;}
        });
        tail=operation.catch(()=>{});
      }
      if(job.status==='ready')return {status:'ready',reduction,checkedAt:job.checkedAt,expiresAt:new Date(job.expires).toISOString(),fares:matchFares(journeys,job.offers,reduction),total:journeys.length};
      return {status:job.status,reduction,...(job.error?{error:job.error}:{})};
    }
  };
}
