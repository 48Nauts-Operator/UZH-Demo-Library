Swiss careers policy scanner PoC

Start with HOWTO.html. Included reports can be opened without Python.
Python 3.11+ required to rerun; no third-party dependencies or API key.

python3 demo.py
python3 scanner.py --input sites.csv --out output
python3 -m unittest -v

Local CLI only. Good means no restriction detected, not permission to scrape.
Each run replaces files in its chosen output directory.
