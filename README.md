# TimeLedger

[Open TimeLedger](https://kawncodes.github.io/timeledger/)

A private, offline-first time and earnings ledger for one person. The app uses vanilla JavaScript, IndexedDB and a service worker. All application files are bundled. There is no build step, analytics or third-party runtime dependency. An optional account syncs an encrypted copy of the ledger between devices through a small server you deploy yourself (see **Account & sync**).

## Run and install

1. The deployable app lives in `docs/`. Keep its files together.
2. Serve that folder from an HTTPS static host. For local development, run `python3 -m http.server 8000 --directory docs` and open `http://localhost:8000` on the same computer.
3. On iPhone, open the HTTPS address in Safari. Tap **Share → Add to Home Screen**, enable **Open as Web App** if offered, then tap **Add**.
4. Launch the Home Screen app online once. Open **Settings** and look for **App files cached for offline use**. Switch on Airplane Mode, close and reopen the app, then try a timer.
5. Create your first project and company, or choose **Explore the example workspace**. The example uses a separate database and starts its sample day at 14:32. Open **Personal workspace** from the workspace menu to return to your own records.

Opening `index.html` directly from iPhone Files does not provide reliable installation, module loading, IndexedDB persistence or service-worker caching. Use the HTTPS address. Keep the same host, browser profile and installed app for your records. Safari and an installed app may use different storage.

**Cloudflare Pages.** In Workers & Pages, create a Pages application and choose the drag-and-drop / Direct Upload option. Upload the **contents of `docs/`** with `index.html` at the root. Deploy and open the HTTPS address. [Cloudflare instructions](https://developers.cloudflare.com/pages/get-started/direct-upload/)

**GitHub Pages.** This repository publishes the root of the `gh-pages` branch. Source and tests are on `main`. To publish a new release, update `gh-pages` with the contents of `main`’s `docs/` folder, including `.nojekyll`.

For a separate deployment that follows `main` directly, go to **Settings → Pages**, select **Deploy from a branch**, then **main** and **/docs**. Save and open the published HTTPS URL. All asset paths are relative, including on a project subpath. [GitHub instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

[Apple’s iPhone installation guide](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)

## Track and review

- **Today.** Pin and reorder shortcuts with **Manage**. Tap a running project to focus it. A paused or stopped shortcut offers resume/start with focus. Use its overflow menu for timer-only actions, clearing focus or editing. Pausing and stopping the focused project clear focus. Ending one session leaves every other timer alone.
- **Timesheet.** Add or edit entries, breaks, notes, reporting status, invoice reference and rate. Enter an explicit finish date for multi-day work. For a manual break, you can supply its date and time. A duration alone places the break at the end of the session. Manual entries have no recorded focus. Use the daylight-saving options for ambiguous repeated local times.
- **Billing.** New work begins unreviewed and non-billable. Select **Billable work**, approve the reportable minutes, and check the snapshotted rate. Changing minutes or status preserves the raw working intervals. A paid status can include a separately entered confirmed amount and payment date.
- **Reports.** Filter completed work, review overlapping sessions and export CSV or print. The print dialog on iPhone can be used to save or share a PDF. Overlap review includes other projects outside the filter. A zero reportable value explicitly excludes that session’s hours from billing. Exports use the portion inside the selected dates. Printing or downloading a report does not mark work submitted, invoiced or paid.
- **Goals.** Edit recurring defaults or override one period, including future periods. Blank hours and earnings independently clear those targets. Recurring changes take effect at the beginning of the chosen period. Settings control week start, the hours basis, goal currency and rounding of reportable suggestions.

## Goals, levels and streaks

- **Goals page.** Day, week, month and year progress rings for hours and earnings, edited inline (every period from now, or this period only). **Plan another period** sets targets for a future or past date. Week, month and year cards show the pace forecast and what you need per remaining work day.
- **Client & project targets.** Hours and/or earnings per company or project per period, in that client's currency.
- **Activity and history.** A 26-week heatmap of hours or earnings, and hit/miss chips for recent weeks and months.
- **XP and levels.** 10 XP per worked hour, 5 per focus hour, 1 per €10 earned (unreviewed work counts at its rate), 50/150/500/2,000 for hitting a day/week/month/year goal, 100 per achievement. Everything is recomputed from the ledger, so it's identical on every synced device and doesn't depend on the goal currency.
- **Streaks.** Consecutive days with at least 30 minutes of work, or with the daily goal hit (Settings). Weekends without work don't break a streak unless you turn that off.
- **Live earnings.** While a timer runs, Today shows money counting up, with a coin sound every 10 units of the goal currency.
- **Sound and celebrations.** Timer actions, coins, goals, achievements and level-ups have short sounds synthesised in the browser (no audio files, works offline); mute from the player card or Settings. Goals, achievements and level-ups get confetti once per device. Animations respect the system's reduced-motion setting.

## What the totals mean

Working intervals use exact timestamps and half-open boundaries. Total project time sums every working segment. Unique clock time uses their union. Overlap excess is total project time minus unique clock time. Two projects working 09:00–12:00 and 10:00–13:00 therefore produce 6 project hours, 4 unique hours and 2 hours of excess.

Earnings use approved billable duration and the entry’s recorded rate. Money is calculated in integer minor units. Across period boundaries the app distributes reviewed time and money by the portion of actual working time in each window. Cumulative allocation reconciles adjacent ranges to the full entry. Displayed minutes are abbreviated, while CSV includes fractional hours and UTC timestamps. Per-currency totals stay separate in reports, and the overview, goals and the report's "Estimated total" combine every currency in the goal currency using the stored exchange rates. Changing the goal currency converts the totals instead of resetting them; a goal saved in another currency is converted too. Rates load from the European Central Bank reference feed (frankfurter.dev) at most twice a day when online, fall back to approximate built-in rates, and can be entered manually under **Settings → Exchange rates**. Conversion uses current rates, not the rate on the day of the work. A missing rate marks the estimate incomplete. Invoiced figures include paid invoices. Confirmed receipts use the payment date.

Open sessions count toward live hours. They enter the timesheet when stopped. Company and project names are linked by stable IDs, and rates are captured per entry. The initial rate acts as the historical default. Later changes apply from the time of editing. You can correct a retrospective entry’s recorded rate explicitly.

## Account & sync

Open **Settings → Account & sync** to create an account or sign in. If both the account and this device already hold records, you choose:

- **Merge both** keeps the records from each side.
- **Replace this device with the account** discards this device's records.
- **Replace the account with this device** overwrites the account copy.

After that, changes sync automatically when the app is open and online (on every change, when the app comes to the foreground and every minute). Deletions travel between devices. If the same record changes on two devices before they sync, the higher revision wins. Appearance, overview period and the last-backup date stay per device.

The password never leaves the device. PBKDF2 (310,000 rounds) derives a login key for the server and a separate AES-GCM key that encrypts the whole ledger before upload, so the server only stores ciphertext. A forgotten password cannot be reset: the account copy is unreadable, but each device keeps its own records, and you can create a new account from one of them.

### Deploy the sync server (Cloudflare Workers, free tier)

The server lives in `server/`. It uses a Cloudflare Worker and a D1 database.

```bash
cd server
npx wrangler login
npx wrangler d1 create timeledger      # copy the database_id into wrangler.toml
npx wrangler d1 execute timeledger --remote --file=schema.sql
npx wrangler deploy                    # prints https://timeledger-sync.<you>.workers.dev
```

Set `ALLOWED_ORIGINS` in `wrangler.toml` to your app's origin (for example `https://kawncodes.github.io`) and deploy again. Put the Worker address in `docs/config.mjs` so it is filled in on the sign-in form, or type it there each time.

To self-host instead, run `node server/node.mjs 8787 /path/to/timeledger-sync.db` (Node 22.13+, no dependencies) behind HTTPS. It serves the same API with SQLite.

## Back up and restore

Use **Settings → Backup & restore → Download JSON backup** and save it outside the app, for example in iCloud Drive or on another device. The backup contains your full ledger, including open timers, focus, rates, goals, payments, review changes and report batches. Treat it as sensitive financial information. The last-backup date records when a download was requested. Check the saved file in Files.

To restore, choose a JSON file, check the record counts, then explicitly select **Merge records** or **Replace all data**. Merge keeps local settings and adds records with new IDs. A conflicting record, invalid reference or overlapping focus history rejects the entire merge. Replace restores the backup’s complete dataset and settings after confirmation. Back up before replacing data, changing host, removing the app or clearing Safari data.

Timers save timestamps on each action and reconstruct elapsed time after a restart. They need no background tick. Device clock changes can alter elapsed time. Correct the device clock before making another transition, then review the completed timeline. Reports group timestamps in the device’s current local time zone. Local storage can be lost to device loss, deletion or storage pressure. [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)

## Tests

From the project root, run **`node --test tests/*.test.mjs`** with Node 22.13 or newer. The deterministic suite covers XP, streaks, goal hits, pace and targets, currency conversion, account sync (against the real server code with SQLite), three-way merge, timers, focus, overlap, DST, calendar goals, billing, allocations, exports, validation, backup merge, persistence transactions and the service-worker cache path.

The separate browser acceptance suite uses an isolated local HTTP server and temporary Chromium profile. Install Python 3, the Playwright Python package and its Chromium browser (`python3 -m playwright install chromium`), then run **`python3 tests/browser_test.py`**. You can also set `CHROMIUM_PATH` to a local Chromium executable. It exercises the real UI, IndexedDB, downloads and a cold browser restart with the server shut down and networking disabled. A physical iPhone remains the final check for Safari installation and native share/print dialogs.

For an app update, keep the existing origin and increase the cache version in `docs/sw.js`. Keep the asset list in sync with the app. Close other app windows and reopen online to activate the new worker. Updating the app shell leaves the IndexedDB ledger in place.
