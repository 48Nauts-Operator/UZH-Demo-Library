import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import scanner as s

ROOT = 'https://example.ch/'
BASE_TERMS = 'Terms of use. These conditions apply to visitors of our corporate website. Information about our company and services is provided for general information. Please contact our office with questions about these conditions. Our office is in Switzerland and our contact details are available on this website. '
HOME = '<p>Welcome to our Swiss company. Learn more about our products, our team and our business in Switzerland.</p><a href="/jobs">Careers</a><a href="/terms">Terms</a>'
JOB = '<h1>Open jobs and careers</h1><p>Join our team in Switzerland. Explore open roles in engineering and customer support. Contact our recruiting team for further details about current opportunities.</p>'

class FixtureClient:
    def __init__(self, terms=BASE_TERMS, robots='', home=HOME):
        self.pages = {ROOT: home, ROOT+'jobs': JOB, ROOT+'terms': terms}
        self.robots = {'https://example.ch': {'url': ROOT+'robots.txt', 'status': 'fetched', 'text': robots, 'rules': s.Robots(robots)}}
        self.audit = []

    def rules(self, url):
        return self.robots['https://example.ch']

    def fetch(self, url):
        allowed, why, _ = self.rules(url)['rules'].check(url)
        if not allowed:
            raise s.Blocked(why)
        if url not in self.pages:
            raise s.CheckError('Fixture missing')
        self.audit.append({'url': url, 'http_status': 200, 'sha256': 'synthetic-fixture'})
        return s.Page(self.pages[url], url)


def fixture(label, client):
    return s.scan({'company': 'DEMO · '+label, 'url': ROOT}, client)

class ScannerTests(unittest.TestCase):
    def test_good(self):
        self.assertEqual(fixture('clear', FixtureClient())['status'], 'Good')

    def test_restriction_languages(self):
        for text in ['Automated scraping is prohibited.', 'Automatisierter Zugriff ist nicht gestattet.', 'Le scraping est interdit.', 'Lo scraping è vietato.']:
            with self.subTest(text=text):
                self.assertEqual(fixture('deny', FixtureClient(BASE_TERMS+text))['status'], 'Blacklist')

    def test_unrelated_ai_is_review(self):
        self.assertEqual(fixture('AI mentioned', FixtureClient(BASE_TERMS+'We use artificial intelligence to improve our services.'))['status'], 'Review')

    def test_homepage_news_is_not_policy(self):
        c=FixtureClient(home=HOME+'<div>Network ban was not allowed.</div><div>KI news from our magazine.</div>')
        self.assertEqual(fixture('news', c)['status'], 'Good')

    def test_missing_terms_is_review(self):
        self.assertEqual(fixture('no terms', FixtureClient(home=HOME.replace('<a href="/terms">Terms</a>', '')))['status'], 'Review')

    def test_no_jobs(self):
        self.assertEqual(fixture('no careers', FixtureClient(home=HOME.replace('<a href="/jobs">Careers</a>', '')))['status'], 'No jobs found')

    def test_ai_specific_block(self):
        self.assertEqual(fixture('AI block', FixtureClient(robots='User-agent: GPTBot\nDisallow: /jobs'))['status'], 'Blacklist')

    def test_job_block_prevents_fetch(self):
        c = FixtureClient(robots='User-agent: *\nDisallow: /jobs')
        self.assertEqual(fixture('blocked', c)['status'], 'Blacklist')
        self.assertNotIn(ROOT+'jobs', [a['url'] for a in c.audit])

    def test_external_ats_review(self):
        r = fixture('ATS', FixtureClient(home=HOME.replace('/jobs', 'https://ats.example.com/jobs')))
        self.assertEqual(r['status'], 'Review')
        self.assertTrue(any('External careers' in x for x in r['issues']))

    def test_robots_specific_and_longest(self):
        r = s.Robots('User-agent: *\nDisallow: /\nAllow: /jobs\nDisallow: /jobs/private\nUser-agent: SwissJobsPolicyCheck\nAllow: /')
        self.assertTrue(r.check(ROOT+'jobs/private')[0])
        self.assertFalse(r.check(ROOT+'jobs/private', 'OtherBot')[0])
        self.assertTrue(r.check(ROOT+'jobs', 'OtherBot')[0])

    def test_robots_merge_tie_wildcard_end(self):
        r = s.Robots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /jobs\nUser-agent: *\nAllow: /jobs')
        self.assertTrue(r.check(ROOT+'jobs')[0])
        self.assertFalse(r.check(ROOT+'terms.pdf')[0])
        self.assertTrue(r.check(ROOT+'terms.pdf/view')[0])

    def test_robots_empty_specific(self):
        r=s.Robots('User-agent: *\nDisallow: /\nUser-agent: SwissJobsPolicyCheck')
        self.assertTrue(r.check(ROOT)[0])

    def test_encoding(self):
        r = s.Robots('User-agent: *\nDisallow: /caf%C3%A9\nDisallow: /~private')
        self.assertFalse(r.check(ROOT+'café')[0])
        self.assertFalse(r.check(ROOT+'%7Eprivate')[0])

    def test_delay(self):
        r = s.Robots('User-agent: *\nCrawl-delay: 4\nAllow: /')
        self.assertEqual(r.check(ROOT)[2], 4)

    def test_public_destination_checks(self):
        for url in ['http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/']:
            with self.assertRaises(s.CheckError):
                s.public_host(url)
        for url in ['file:///etc/passwd', 'http://user:pass@example.ch/', 'http://example.ch:8090/']:
            with self.assertRaises(s.CheckError):
                s.normalize(url)

    @patch('scanner.public_host')
    def test_redirect_rechecks_robots(self, _):
        c=s.Client()
        responses={ROOT+'robots.txt':(200,'User-agent: *\nAllow: /',{}), ROOT:(302,'',{'Location':'https://careers.example.ch/jobs'}), 'https://careers.example.ch/robots.txt':(200,'User-agent: *\nDisallow: /',{})}
        calls=[]
        def raw(url, delay=1):
            calls.append(url)
            return responses[url]
        c.raw=raw
        with self.assertRaises(s.Blocked):
            c.fetch(ROOT)
        self.assertNotIn('https://careers.example.ch/jobs', calls)

    def test_unavailable_robots(self):
        c=s.Client()
        c.raw=lambda url,delay=1:(503,'down',{})
        with self.assertRaises(s.CheckError):
            c.fetch(ROOT)

    def test_missing_robots(self):
        c=s.Client()
        c.raw=lambda url,delay=1:(404,'not found',{})
        self.assertEqual(c.rules(ROOT)['status'], 'missing')

    def test_unsafe_html_escaped_and_exports(self):
        r=fixture('<script>alert(1)</script>', FixtureClient())
        with tempfile.TemporaryDirectory() as d:
            s.write_report([r], Path(d))
            output=(Path(d)/'report.html').read_text()
            self.assertNotIn('<script>alert(1)</script>', output)
            self.assertIn('&lt;script&gt;', output)
            self.assertEqual(len(list(Path(d).glob('*.csv'))), 4)

if __name__ == '__main__':
    unittest.main()
