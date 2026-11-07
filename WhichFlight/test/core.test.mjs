import test from 'node:test';
import assert from 'node:assert/strict';
import {validateQuery,searchParams,normalizeFlights,swissToday,providerTimestamp,googleLink} from '../src/core.mjs';
import {buildInterpretation,applyInterpretation} from '../src/interpret.mjs';
const input={origin:'ZRH',destination:'FRA',outboundDate:'2026-09-24',adults:1};
const q=validateQuery(input,'2026-09-21');
function flight({price=184,departure='2026-09-24 08:00',arrival='2026-09-24 09:00',from='ZRH',to='FRA',number='DE 4312',...extra}={}){return {price,total_duration:60,flights:[{departure_airport:{id:from,time:departure},arrival_airport:{id:to,time:arrival},flight_number:number,airline:'Test Airline',duration:60}],...extra};}
test('Swiss calendar date stays correct across UTC midnight and DST',()=>{
 assert.equal(swissToday(new Date('2026-09-21T22:30:00Z')),'2026-09-22');
 assert.equal(swissToday(new Date('2026-01-21T23:30:00Z')),'2026-01-22');
});
test('rejects impossible dates, past dates and reversed trips before paid search',()=>{
 for(const override of [{outboundDate:'2026-02-30'},{outboundDate:'2026-09-20'},{returnDate:'2026-09-23'},{destination:'ZRH'},{origin:'http://localhost'},{adults:4,children:4}])assert.throws(()=>validateQuery({...input,...override},'2026-09-21'));
});
test('no time constraint is invented and bags account for every traveller',()=>{
 const p=searchParams(q);assert.equal(p.outbound_times,undefined);assert.equal(p.return_date,undefined);assert.equal(p.type,'2');
 const p2=searchParams(validateQuery({...input,adults:2,children:1,baggage:'carry',departAfter:'08:30',arriveBefore:'16:00',returnDate:'2026-09-27',returnAfter:'10:00'},'2026-09-21'));
 assert.equal(p2.bags,'3');assert.equal(p2.type,'1');assert.equal(p2.outbound_times,'8,23,0,16');assert.equal(p2.return_times,'10,23,0,23');
 assert.equal(searchParams({...q,baggage:'checked'}).bags,undefined,'checked baggage must not be falsely priced as carry-on');
});
test('normalization keeps the cheapest quote per itinerary and ignores non-prices',()=>{
 const result=normalizeFlights({best_flights:[flight({price:210})],other_flights:[flight({price:184}),flight({price:null,number:'XX 2'}),flight({price:0,number:'XX 3'}),flight({price:'CHF 100',number:'XX 4'})]},q);
 assert.equal(result.length,1);assert.equal(result[0].price,184);
});
test('exact time checks reject minute violations and next-day arrival for same-day deadline',()=>{
 const constrained={...q,departAfter:'08:30',arriveBefore:'18:00'};
 const payload={other_flights:[flight({departure:'2026-09-24 08:15',number:'A 1'}),flight({departure:'2026-09-24 09:00',arrival:'2026-09-24 10:00',number:'A 2'}),flight({departure:'2026-09-24 22:00',arrival:'2026-09-25 06:00',number:'A 3'})]};
 assert.deepEqual(normalizeFlights(payload,constrained).map(f=>f.segments[0].number),['A 2']);
});
test('a return result is matched to the reverse route and price remains the full trip quote',()=>{
 const returning={...q,returnDate:'2026-09-27'};
 const result=normalizeFlights({other_flights:[flight({price:301,departure:'2026-09-27 08:00',arrival:'2026-09-27 08:50',from:'FRA',to:'ZRH'}),flight({price:100,departure:'2026-09-27 08:00',arrival:'2026-09-27 09:00',from:'FRA',to:'BSL'})]},returning,{returning:true});
 assert.equal(result.length,1);assert.equal(result[0].price,301);assert.equal(result[0].to,'ZRH');
});
test('ignores flights with wrong dates, wrong destinations or missing legs',()=>{
 const result=normalizeFlights({other_flights:[flight({departure:'2026-09-25 08:00'}),flight({to:'BER'}),flight({flights:[]}),flight({departure:'bad'})]},q);assert.deepEqual(result,[]);
});
test('links and timestamps preserve provider provenance without arbitrary schemes',()=>{
 assert.equal(googleLink({search_metadata:{google_flights_url:'javascript:alert(1)'}}),null);
 assert.equal(googleLink({search_metadata:{google_flights_url:'https://evil.com/travel/flights'}}),null);
 assert.equal(googleLink({search_metadata:{google_flights_url:'https://www.google.com/travel/flights?test=1'}}),'https://www.google.com/travel/flights?test=1');
 assert.equal(providerTimestamp({search_metadata:{created_at:'2026-09-21 14:54:47 UTC'}}),'2026-09-21T14:54:47.000Z');
});
test('airport candidates do not offer unrequested Swiss airport groups',()=>{
 const {questions}=buildInterpretation('Zürich nach Frankfurt am Donnerstag.','2026-09-21');
 assert.ok(questions.origin.criteria.ZRH);assert.ok(questions.destination.criteria.FRA);assert.equal(questions.origin.criteria['ZRH,BSL'],undefined);
 const multiple=buildInterpretation('Zürich oder Basel nach Frankfurt am Donnerstag.','2026-09-21');assert.ok(multiple.questions.origin.criteria['ZRH,BSL']);
});
test('semantic optional-field presence prevents invented filters',()=>{
 const req=buildInterpretation('Zürich nach Frankfurt am Donnerstag.','2026-09-21');
 const selected={origin:'ZRH',destination:'FRA',outboundDate:'2026-09-24',returnDate:'none',adults:'1',children:'0',baggage:'personal',nonstop:'no',departAfter:'08:00',arriveBefore:'none',returnAfter:'none',returnBefore:'none',maxPrice:'none',extra:'none'};
 const answers=Object.fromEntries(Object.entries(req.questions).map(([k,v])=>[k,v.type==='noul'?{type:'noul',noul:.02}:{type:'choice',choice:selected[k],confidence:1,probabilities:{[selected[k]]:1}}]));
 assert.equal(applyInterpretation(req,answers,'2026-09-21').query.departAfter,null);
 answers.departAfter_stated.noul=.99;assert.equal(applyInterpretation(req,answers,'2026-09-21').query.departAfter,'08:00');
 delete answers.destination;assert.throws(()=>applyInterpretation(req,answers,'2026-09-21'));
});
