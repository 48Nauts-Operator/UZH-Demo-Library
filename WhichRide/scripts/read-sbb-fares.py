"""Executed by the server through browser-harness in its dedicated browser only."""
import json, os, time

query = json.loads(os.environ['WHICHRIDE_FARE_QUERY'])
tab = None

def connection_nodes():
    return [n for n in cdp('Accessibility.getFullAXTree')['nodes']
            if n.get('role', {}).get('value') == 'button'
            and n.get('name', {}).get('value', '').startswith('Departure:')]

def read_rows(previous=None):
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        nodes = connection_nodes()
        names = [n['name']['value'] for n in nodes]
        if names and names != previous and all('CHF' in name for name in names):
            break
        time.sleep(.5)
    else:
        raise RuntimeError('SBB prices did not load')
    rows = []
    for node in nodes:
        obj = cdp('DOM.resolveNode', backendNodeId=node['backendDOMNodeId'])['object']['objectId']
        try:
            details = cdp('Runtime.callFunctionOn', objectId=obj, returnByValue=True,
                functionDeclaration='''function(){
                  const card=this.parentElement;
                  const times=card.querySelector('sbb-pearl-chain-time')?.shadowRoot?.querySelectorAll('time[datetime]');
                  return {times:Array.from(times||[],t=>t.getAttribute('datetime'))};
                }''')['result'].get('value', {})
            if len(details.get('times', [])) == 2:
                rows.append({'text':node['name']['value'], 'departure':details['times'][0], 'arrival':details['times'][1]})
        finally:
            cdp('Runtime.releaseObject', objectId=obj)
    return rows, names

try:
    # This named harness is attached only to WhichRide's separate browser profile.
    # Clean up an abandoned worker tab after a previous timeout.
    for target in cdp('Target.getTargets')['targetInfos']:
        if target['type'] == 'page' and target.get('url', '').startswith('https://www.sbb.ch/'):
            cdp('Target.closeTarget', targetId=target['targetId'])
    tab = new_tab(query['url'])
    try:
        wait_for_load(timeout=3)
    except RuntimeError:
        pass
    rows, names = read_rows()
    info = page_info()
    header = js("document.body.innerText.split('Select connection.')[0]")
    expected = 'Full fare' if query['reduction'] == 'none' else 'Half Fare Travelcard'
    if expected not in header or query['from'] not in info['title'] or query['to'] not in info['title']:
        raise RuntimeError('SBB route or fare setting did not match')
    # One more page normally covers the eight timetable candidates. A partial
    # result remains useful; prices are attached only to unambiguous matches.
    partial = False
    if query.get('nextUrl'):
        try:
            goto_url(query['nextUrl'])
            try:
                wait_for_load(timeout=3)
            except RuntimeError:
                pass
            extra, _ = read_rows(names)
            header = js("document.body.innerText.split('Select connection.')[0]")
            if expected not in header:
                raise RuntimeError('SBB fare setting changed')
            rows.extend(extra)
        except Exception:
            partial = True
    print('WHICHRIDE_PRICE_RESULT ' + json.dumps({'rows':rows, 'partial':partial,
          'checkedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}), flush=True)
finally:
    if tab:
        try:
            cdp('Target.closeTarget', targetId=tab)
        except Exception:
            pass
