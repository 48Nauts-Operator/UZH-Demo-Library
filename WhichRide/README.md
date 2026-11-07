# WhichRide

Compare real Swiss public-transport connections with a ranking based on your preferences. The original timetable stays on the left; Jev scores and reorders the same journeys on the right.

This is a German-language demo. It does not book tickets, generate fares or guarantee that a journey will meet your needs.

## What you need

- Node.js 22 or newer and npm. Install a supported release from [nodejs.org](https://nodejs.org/).
- A TypeSafe API key for Jev ranking. Timetable searches work without it.
- Optional: Chrome and Browser Harness for automatic SBB starting-price observations. You can use SBB links without installing either.

The timetable source is the [Swiss Transport API](https://transport.opendata.ch/docs.html). This integration does not require a transport API key, SerpApi account or Google API key.

## Quick start

```bash
git clone https://github.com/48Nauts-Operator/UZH-Demo-Library.git
cd UZH-Demo-Library/WhichRide
npm ci
cp .env.example .env.local
```

On Windows PowerShell, use `Copy-Item .env.example .env.local` for the last command.

Create or sign into your account at [TypeSafe](https://typesafe.ai/), create an API key in the dashboard and check that your account has available API quota or balance. Open `.env.local` in a text editor:

```dotenv
TYPESAFE_API_KEY=your_typesafe_key_here
PORT=3360
HOST=127.0.0.1
JEV_TOTAL_CALL_LIMIT=200
```

Replace the placeholder with your own key, save, and run:

```bash
npm start
```

Open **http://127.0.0.1:3360**. Keep the terminal open; stop with Ctrl+C.

The server loads `.env.local` automatically. Restart after changing it. Exported shell variables take precedence. This library copy does not read your Keychain or another project's credentials. `.env.local`, browser profiles, runtime logs and usage counters are ignored by Git. Only the empty `.env.example` is included.

## Try the demo

1. Choose an origin, destination, date and time, for example Zürich HB to Bern tomorrow morning.
2. Click **Verbindungen zeigen** to load up to eight real connections.
3. Enter a preference such as “Ich möchte unterwegs mindestens 30 Minuten ohne Umsteigen arbeiten.”
4. Click **Für mich sortieren**. Compare the unchanged timetable on the left with Jev's ranking on the right.
5. Open journey details to inspect transfers, walking and uninterrupted travel time. Select Halbtax or full fare before following an SBB link.

Without a TypeSafe key, the timetable remains available and personal ranking reports that it is unavailable. No fake ranking replaces a failed provider call.

## How it works

1. `transport.opendata.ch` supplies station suggestions and live timetable connections.
2. Code calculates duration, transfers, explicit walking sections and uninterrupted train time from those records.
3. Jev receives the available facts and your preference. Each candidate gets a fit Score, evidence/constraint Choice and supporting-fact Choice in one request.
4. Code validates the answers and sorts the original candidates. Known conflicts rank below supported and unknown candidates.
5. The app displays the selected evidence. It does not invent a free-form explanation.

The adapter uses `jev-1.13.0` through TypeSafe's `/v1/systemone` endpoint. Scores range from 0 to 4; they are not probabilities of successful travel. Prices are not inputs to the Jev ranking. Accessibility, lifts, crowding, Wi-Fi, quietness and scenery generally lack evidence in this timetable feed and must not be assumed.

## Optional automatic SBB prices

The core demo only needs Node and your Jev key. Its optional price reader opens a separate desktop Chrome profile and reads displayed SBB starting prices. These are observations of matching connections, not a price API or a cheapest-ticket guarantee.

For the existing desktop reader:

1. Install Google Chrome and Python 3.11+.
2. Install [Browser Harness](https://github.com/browser-use/browser-harness) using its [upstream setup instructions](https://github.com/browser-use/browser-harness/blob/main/install.md). Keep it separate from your normal browser profile. This app supplies a dedicated CDP connection; do not point it at your personal signed-in session.
3. Find the installed executable. On macOS/Linux, run `command -v browser-harness`.
4. Add absolute executable paths to `.env.local` if they differ from the defaults:

```dotenv
SBB_CHROME_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
BROWSER_HARNESS_PATH=/absolute/path/to/browser-harness
```

5. Restart WhichRide, search for connections, and wait for the automatic price check. Keep the desktop browser available.

Default Browser Harness path: `~/.local/bin/browser-harness`. The reader creates its own profile under `.runtime/sbb-browser` and passes a restricted environment to the browser worker. It does not log in or buy tickets.

The inherited reader was used locally with Browser Harness 0.1.8. The current published package is 0.1.13; compatibility with that newer release has not been revalidated for this copy. This optional desktop integration is not a tested headless GitVM setup. If prices are unavailable, use the SBB links. Do not treat historical files under `data/` as current prices.

Only unambiguous matches by scheduled timestamps, first transport line and transfer count receive a fare. Unmatched or disrupted journeys show no confirmed amount. The price reader queues at most four jobs, starts at most twelve per minute, and caches successful observations for two minutes.

## Check your setup

Open http://127.0.0.1:3360/api/health. With a key loaded:

```json
{"ok":true,"jevAvailable":true}
```

This confirms configuration, not key validity or available credit. A real preference-ranking request checks the provider integration and may consume quota.

Troubleshooting:

- **Timetable works, ranking fails:** check your TypeSafe key, quota and model access. Save `.env.local` and restart.
- **Test allowance exhausted:** `JEV_TOTAL_CALL_LIMIT` defaults to 200 cumulative attempts, including failures. The counter is stored in `.runtime/usage.json`. Raise the configured cap deliberately if needed; do not delete the ledger to bypass it.
- **SBB prices unavailable:** check Chrome and Browser Harness paths, desktop availability and upstream page changes. Timetable and Jev ranking can still work.
- **Port in use:** change `PORT` in `.env.local`, restart and open that port.
- **Too many requests:** wait a minute. The app and the shared timetable service both apply limits.
- **Changed key ignored:** check for an exported `TYPESAFE_API_KEY` overriding `.env.local`.

## Tests

```bash
npm test
```

With the app running, use a second terminal:

```bash
npx playwright install chromium
npm run test:browser
```

Alternatively, set `BROWSER_PATH` to an installed Chrome executable. Set `TEST_URL` when testing another port.

The browser check uses real timetable responses but intercepts ranking and fare responses with clearly labelled test fixtures. It spends no Jev credits. It covers both columns, changed preferences, linked highlights, fare settings, stale responses, details, failure states and mobile layouts. It does not establish live Jev inference quality or the optional SBB browser reader's current reliability.

## Privacy and hosting

Travel preferences and timetable facts are sent to TypeSafe when you request a ranking. Searches go to the Transport API, and optional price checks visit SBB. Provider policies apply.

The server defaults to loopback. It stores sessions/results in process memory for about ten minutes; the persistent ledger contains a call count. The browser profile and logs belong to the optional fare reader. Keep them private.

Public hosting needs server-side secrets, HTTPS, a verified runtime and deliberate request budgets. Set `HOST=0.0.0.0` only on an appropriately protected host. `TRUST_PROXY=1` is only for a private origin behind Cloudflare that supplies the client-IP header. Do not expose a Chrome debugging port.

**GitVM status:** the existing guest template has not passed the required vulnerability checks, so this demo has not been deployed there. No live GitVM link is claimed. The automatic price reader also needs a desktop browser environment; Node-only hosting does not provide it.

## Files

- `server.mjs`: HTTP API, provider calls, limits and local configuration loading.
- `src/journeys.mjs`: timetable normalization, Jev questions and result validation.
- `src/fares.mjs`: fare matching, cache and bounded queue.
- `src/fare-browser.mjs` and `scripts/read-sbb-fares.py`: optional desktop reader.
- `public/`: German browser interface and SBB links.
- `data/swiss-cities.json`: starter destination catalogue.
- `test/`: offline checks, including a fresh-checkout startup test.

The source comes from the existing WhichRide demo. Credentials, runtime data and private deployment notes are excluded. See the repository's [MIT license](../LICENSE).
