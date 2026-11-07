# Job-Scraper-Tooling

A small local proof of concept for checking company websites before collecting job data. It finds careers pages, reads linked terms/legal pages, checks `robots.txt`, and produces Good, Blacklist and Review lists with supporting evidence. Sites without a discovered careers link get a separate list.

This is a policy-screening tool. It does not download individual job listings or applicant data. **Good means no restriction detected, not permission to scrape.**

## Install

Requirements: Git and Python 3.11 or newer. Tested with Python 3.14.5 on macOS. No third-party Python packages, API keys or model accounts are needed.

```bash
git clone https://github.com/48Nauts-Operator/UZH-Demo-Library.git
cd UZH-Demo-Library/Job-Scraper-Tooling
python3 --version
```

If Python is missing, install a supported Python 3 release from [python.org](https://www.python.org/downloads/). On Windows, use `py -3` instead of `python3` if that is your installed Python launcher.

## Try it without network requests

```bash
python3 demo.py
```

Open `demo-output/report.html` in your browser. On macOS:

```bash
open demo-output/report.html
```

The five synthetic examples demonstrate all four outcomes. They are labelled DEMO and are not findings about real companies. Reports are also included, so you can inspect them without running Python.

## Scan company websites

Edit `sites.csv`. Keep these headers:

```csv
company,url,jobs_url,terms_url
Example company,https://www.example.ch/,,
```

Replace the illustrative URL with a company website. Supply 1–20 rows per run. `jobs_url` and `terms_url` are optional hints: paste exact URLs when navigation hides them or the scanner cannot discover them. Quote fields containing commas.

Use corporate homepages where possible. A consumer shop homepage may not link to careers. The supplied list defines the Swiss scope; the tool does not verify company domicile or search every Swiss website.

```bash
python3 scanner.py --input sites.csv --out output
```

Open `output/report.html`. The scanner prints each result and saves the report after each company. Use a new output directory to retain previous runs:

```bash
python3 scanner.py --input sites.csv --out scans/2026-11-07
```

Reusing an output directory replaces its report and exports.

## How it works

1. Validate the supplied HTTP(S) address and reject private/reserved destinations and nonstandard ports.
2. Fetch the origin's `robots.txt` before the homepage or any other page. Recheck robots on redirect destinations.
3. Discover careers and legal links from the homepage, then legal links on careers pages. URL hints supplement this discovery.
4. Match English, German, French and Italian wording about scraping, automated access, AI and data mining in confirmed terms/legal pages. Save the matched excerpts and URLs.
5. Check robots rules for the actual `SwissJobsPolicyCheck` user agent. Separately evaluate careers-path exclusions for GPTBot, ClaudeBot, Google-Extended and CCBot, without impersonating those bots.
6. Write the decision, reasons, evidence and timestamp to HTML, CSV and JSON.

This version uses keyword rules, not an AI model. News articles and ordinary job descriptions are not treated as policy documents.

## Decision rules

- **Good:** a company-hosted careers page and a terms/legal page were confirmed; no matched restriction, ambiguity or unresolved fetch issue remains.
- **Blacklist:** restrictive terms matched, robots blocks the homepage/careers path, or a checked AI bot is excluded from a careers path. The evidence identifies the reason.
- **Review:** missing or ambiguous terms, inaccessible documents, external careers providers, unsupported formats, network failures or exhausted scan limits.
- **No jobs found:** no careers link was discovered on the supplied page. This does not establish that the company has no vacancies.

AI-bot exclusions may concern training rather than ordinary job indexing. This PoC conservatively blacklists them for review. A blacklist entry is the tool's screening decision, not a legal finding.

A missing robots file with HTTP 404/410 allows checking to continue. HTTP 401/403 on robots becomes a conservative block. Other robots failures require review. As [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html) explains, robots rules are not access authorization.

## Output files

- `report.html`: browser report with status filters and evidence links.
- `good.csv`: sites with no restriction detected.
- `blacklist.csv`: sites excluded by the screening rules.
- `review.csv`: incomplete or ambiguous checks.
- `no-jobs.csv`: sites without a discovered careers link.
- `results.json`: full results, timestamps, source URLs, HTTP statuses, response hashes, robots text and matched excerpts.

Full copies of terms documents are not retained. The bundled `live-output/` is a historical sample from 6 November 2026, not a current approval list. It classified Swisscom as Review because no terms page was confirmed and Galaxus as Good under the heuristic. Recheck before relying on any result.

## Limits

- At most three careers candidates, five legal candidates and 30 requests per company.
- At most 1 MB per response, with a 12-second socket timeout. There is no whole-run deadline.
- At least one second between requests per origin. Crawl delays up to ten seconds are honoured; longer delays and request-rate directives require review.
- No JavaScript rendering, PDF extraction, authentication, CAPTCHA solving, proxy rotation or access-control bypass.
- External ATS links require review. Same-host/subdomain matching is a hostname heuristic, not proof of company ownership. Redirected external pages can be fetched after public-host and robots checks, then are flagged for ownership review.
- Keyword matching can miss indirect restrictions, negation, linked policies and unsupported languages. It can also flag unrelated wording. Human review remains necessary.
- Robots matching covers groups, precedence, wildcards, end anchors and percent-encoded paths. It is not a claim of full RFC conformance or support for every custom AI directive.
- This is a local CLI, not a hardened public fetch API. DNS checks do not pin subsequent connections against DNS rebinding.

## Tests

```bash
python3 -m unittest -v
```

The 19 tests cover classifications, multilingual restrictions, irrelevant AI news, missing terms, external ATS links, robots precedence and redirect enforcement, private addresses and report escaping. They run offline.

The included reports were also exercised in a browser: filters returned expected counts and export links worked. No production deployment is claimed.

## Files and next steps

- `scanner.py`: fetching, discovery, policy matching, decisions and report generation.
- `test_scanner.py`: tests and synthetic fixtures.
- `demo.py`: offline example report.
- `sites.csv`: editable input with two real Swiss companies.
- `HOWTO.html`: standalone browser guide.

To improve coverage, add a test fixture for the new policy wording before changing a matcher. A larger version could add human acceptance records and semantic review of uncertain clauses while retaining the original evidence.

See the repository's [MIT license](../LICENSE).
