#!/usr/bin/env python3
"""Bounded, local careers-site policy screening. Python 3.11+, standard library only."""
import argparse
import csv
import hashlib
import html
import ipaddress
import json
import re
import socket
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit, urlunsplit, unquote
from urllib.request import Request, build_opener, HTTPRedirectHandler

AGENT = 'SwissJobsPolicyCheck'
MAX_BYTES = 1_000_000
JOBS = re.compile(r'career|karriere|stellen|jobs?\b|vacanc|emplois?|recrut|lavora|lavoro|offene.position', re.I)
TERMS = re.compile(r'terms|conditions|nutzungs|agb\b|rechtlich|legal|condizioni|mentions.l.gales', re.I)
TECH = re.compile(r'scrap\w*|crawl\w*|\brobots?\b|\bbots?\b|automated.{0,40}(?:access|collect|extract)|automatisiert\w*.{0,40}(?:zugriff|abruf|ausles|erfass)|artificial intelligence|künstliche.{0,10}intelligenz|\bKI\b|\bAI\b|machine.learning|text.and.data.mining|intelligence artificielle|intelligenza artificiale|extraction automatis', re.I)
DENY = re.compile(r'prohibit|forbid|not (?:permitted|allowed|authori[sz]ed)|may not|must not|do not|without.{0,35}(?:consent|permission)|verbot|untersagt|nicht (?:gestattet|erlaubt|zulässig)|ohne.{0,30}(?:zustimmung|genehmigung)|interdit|sans.{0,25}autorisation|vietat|non.{0,15}consentit', re.I)

class CheckError(Exception):
    pass

class Blocked(CheckError):
    pass

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def normalize(value):
    value = value.strip()
    if '://' not in value:
        value = 'https://' + value
    p = urlsplit(value)
    if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password:
        raise CheckError('Expected a public HTTP(S) URL without credentials')
    if p.port not in (None, 80, 443):
        raise CheckError('Only ports 80 and 443 supported')
    return urlunsplit((p.scheme, p.netloc.lower(), p.path or '/', p.query, ''))


def origin(url):
    p = urlsplit(url)
    return f'{p.scheme}://{p.netloc}'


def public_host(url):
    p = urlsplit(normalize(url))
    addresses = socket.getaddrinfo(p.hostname, p.port or (443 if p.scheme == 'https' else 80), type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise CheckError('Private, local or reserved network destination rejected')


def owned(url, root):
    host = (urlsplit(url).hostname or '').lower()
    base = (urlsplit(root).hostname or '').lower().removeprefix('www.')
    return host == base or host.endswith('.' + base)


def octets(s):
    # RFC 9309 path comparisons preserve encoded reserved characters.
    def pct(m):
        b = int(m[0][1:], 16)
        return chr(b) if chr(b) in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~' else m[0].upper()
    s = re.sub(r'%[0-9a-fA-F]{2}', pct, s)
    return ''.join(c if ord(c) < 128 else ''.join('%%%02X' % b for b in c.encode()) for c in s)


class Robots:
    def __init__(self, text):
        self.groups = []
        agents, rules, delay, seen_rule = [], [], 0.0, False
        for line in text.splitlines():
            line = line.split('#', 1)[0].strip()
            if ':' not in line:
                continue
            key, value = (v.strip() for v in line.split(':', 1))
            key = key.lower()
            if key == 'user-agent':
                if seen_rule:
                    self.groups.append((agents, rules, delay))
                    agents, rules, delay, seen_rule = [], [], 0.0, False
                agents.append(value.lower())
            elif agents and key in ('allow', 'disallow', 'crawl-delay', 'request-rate'):
                seen_rule = True
                if key in ('allow', 'disallow') and value:
                    rules.append((key, value))
                elif key == 'crawl-delay':
                    try:
                        delay = max(delay, float(value))
                    except ValueError:
                        raise CheckError('Invalid crawl-delay; review robots manually')
                elif key == 'request-rate':
                    raise CheckError('Request-rate directive requires manual review in this PoC')
        if agents:
            self.groups.append((agents, rules, delay))

    def selected(self, agent):
        specific = [g for g in self.groups if agent.lower() in g[0]]
        return specific or [g for g in self.groups if '*' in g[0]]

    def check(self, url, agent=AGENT):
        p = urlsplit(url)
        target = octets((p.path or '/') + ('?' + p.query if p.query else ''))
        hits = []
        groups = self.selected(agent)
        for _, rules, _ in groups:
            for kind, raw in rules:
                pattern = octets(raw)
                anchored = pattern.endswith('$')
                pattern = pattern[:-1] if anchored else pattern
                regex = '^' + '.*'.join(re.escape(x) for x in pattern.split('*')) + ('$' if anchored else '')
                if re.search(regex, target):
                    hits.append((len(pattern.replace('*', '').encode()), kind == 'allow', f'{kind}: {raw}'))
        winner = max(hits, default=(0, True, 'No matching disallow'))
        return winner[1], winner[2], max((g[2] for g in groups), default=0)


class Page(HTMLParser):
    def __init__(self, text, url):
        super().__init__(convert_charrefs=True)
        self.links, self.parts, self.hidden, self.anchor = [], [], 0, None
        self.url = url
        self.feed(text)
        self.text = '\n'.join(re.sub(r'\s+', ' ', line).strip() for line in ' '.join(self.parts).split('\n') if line.strip())

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style', 'noscript'):
            self.hidden += 1
        if tag == 'a' and attrs.get('href'):
            self.anchor = [urljoin(self.url, attrs['href']), '']

    def handle_endtag(self, tag):
        if tag in ('p', 'div', 'li', 'section', 'h1', 'h2', 'h3', 'tr') and not self.hidden:
            self.parts.append('\n')
        if tag in ('script', 'style', 'noscript'):
            self.hidden = max(0, self.hidden - 1)
        if tag == 'a' and self.anchor:
            self.links.append(tuple(self.anchor))
            self.anchor = None

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)
            if self.anchor:
                self.anchor[1] += data


def policy_signals(text):
    findings = []
    for sentence in re.split(r'(?<=[.!?;])\s+|\n+', text):
        for match in TECH.finditer(sentence):
            excerpt = sentence[max(0, match.start()-180):match.end()+220].strip()
            status = 'restriction' if DENY.search(excerpt) else 'ambiguous'
            if (status, excerpt) not in findings:
                findings.append((status, excerpt))
    return findings


class Client:
    def __init__(self):
        self.opener = build_opener(NoRedirect())
        self.robots = {}
        self.last_request = {}
        self.audit = []
        self.requests = 0

    def raw(self, url, delay=1):
        public_host(url)
        if self.requests >= 30:
            raise CheckError('Per-company request budget exhausted')
        host = origin(url)
        time.sleep(max(0, self.last_request.get(host, 0) + delay - time.monotonic()))
        self.last_request[host] = time.monotonic()
        self.requests += 1
        try:
            response = self.opener.open(Request(url, headers={'User-Agent': AGENT + '/0.1 (careers-policy research)', 'Accept': 'text/html,text/plain'}), timeout=12)
        except HTTPError as exc:
            response = exc
        except (URLError, TimeoutError, OSError) as exc:
            raise CheckError(f'Network failure: {type(exc).__name__}') from exc
        with response:
            body = response.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise CheckError('Response exceeds 1 MB; no partial-policy approval')
            charset = response.headers.get_content_charset() or 'utf-8'
            try:
                text = body.decode(charset)
            except (LookupError, UnicodeDecodeError) as exc:
                raise CheckError('Undecodable response; review manually') from exc
            status = response.code
            headers = dict(response.headers)
            self.audit.append({'url': url, 'http_status': status, 'sha256': hashlib.sha256(body).hexdigest()})
            return status, text, headers

    def rules(self, url):
        host = origin(url)
        if host not in self.robots:
            target = host + '/robots.txt'
            for _ in range(6):
                status, text, headers = self.raw(target)
                if status in (301, 302, 303, 307, 308):
                    location = next((v for k, v in headers.items() if k.lower() == 'location'), '')
                    if not location:
                        raise CheckError('Robots redirect without Location')
                    target = normalize(urljoin(target, location))
                    continue
                if status in (404, 410):
                    self.robots[host] = {'url': target, 'status': 'missing', 'rules': Robots(''), 'text': ''}
                elif status in (401, 403):
                    raise Blocked('robots.txt access denied; conservative block')
                elif status != 200 or '<html' in text[:500].lower() or '<!doctype html' in text[:500].lower():
                    raise CheckError(f'robots.txt unavailable or not plain text: HTTP {status}')
                else:
                    self.robots[host] = {'url': target, 'status': 'fetched', 'rules': Robots(text), 'text': text}
                break
            else:
                raise CheckError('Too many robots redirects')
        return self.robots[host]

    def fetch(self, url):
        for _ in range(6):
            rule = self.rules(url)
            allowed, evidence, delay = rule['rules'].check(url)
            if not allowed:
                raise Blocked(f'robots.txt blocks {url} ({evidence})')
            if delay > 10:
                raise CheckError('Crawl-delay exceeds PoC budget; no page fetched')
            status, text, headers = self.raw(url, max(1, delay))
            if status in (301, 302, 303, 307, 308):
                location = next((v for k, v in headers.items() if k.lower() == 'location'), '')
                if not location:
                    raise CheckError('Redirect without Location')
                url = normalize(urljoin(url, location))
                continue
            if status != 200:
                raise CheckError(f'HTTP {status}: {url}')
            content_type = next((v for k, v in headers.items() if k.lower() == 'content-type'), '')
            if not any(t in content_type.lower() for t in ('text/html', 'text/plain', 'application/xhtml')):
                raise CheckError(f'Unsupported document type: {content_type}')
            page = Page(text, url)
            if len(page.text) < 80 or re.search(r'just a moment|verify you are human|access denied|enable javascript', page.text, re.I):
                raise CheckError(f'Empty, JavaScript-only or challenge page: {url}')
            return page
        raise CheckError('Too many page redirects')


def scan(seed, client=None):
    client = client or Client()
    result = {'company': seed.get('company', seed['url']), 'url': seed['url'], 'checked_at': datetime.now(timezone.utc).isoformat(), 'status': 'Review', 'reason': '', 'jobs': [], 'terms': [], 'evidence': [], 'issues': [], 'robots': [], 'requests': []}
    try:
        root = normalize(seed['url'])
        home = client.fetch(root)
        candidates = [(home.url, home)]
        jobs = [normalize(seed['jobs_url'])] if seed.get('jobs_url') else []
        terms = [normalize(seed['terms_url'])] if seed.get('terms_url') else []
        for link, label in home.links:
            if not link.startswith(('https://', 'http://')):
                continue
            if JOBS.search(label + ' ' + urlsplit(link).path):
                jobs.append(normalize(link))
            if TERMS.search(label + ' ' + urlsplit(link).path):
                terms.append(normalize(link))
        jobs = list(dict.fromkeys(jobs))
        terms = list(dict.fromkeys(terms))
        if len(jobs) > 3 or len(terms) > 5:
            result['issues'].append('Discovery limit reached; not every candidate inspected')
        for link in jobs[:3]:
            if not owned(link, home.url):
                result['issues'].append(f'External careers provider needs separate review: {link}')
                continue
            try:
                page = client.fetch(link)
                if not owned(page.url, home.url):
                    result['issues'].append(f'Careers redirect to external provider: {page.url}')
                    continue
                if not JOBS.search(page.text):
                    result['issues'].append(f'Careers page not confirmed: {page.url}')
                    continue
                result['jobs'].append(page.url)
                candidates.append((page.url, page))
                for href, label in page.links:
                    if href.startswith(('http://', 'https://')) and TERMS.search(label + ' ' + urlsplit(href).path):
                        terms.append(normalize(href))
            except Blocked as exc:
                result['evidence'].append({'type': 'robots_block', 'url': link, 'excerpt': str(exc)})
            except CheckError as exc:
                result['issues'].append(str(exc))
        terms = list(dict.fromkeys(terms))
        if len(terms) > 5:
            result['issues'].append('Terms discovery limit reached')
        for link in terms[:5]:
            if not owned(link, home.url):
                result['issues'].append(f'External terms need separate review: {link}')
                continue
            try:
                page = client.fetch(link)
                if not owned(page.url, home.url):
                    result['issues'].append(f'External terms redirect: {page.url}')
                    continue
                if len(page.text) < 300 or not TERMS.search(page.text):
                    result['issues'].append(f'Terms content not confirmed: {page.url}')
                    continue
                result['terms'].append(page.url)
                candidates.append((page.url, page))
            except CheckError as exc:
                result['issues'].append(str(exc))
        for url, page in candidates:
            for kind, excerpt in policy_signals(page.text):
                if url not in result['terms']:
                    continue  # Only terms/legal documents supply policy evidence.
                result['evidence'].append({'type': kind, 'url': url, 'excerpt': excerpt})
        # AI-specific robots exclusions are recorded separately; never impersonate those agents.
        for url in result['jobs']:
            rules = client.rules(url)
            for agent in ('GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot'):
                allow, evidence, _ = rules['rules'].check(url, agent)
                if not allow:
                    result['evidence'].append({'type': 'ai_robot_block', 'url': rules['url'], 'excerpt': f'{agent}: {evidence}; checked careers URL {url}'})
        denied = any(e['type'] in ('restriction', 'robots_block', 'ai_robot_block') for e in result['evidence'])
        if denied:
            result['status'], result['reason'] = 'Blacklist', 'Restriction detected; excluded by conservative screening policy'
        elif not jobs:
            result['status'], result['reason'] = 'No jobs found', 'No careers link discovered on the supplied homepage'
        elif not result['jobs'] or not result['terms'] or result['issues'] or result['evidence']:
            result['reason'] = 'Missing, ambiguous or incomplete evidence; manual review required'
        else:
            result['status'], result['reason'] = 'Good', 'Careers and terms checked; no restriction detected by the heuristic'
    except Blocked as exc:
        result['status'], result['reason'] = 'Blacklist', str(exc)
    except (CheckError, ValueError, OSError) as exc:
        result['reason'] = str(exc)
    result['robots'] = [{'origin': k, 'url': v['url'], 'status': v['status'], 'text': v['text']} for k, v in client.robots.items()]
    result['requests'] = client.audit
    return result


def write_report(results, directory):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    for status, name in [('Good', 'good'), ('Blacklist', 'blacklist'), ('Review', 'review'), ('No jobs found', 'no-jobs')]:
        with (directory / f'{name}.csv').open('w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['company', 'url', 'status', 'reason', 'jobs', 'terms', 'checked_at'])
            for r in results:
                if r['status'] == status:
                    values = [r['company'], r['url'], status, r['reason'], ' | '.join(r['jobs']), ' | '.join(r['terms']), r['checked_at']]
                    writer.writerow(["'"+v if v.startswith(('=', '+', '-', '@')) else v for v in values])
    esc = html.escape
    cards = []
    for r in results:
        links = lambda urls: ' '.join(f'<a href="{esc(u, quote=True)}" target="_blank" rel="noopener noreferrer">{esc(u)}</a>' for u in urls if urlsplit(u).scheme in ('http', 'https'))
        evidence = ''.join(f'<li><strong>{esc(e["type"])}</strong>: {esc(e["excerpt"])}<br>{links([e["url"]])}</li>' for e in r['evidence'])
        robots = ''.join(f'<details><summary>robots.txt · {esc(x["status"])} · {esc(x["origin"])}</summary><pre>{esc(x["text"] or "No robots file (404/410)")}</pre></details>' for x in r['robots'])
        cards.append(f'<article data-status="{esc(r["status"])}"><span class="badge">{esc(r["status"])}</span><h2>{esc(r["company"])}</h2>{links([r["url"]])}<p>{esc(r["reason"])}</p><dl><dt>Jobs</dt><dd>{links(r["jobs"]) or "Not confirmed"}</dd><dt>Terms</dt><dd>{links(r["terms"]) or "Not confirmed"}</dd></dl><ul>{evidence}</ul><ul>{"".join("<li>"+esc(x)+"</li>" for x in r["issues"])}</ul>{robots}<small>{esc(r["checked_at"])}</small></article>')
    counts = {s: sum(r['status'] == s for r in results) for s in ('Good', 'Blacklist', 'Review', 'No jobs found')}
    buttons = '<button data-filter="All">All</button>' + ''.join(f'<button data-filter="{s}">{s} · {n}</button>' for s, n in counts.items())
    document = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Swiss careers policy scan</title><style>body{background:#101719;color:#e8eeee;font:16px system-ui;max-width:1080px;margin:50px auto;padding:0 24px}h1{font-size:40px}p{line-height:1.6;color:#b8c8cc}a{color:#70decb;overflow-wrap:anywhere}nav{display:flex;gap:10px;flex-wrap:wrap;margin:30px 0}button{background:#223539;color:#fff;border:1px solid #476368;padding:12px;border-radius:8px;cursor:pointer}button[aria-pressed=true]{background:#117f6c}article{border:1px solid #34494d;padding:28px;margin:20px 0;border-radius:14px;background:#182427}article[hidden]{display:none}.badge{float:right;padding:8px;background:#34494d;border-radius:6px}article[data-status=Good] .badge{background:#11654c}article[data-status=Blacklist] .badge{background:#873b42}article[data-status=Review] .badge{background:#775615}dd{margin:8px 0 18px}pre{white-space:pre-wrap;max-height:250px;overflow:auto}li{margin:12px 0;line-height:1.5}small{color:#9faeb0}footer{margin:40px 0}</style><h1>Swiss careers policy scan</h1><p>Does this company have a careers page, and do its published rules restrict automated or AI use?</p><p><strong>Screening only.</strong> Good means no restriction detected, not permission to scrape. Blacklist includes conservative AI-bot exclusions, which may apply to training rather than all crawling. Review means incomplete or ambiguous evidence.</p><nav>BUTTONS</nav>CARDS<footer><a href="good.csv">Good CSV</a> · <a href="blacklist.csv">Blacklist CSV</a> · <a href="review.csv">Review CSV</a> · <a href="no-jobs.csv">No jobs CSV</a> · <a href="results.json">Full evidence JSON</a></footer><script>document.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));document.querySelectorAll('article').forEach(c=>c.hidden=b.dataset.filter!=='All'&&c.dataset.status!==b.dataset.filter)}));</script></html>'''.replace('BUTTONS', buttons).replace('CARDS', ''.join(cards))
    (directory / 'report.html').write_text(document)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', default='sites.csv', help='CSV: company,url,jobs_url,terms_url')
    parser.add_argument('--out', default='output')
    args = parser.parse_args()
    with open(args.input, newline='') as f:
        seeds = list(csv.DictReader(f))
    if not seeds or len(seeds) > 20 or any(not s.get('url') for s in seeds):
        parser.error('Supply 1–20 companies with a url column')
    results = []
    for seed in seeds:
        r = scan(seed)
        results.append(r)
        print(f'{r["company"]}: {r["status"]} — {r["reason"]}', flush=True)
        write_report(results, Path(args.out))
    print(f'Report: {Path(args.out).resolve() / "report.html"}')

if __name__ == '__main__':
    main()
