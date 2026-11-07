"""Run with browser-harness < scripts/check-sbb-links.py. Reads public rendered SBB results; never books."""
import json,time,re,os
from pathlib import Path
from urllib.parse import urlencode
ROOT=Path.cwd() # Run from the whichride directory.
CITIES=json.loads((ROOT/'data/swiss-cities.json').read_text())
OUT=ROOT/'.runtime/sbb-check/cities-50.json'
OUT.parent.mkdir(parents=True,exist_ok=True)
TAB=os.environ.get('SBB_CHECK_TAB') or new_tab('https://www.sbb.ch/en')
DAY=os.environ.get('SBB_CHECK_DAY',time.strftime('%Y-%m-%d'))
def valid_result(result):
 header=result.get('pagePrefix','').split('Select connection.')[0]
 expected='Full fare' if result['reduction']=='none' else 'Half Fare Travelcard'
 return bool(result.get('connections') and result.get('pricesCHF') and result['destination'] in result.get('title','') and expected in header)
previous={}
if os.environ.get('SBB_CHECK_RESUME')=='1' and OUT.exists():
 checkpoint=json.loads(OUT.read_text())
 if checkpoint.get('day')==DAY and checkpoint.get('origin')=='Zürich HB' and checkpoint.get('time')=='15:30':
  previous={(r['stationId'],r['reduction']):r for r in checkpoint['results']}
results=[]
for index,city in enumerate(CITIES):
 for reduction in ['half-fare','none']:
  params={'stops':f"Zürich HB_I8503000~{city['name']}_I{city['id']}",'day':DAY,'time':'15_30','moment':'dep'}
  if reduction=='none':params['reduction']='none'
  url='https://www.sbb.ch/en?'+urlencode(params)
  old=previous.get((city['id'],reduction))
  if old and old['url']==url and valid_result(old):
   old['pass']=True
   results.append(old)
   continue
  result={'destination':city['name'],'stationId':city['id'],'reduction':reduction,'url':url,'checkedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
  if old:result['previousAttempt']={'checkedAt':old['checkedAt'],'error':old.get('error'),'pass':False}
  try:
   switch_tab(TAB)
   goto_url(url)
   try:wait_for_load(timeout=3)
   except RuntimeError:pass # Navigation can invalidate the first readiness poll.
   rows=[]
   for attempt in range(20):
    info=page_info()
    if city['name'] in info.get('title',''):
     nodes=cdp('Accessibility.getFullAXTree')['nodes']
     rows=[n.get('name',{}).get('value','') for n in nodes if n.get('role',{}).get('value')=='button' and n.get('name',{}).get('value','').startswith('Departure:')]
     if rows and all('CHF' in r for r in rows):break
    time.sleep(.75)
   prefix=js('document.body.innerText.slice(0,650)')
   header=prefix.split('Select connection.')[0]
   fare_matches=('Half Fare Travelcard' in header) if reduction=='half-fare' else ('Full fare' in header)
   prices=[float(v.replace(',','')) for r in rows for v in re.findall(r'from CHF\s*([\d,]+\.\d{2})',r)]
   result.update({'title':info.get('title'),'pagePrefix':prefix,'connections':rows,'pricesCHF':prices,'minimumDisplayedCHF':min(prices) if prices else None,'pass':bool(rows and prices and city['name'] in info.get('title','') and fare_matches)})
  except Exception as exc:result.update({'pass':False,'error':str(exc)[:300]})
  results.append(result)
  OUT.write_text(json.dumps({'origin':'Zürich HB','day':DAY,'time':'15:30','scope':'50 destinations, both displayed fare settings; no purchase or global cheapest claim','results':results},ensure_ascii=False,indent=2)+'\n')
  print(f"{len(results)}/100 {city['name']} {reduction}: {'PASS' if result['pass'] else 'CHECK'} min CHF {result.get('minimumDisplayedCHF')}",flush=True)
  time.sleep(.35)
print('COMPLETE',sum(r['pass'] for r in results),'/',len(results),flush=True)
OUT.write_text(json.dumps({'origin':'Zürich HB','day':DAY,'time':'15:30','scope':'50 destinations, both displayed fare settings; no purchase or global cheapest claim','results':results},ensure_ascii=False,indent=2)+'\n')
