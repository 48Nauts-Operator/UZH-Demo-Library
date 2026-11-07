import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveSearchInput} from '../src/search-input.mjs';
import {validateQuery,swissToday,addDays,searchParams,normalizeFlights} from '../src/core.mjs';

const day=addDays(swissToday(),10);
const query=validateQuery({origin:'ZRH',destination:'FRA',outboundDate:day,returnDate:addDays(day,3),nonstop:false});

test('checked main-search filter wins over interpretation without poisoning the text cache',async()=>{
  const cached=Object.freeze({query:Object.freeze({...query}),notes:[],model:'test'});
  const filtered=await resolveSearchInput({text:'Connections are fine',nonstop:true},async()=>cached);
  assert.equal(filtered.query.nonstop,true);
  assert.equal(searchParams(filtered.query).stops,'1');
  const later=await resolveSearchInput({text:'Connections are fine',nonstop:false},async()=>cached);
  assert.equal(later.query.nonstop,false);
  assert.equal(cached.query.nonstop,false);
});

test('unchecked main filter preserves a nonstop requirement from the travel text',async()=>{
  const result=await resolveSearchInput({text:'Nur Direktflüge',nonstop:false},async()=>({query:{...query,nonstop:true}}));
  assert.equal(result.query.nonstop,true);
});

test('detailed search respects both checkbox values and still validates fields',async()=>{
  const noInterpretation=()=>assert.fail('Structured search must not call Jev');
  for(const nonstop of [true,false]){
    const result=await resolveSearchInput({query:{...query,nonstop}},noInterpretation);
    assert.equal(result.query.nonstop,nonstop);
  }
  await assert.rejects(resolveSearchInput({query:{...query,destination:'invalid'}},noInterpretation));
});

test('checked filter removes connecting itineraries on outward and return legs',async()=>{
  const {query:q}=await resolveSearchInput({text:'A return trip',nonstop:true},async()=>({query}));
  for(const returning of [false,true]){
    const date=returning?q.returnDate:q.outboundDate;
    const [from,to]=returning?['FRA','ZRH']:['ZRH','FRA'];
    const segment=(a,b,time,number)=>({departure_airport:{id:a,time:date+' '+time},arrival_airport:{id:b,time:date+' 14:00'},flight_number:number,airline:'Test',duration:60});
    const direct={price:200,total_duration:60,flights:[segment(from,to,'10:00','DIRECT')]};
    const connecting={price:100,total_duration:180,flights:[segment(from,'MUC','10:00','CONNECT1'),segment('MUC',to,'13:00','CONNECT2')]};
    const payload={other_flights:[direct,connecting]};
    assert.equal(normalizeFlights(payload,{...q,nonstop:false},{returning}).length,2);
    const result=normalizeFlights(payload,q,{returning});
    assert.equal(result.length,1);
    assert.equal(result[0].segments[0].number,'DIRECT');
  }
});
