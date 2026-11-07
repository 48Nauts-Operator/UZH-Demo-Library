import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let journeys;
let signalJourneys;const journeysReady=new Promise(resolve=>{signalJourneys=resolve;});
// Browser-only price fixtures also exercise late responses after changing Halbtax.
await page.route('**/api/fares',async route=>{
  await journeysReady;
  const {reduction}=route.request().postDataJSON();
  if(reduction==='none')await new Promise(r=>setTimeout(r,700));
  await route.fulfill({json:{status:'ready',reduction,checkedAt:new Date().toISOString(),total:journeys.length,fares:journeys.map((j,i)=>({journeyId:j.id,amountCHF:(i===0?20:26.5)*(reduction==='none'?2:1),supersaver:i===0,sourceUrl:'https://www.sbb.ch/en'+(reduction==='none'?'?reduction=none':'' )}))}});
});
// Browser-only fixture: no hosted model call. Real timetable response is unchanged.
await page.route('**/api/rank',async route=>{
  const input=route.request().postDataJSON();
  const unknown=input.preferences.includes('wheelchair');
  const ranked=[...journeys].reverse().map((j,i)=>({...j,fit:3.8-i*.15,certainty:.8,status:unknown?'unknown':'fits',reason:unknown?'none':'work'}));
  await route.fulfill({json:{journeys:ranked,latencyMs:120,model:'BROWSER-TEST-FIXTURE',cached:false}});
});
await page.goto(process.env.TEST_URL || 'http://127.0.0.1:3360');
await page.screenshot({path:'.runtime/landing-desktop.png',fullPage:true});
const search=page.waitForResponse(r=>r.url().endsWith('/api/journeys'));
await page.getByRole('button',{name:'Verbindungen zeigen'}).click();
journeys=(await (await search).json()).journeys;
signalJourneys();
await page.waitForSelector('#original-results .journey',{timeout:35000});
assert.equal(await page.locator('#original-results .journey').count(),8);
await page.waitForSelector('.price-value');
assert.equal(await page.locator('#to-options option').count(),51);
const searchLink=new URL(await page.locator('#sbb-search-link').getAttribute('href'));
assert.equal(searchLink.searchParams.get('stops'),'Zürich HB_I8503000~Bern_I8507000');
assert.equal(searchLink.searchParams.has('reduction'),false);
const fullRequest=page.waitForRequest(r=>r.url().endsWith('/api/fares')&&r.postDataJSON().reduction==='none');
await page.selectOption('#reduction','none');await fullRequest;
assert.equal(await page.locator('.price-value').count(),0,'old fare prices clear immediately');
assert.equal(new URL(await page.locator('#sbb-search-link').getAttribute('href')).searchParams.get('reduction'),'none');
for(const href of await page.locator('#original-results .sbb-link').evaluateAll(links=>links.map(link=>link.href))) assert.equal(new URL(href).searchParams.get('reduction'),'none');
await page.getByRole('button',{name:'Zeit zum Arbeiten'}).click();
await page.waitForSelector('#personal-results .journey');
for(const href of await page.locator('#personal-results .sbb-link').evaluateAll(links=>links.map(link=>link.href))) assert.equal(new URL(href).searchParams.get('reduction'),'none');
await page.selectOption('#reduction','half-fare');
await page.waitForTimeout(850);
assert.equal(await page.locator('.price-value').count(),16);
assert.match(await page.locator('#original-results .price-value').first().innerText(),/20\.00/,'late full-fare response cannot replace current Halbtax prices');
assert.equal(await page.locator('.best-banner').count(),1);
for(const href of await page.locator('.sbb-link').evaluateAll(links=>links.map(link=>link.href))) assert.equal(new URL(href).searchParams.has('reduction'),false);
assert.equal(await page.locator('#personal-results .journey').first().getAttribute('data-journey'),journeys.at(-1).id);
assert.equal(await page.locator('#original-results .journey').first().getAttribute('data-journey'),journeys[0].id);
await page.locator('#personal-results .journey').first().hover();
assert.equal(await page.locator('.journey.highlight').count(),2);
await page.evaluate(()=>{document.querySelector('#rank-status').textContent='UI TEST — ranking and price fixtures for layout verification, not live results.';});
await page.screenshot({path:'.runtime/ui-fixture-desktop.png',fullPage:true});
await page.locator('.journey.best').screenshot({path:'.runtime/best-card-desktop-fixture.png'});
for(const width of [390,320]){
  await page.setViewportSize({width,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at '+width);
  await page.screenshot({path:`.runtime/ui-fixture-mobile-${width}.png`,fullPage:true});
  await page.locator('.journey.best').screenshot({path:`.runtime/best-card-${width}-fixture.png`});
}
await page.locator('#personal-results .details-toggle').first().click();
assert.equal(await page.locator('#personal-results .journey-details').first().isVisible(),true);
await page.fill('#preferences','I use a wheelchair and need step-free boarding.');
assert.equal(await page.locator('#personal-results .journey').count(),0);
await page.getByRole('button',{name:'Für mich sortieren'}).click();
await page.waitForSelector('#personal-results .journey');
assert.equal(await page.locator('#personal-results .match-tag.unknown').count(),8);
await page.getByRole('button',{name:'So funktioniert’s'}).click();
assert.equal(await page.locator('#about').isVisible(),true);
await page.keyboard.press('Escape');
await page.unroute('**/api/rank');
// Controlled error response verifies the original journeys stay accessible.
await page.route('**/api/rank',r=>r.fulfill({status:503,json:{error:'Jev ist vorübergehend pausiert.'}}));
await page.fill('#preferences','A different preference to exercise failure handling.');
await page.getByRole('button',{name:'Für mich sortieren'}).click();
await page.waitForFunction(()=>document.querySelector('#rank-status').textContent.includes('pausiert'));
assert.equal(await page.locator('#original-results .journey').count(),8);
assert.equal(await page.locator('#personal-results .journey').count(),0);
// Move on to another search while the first one's price response is in flight.
let searchNumber=0;
await page.route('**/api/journeys',route=>route.fulfill({json:{id:`search-${++searchNumber}`,journeys,fetchedAt:new Date().toISOString(),jevAvailable:true}}));
await page.unroute('**/api/fares');
await page.route('**/api/fares',async route=>{
 const {id,reduction}=route.request().postDataJSON();
 if(id==='search-1')await new Promise(r=>setTimeout(r,700));
 await route.fulfill({json:{status:'ready',reduction,checkedAt:new Date().toISOString(),total:8,fares:journeys.map(j=>({journeyId:j.id,amountCHF:id==='search-1'?99:25,sourceUrl:'https://www.sbb.ch/en',supersaver:false}))}});
});
const oldPriceRequest=page.waitForRequest(r=>r.url().endsWith('/api/fares')&&r.postDataJSON().id==='search-1');
await page.getByRole('button',{name:'Verbindungen zeigen'}).click();await oldPriceRequest;
await page.getByRole('button',{name:'Verbindungen zeigen'}).click();
await page.waitForTimeout(850);
assert.equal(await page.locator('#original-results .price-value').count(),8);
assert.match(await page.locator('#original-results .price-value').first().innerText(),/25\.00/,'old search cannot overwrite new search prices');
assert.deepEqual(errors,[]);
console.log('PASS: live timetable, side-by-side identity, ranking movement (fixture), linked highlighting, details, 390px/320px layout, stale results, unknown evidence (fixture), error recovery, dialog, no browser errors.');
await browser.close();
