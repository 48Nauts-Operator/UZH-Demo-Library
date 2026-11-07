# WhichFlight

Describe a trip in German or English and compare real flight quotes in CHF. Jev converts your request into structured search fields. Code validates those fields, queries flight data and sorts the results. Jev does not invent prices or decide which flight you must buy.

## What you need

- Node.js 22 or newer and npm. Install a supported release from [nodejs.org](https://nodejs.org/).
- A **TypeSafe API key** for Jev to interpret natural-language requests.
- A **SerpApi API key** for flight searches and booking-option lookups.

The flight provider is [SerpApi's Google Flights API](https://serpapi.com/google-flights-api). It is a hosted API service, not an open-source flight engine. You register with SerpApi; this app does not use a Google Cloud API key. No flight booking account is needed to run searches.

## 1. Get the keys

### Jev / TypeSafe

1. Open [TypeSafe](https://typesafe.ai/) and create or sign into your account.
2. Create an API key in the account dashboard and make sure the account has API access and sufficient balance or quota.
3. Put that key in `TYPESAFE_API_KEY` below.

The adapter uses TypeSafe's `/v1/systemone` endpoint with model `jev-1.13.0`. See the [TypeSafe API documentation](https://docs.typesafe.ai/api) for current account access and model availability. No free credit amount is assumed.

### Flight data / SerpApi

1. Register at [SerpApi](https://serpapi.com/users/sign_up).
2. Open your [API key dashboard](https://serpapi.com/manage-api-key) and copy the private API key.
3. Confirm your account has enough search quota for the [Google Flights API](https://serpapi.com/google-flights-api).
4. Put the key in `SERP_API_KEY` below.

Provider plans and quotas can change. Check your account before the demo. A return-trip search can make up to four flight-data requests; opening booking offers may make another. Provider caching and billing rules also apply.

## 2. Install and configure

```bash
git clone https://github.com/48Nauts-Operator/UZH-Demo-Library.git
cd UZH-Demo-Library/WhichFlight
npm ci
cp .env.example .env.local
```

On Windows PowerShell, use `Copy-Item .env.example .env.local` for the last command.

Open `.env.local` in a text editor and fill in the two values:

```dotenv
SERP_API_KEY=your_serpapi_key_here
TYPESAFE_API_KEY=your_typesafe_key_here
PORT=3361
HOST=127.0.0.1
SERP_MONTHLY_RESERVE=25
FLIGHT_TOTAL_CALL_LIMIT=100
JEV_TOTAL_CALL_LIMIT=100
```

Replace the placeholders with your own keys, save, then start:

```bash
npm start
```

Open **http://127.0.0.1:3361**. Keep the terminal open. Stop with Ctrl+C.

The server loads `.env.local` automatically. Restart after editing it. Existing shell environment variables take precedence. Keys stay on the server and `.env.local` is ignored by Git. This library copy does not read another project's env file or your macOS Keychain.

## 3. Try a search

Enter a request such as:

> Zürich nach London, nächster Freitag, eine Person, nur Direktflüge, Ankunft vor 10 Uhr, maximal 400 CHF.

Check the interpreted route and dates before relying on the result. You can correct them in the detailed fields. Use a future date. Structured search works without Jev, but real flight prices always require the SerpApi key.

Results show prices, duration, transfers, airlines and available booking offers. Return-trip cards show the whole-trip quote; the app does not add the outward quote again. Booking happens on the external provider's site, never inside WhichFlight.

## 4. Check your setup

Open http://127.0.0.1:3361/api/health. With both keys present it returns:

```json
{"ok":true,"faresAvailable":true,"jevAvailable":true}
```

These flags confirm that keys were loaded. They do not validate credentials, quota or model access. Run one real search to check those integrations; that can consume provider quota.

Common issues:

- **Prices are not configured:** check `SERP_API_KEY`, save `.env.local`, restart.
- **Text input is unavailable:** check `TYPESAFE_API_KEY`, account access and balance. Try the detailed fields to separate flight-data setup from Jev setup.
- **Quota exhausted:** the app preserves the last 25 SerpApi searches by default. If your account has 25 or fewer left, add quota or deliberately lower `SERP_MONTHLY_RESERVE`. Application caps also persist in `.runtime/usage.json`; raise the configured limit if you intend to extend use. Do not delete the ledger to bypass it.
- **Port already in use:** change `PORT` in `.env.local`, restart and open that port.
- **No matching flights:** try another date or remove constraints. There is no invented fallback fare.
- **Changed keys have no effect:** stop the old process and check for exported shell variables overriding the file.

## How the demo works

1. Jev answers typed Choice questions about route, dates, travellers, baggage and time constraints.
2. Code validates answers against known airport/date candidates and exposes uncertain inputs for correction.
3. SerpApi supplies Google Flights results. Code filters, deduplicates and sorts real quotes.
4. Booking options are fetched on demand. No booking or payment is made by this app.

Supported scope includes one-way and return trips, economy, 1–6 travellers aged two or older, a bounded airport catalogue, nonstop filters, cabin baggage and time/budget constraints. Checked baggage costs can be unknown. Return searches complete the three cheapest matching outward candidates, not every possible combination. Results are not a promise of the cheapest available ticket.

## Daily search limit

`DAILY_SEARCH_LIMIT=100` allows at most 100 submitted search attempts per app per Zurich calendar day, shared across all visitors. You may lower it to an integer from 1 to 100. Once exhausted, the server returns HTTP 429 before calling the search/model provider. Failed admitted attempts count; restarting the app does not reset usage.

The counter resets when the next request arrives after midnight in `Europe/Zurich`, including daylight-saving changes. It is stored in `.runtime/daily-usage.json`. Preserve the entire `.runtime` directory when deploying or restarting. This file-based limiter supports one server process per app; replicas require shared transactional storage.

Both apps import `../shared/daily-limit.mjs`. Clone the whole repository and retain the sibling `shared/` folder when packaging an app.

Existing provider quotas, per-IP limits and cumulative API-call caps still apply and can stop requests earlier. The daily search limit is not a provider billing limit. A WhichFlight return search can use multiple flight API requests; booking lookups are separate.

## Tests

```bash
npm test
```

With the local server running, run the browser checks in another terminal:

```bash
npm run test:browser
```

The browser script defaults to installed Chrome on macOS. Set `BROWSER_PATH` to your Chromium/Chrome executable on another system and `TEST_URL` if using another port. It intercepts search and booking responses with test fixtures, so it makes no paid provider calls. Unit and browser tests do not replace a live account check.

## Optional presentation QR and public event mode

Open `/try` on the running app for a QR presentation page. A localhost QR only works on the same computer. Students need a reachable hosted URL to use it on their phones.

For a temporary public session on your own laptop, the included `npm run event` launcher requires a connected Tailscale installation with Funnel access. It reads `.env.local`, starts the app and enables a public listener. **This exposes your demo and lets visitors consume your API quota.** It is optional; normal local use needs no Tailscale. Keep the terminal open and use Ctrl+C to stop the launcher-owned server/listener. Public event networking is not part of the local setup verification.

## Storage and limits

- Loopback-only by default. Set `HOST` deliberately when hosting.
- Up to three concurrent searches and eight searches per IP per minute.
- Persistent caps default to 100 flight requests and 100 Jev attempts. Failed attempts count. These are call limits, not currency spending limits.
- Search sessions are held in memory for about 15 minutes; interpreted text for about 10 minutes. Provider responses use an ignored five-minute disk cache in `.runtime/`.
- Quotes can already be cached by the upstream provider. Displayed timestamps reflect the provider data.
- Your travel request goes to TypeSafe for interpretation; structured travel fields go to SerpApi. Provider retention rules apply.

Source is based on the existing WhichFlight demo. Local credentials, caches, usage ledgers and private deployment notes are not included. See the repository's [MIT license](../LICENSE).
