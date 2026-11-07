import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sbbSearchUrl,sbbJourneyUrl} from '../public/sbb-links.js';
const base={from:'Zürich HB',fromId:'8503000',to:'Bern',toId:'8507000',day:'2026-09-21',time:'15:30'};
test('SBB links match both user-supplied fare variants',()=>{
 const half=new URL(sbbSearchUrl(base)),full=new URL(sbbSearchUrl({...base,reduction:'none'}));
 assert.equal(half.searchParams.get('stops'),'Zürich HB_I8503000~Bern_I8507000');
 assert.equal(half.searchParams.get('day'),'2026-09-21');assert.equal(half.searchParams.get('time'),'15_30');assert.equal(half.searchParams.get('moment'),'dep');
 assert.equal(half.searchParams.has('reduction'),false);assert.equal(full.searchParams.get('reduction'),'none');
});
test('Swiss date and scheduled departure survive UTC midnight and delay predictions',()=>{
 const url=new URL(sbbJourneyUrl({...base,scheduledDeparture:'2026-09-21T22:10:00Z',departure:'2026-09-21T22:17:00Z'}));
 assert.equal(url.searchParams.get('day'),'2026-09-22');assert.equal(url.searchParams.get('time'),'00_10');
});
test('all 50 catalogue stations create distinct correctly identified links in both fare settings',async()=>{
 const cities=JSON.parse(await readFile(new URL('../data/swiss-cities.json',import.meta.url)));
 assert.equal(cities.length,50);assert.equal(new Set(cities.map(c=>c.id)).size,50);
 for(const city of cities)for(const reduction of ['half-fare','none']){
  const url=new URL(sbbSearchUrl({...base,to:city.name,toId:city.id,reduction}));
  assert.equal(url.hostname,'www.sbb.ch');assert.equal(url.searchParams.get('stops'),`Zürich HB_I8503000~${city.name}_I${city.id}`);
 }
});
test('arrival searches remain arrival searches',()=>assert.equal(new URL(sbbSearchUrl({...base,mode:'arrival'})).searchParams.get('moment'),'arr'));
