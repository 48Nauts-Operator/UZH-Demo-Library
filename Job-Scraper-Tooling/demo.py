"""Offline demonstration with explicitly synthetic companies, no network calls."""
from pathlib import Path
from scanner import write_report
from test_scanner import fixture, FixtureClient, BASE_TERMS, HOME

results = [
    fixture('Careers + clear terms', FixtureClient()),
    fixture('Scraping prohibited', FixtureClient(BASE_TERMS+'Automated scraping is prohibited.')),
    fixture('AI robot excluded', FixtureClient(robots='User-agent: GPTBot\nDisallow: /')),
    fixture('Terms missing', FixtureClient(home=HOME.replace('<a href="/terms">Terms</a>', ''))),
    fixture('No careers link', FixtureClient(home=HOME.replace('<a href="/jobs">Careers</a>', ''))),
]
write_report(results, Path('demo-output'))
print('Offline demo ready: demo-output/report.html')
