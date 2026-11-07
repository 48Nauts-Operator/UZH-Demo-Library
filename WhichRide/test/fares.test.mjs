import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseFareRows,matchFares,createFareService} from '../src/fares.mjs';
const row={departure:'2026-09-22T08:38:00+02:00',arrival:'2026-09-22T09:56:00+02:00',text:'Departure: 08:38, on Pl. 14, Train, RE 37, Direction Aarau, Supersaver tickets from CHF 21.20, Arrival: 09:56, Travel time 1 Hour 18 Minutes, 2 changes'};
const journey={id:'j1',from:'Zürich HB',to:'Bern',fromId:'8503000',toId:'8507000',departure:row.departure,arrival:row.arrival,scheduledDeparture:row.departure,scheduledArrival:row.arrival,transfers:2,sections:[{kind:'train',line:'RE 37'}]};
const result={rows:[row],checkedAt:'2026-09-21T15:00:00Z'};
const flush=()=>new Promise(r=>setImmediate(r));
test('deduplicates real displayed fares and retains supersaver restrictions',()=>{
 const offers=parseFareRows([row,row,{...row,text:'No price'}]);assert.equal(offers.length,1);assert.equal(offers[0].amountCHF,21.2);assert.equal(offers[0].supersaver,true);
 const [fare]=matchFares([journey],offers,'none');assert.equal(fare.journeyId,'j1');assert.match(fare.sourceUrl,/reduction=none/);
});
test('does not assign another date, train, transfer count, or ambiguous itinerary a price',()=>{
 const offers=parseFareRows([row]);
 for(const j of [{...journey,scheduledDeparture:'2026-09-23T08:38:00+02:00'},{...journey,transfers:1},{...journey,sections:[{kind:'train',line:'IC 1'}]}])assert.deepEqual(matchFares([j],offers,'half-fare'),[]);
 assert.deepEqual(matchFares([journey,{...journey,id:'j2'}],offers,'half-fare'),[]);
 assert.deepEqual(matchFares([journey],[...offers,{...offers[0],amountCHF:24}],'half-fare'),[]);
});
test('does not guess matches when SBB reports a disruption',()=>{
 const offers=parseFareRows([{...row,text:row.text+', Real time information: Delay'}]);assert.deepEqual(matchFares([journey],offers,'half-fare'),[]);
});
test('same search shares work while reductions remain separate and expired prices are fetched again',async()=>{
 let time=10000,calls=0;const service=createFareService(async()=>{calls++;return result;},{now:()=>time,ttl:100});
 assert.equal(service.request([journey],'half-fare').status,'pending');service.request([journey],'half-fare');await flush();
 assert.equal(calls,1);assert.equal(service.request([journey],'half-fare').fares[0].amountCHF,21.2);
 service.request([journey],'none');await flush();assert.equal(calls,2);
 time+=101;assert.equal(service.request([journey],'half-fare').status,'pending');await flush();assert.equal(calls,3);
});
test('bounds queued browser work and rejects unrecognized fare settings',async()=>{
 let finish;const service=createFareService(()=>new Promise(r=>{finish=r;}),{maxPending:1});
 assert.throws(()=>service.request([journey],'free'));
 service.request([journey],'half-fare');assert.throws(()=>service.request([journey],'none'),e=>e.status===429);await flush();finish(result);await flush();
});
test('upstream failure returns an explicit unavailable state rather than a made-up price',async()=>{
 const service=createFareService(async()=>{throw new Error('Blocked');});service.request([journey],'half-fare');await flush();
 const response=service.request([journey],'half-fare');assert.equal(response.status,'error');assert.equal(response.fares,undefined);
});
