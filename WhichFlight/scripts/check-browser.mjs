import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const url=process.env.TEST_URL||'http://127.0.0.1:3361';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const date=new Date(today+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+3);const day=date.toISOString().slice(0,10);
const query={origin:'ZRH',destination:'FRA',outboundDate:day,returnDate:null,adults:1,children:0,baggage:'personal',nonstop:false,departAfter:null,arriveBefore:null,returnAfter:null,returnBefore:null,maxPrice:null};
function option(id,price){return {id,price,from:'ZRH',to:'FRA',departure:day+' 08:00',arrival:day+' 09:00',duration:60,stops:0,airlines:['TEST AIRLINE'],segments:[{from:'ZRH',to:'FRA',departure:day+' 08:00',arrival:day+' 09:00',duration:60,airline:'TEST AIRLINE',number:'TEST 123'}],layovers:[],returnFlight:null,canBook:true};}
const fixture={id:'browser-fixture',query,notes:[],model:'BROWSER TEST FIXTURE',options:[option('fixture1',184),option('fixture2',212),option('fixture3',250),option('fixture4',280)],checkedAt:new Date().toISOString(),searchUrl:'https://www.google.com/travel/flights',found:4,examined:4,partial:false,searchMs:10};
try{
 const page=await browser.newPage({viewport:{width:1440,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let mode='success';let release;const pending=new Promise(resolve=>{release=resolve;});
 await page.route('**/api/search',async route=>{
   if(mode==='html'){await route.fulfill({status:502,contentType:'text/html',body:'<html>Upstream unavailable</html>'});return;}
   if(mode==='late'){await pending;try{await route.fulfill({json:fixture});}catch{}return;}
   await route.fulfill({json:fixture});
 });
 await page.route('**/api/booking',route=>route.fulfill({json:{offers:[{name:'TEST BOOKING PARTNER',price:184,url:'https://www.google.com/travel/clk/f',method:'POST',fields:[{name:'u',value:'test-only-token'}],baggage:['1 free carry-on'],option:''}],checkedAt:new Date().toISOString(),searchUrl:'https://www.google.com/travel/flights'}}));
 await page.goto(url);await page.waitForSelector('#origin option',{state:'attached'});
 await page.getByRole('button',{name:'Frankfurt am Donnerstag ↗',exact:true}).click();await page.waitForSelector('.flight-card');
 assert.equal(await page.locator('.flight-card').count(),3);assert.equal(await page.locator('.best-banner').count(),1);assert.match(await page.locator('.price').first().innerText(),/184/);
 await page.locator('[data-book]').first().click();await page.waitForSelector('.booking-options .offer');assert.match(await page.locator('.booking-options').first().innerText(),/TEST BOOKING PARTNER/);
 assert.equal(await page.locator('.booking-options form').first().getAttribute('method'),'post');
 await page.locator('[data-details]').first().click();assert.equal(await page.locator('.flight-details').first().isVisible(),true);
 await page.locator('#more-results').click();assert.equal(await page.locator('.flight-card').count(),4);
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at '+width);}
 await page.locator('#edit-search').click();assert.equal(await page.locator('#fields').isVisible(),true);assert.equal(await page.locator('#origin').inputValue(),'ZRH');
 await page.selectOption('#adults','2');assert.equal(await page.locator('#results').isVisible(),false,'editing fields immediately clears stale fares');
 await page.locator('#fields-button').click();await page.waitForSelector('.flight-card');
 await page.fill('#request','A different search');assert.equal(await page.locator('#results').isVisible(),false,'editing text clears stale fares');
 mode='html';await page.locator('#search-button').click();await page.waitForSelector('#status.error');assert.match(await page.locator('#status').innerText(),/nicht erreichbar/);assert.doesNotMatch(await page.locator('#status').innerText(),/pattern|JSON|Unexpected/);
 mode='late';await page.fill('#request','A pending first request');const started=page.waitForRequest('**/api/search');await page.locator('#search-button').click();await started;
 await page.fill('#request','New user intent while first request is pending');release();await page.waitForTimeout(150);assert.equal(await page.locator('#results').isVisible(),false,'late results cannot replace edited intent');assert.equal(await page.locator('#search-button').isEnabled(),true);
 await page.locator('#about-open').click();assert.equal(await page.locator('#about').isVisible(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#about').isVisible(),false);
 assert.deepEqual(errors,[]);console.log('Browser checks passed: prices, cheapest banner, booking handoff, details, expanded results, edited and stale searches, HTML errors, modal, 1440/390/320px. Browser-only fixtures; no paid provider calls.');
}finally{await browser.close();}
