# TimeLedger

A private, offline-first time and earnings ledger for one person. The app uses vanilla JavaScript, IndexedDB and a service worker. All application files are bundled. There is no build step, account, analytics or third-party runtime dependency.

## Run and install

1. The deployable app lives in `docs/`. Keep its files together.
2. Serve that folder from an HTTPS static host. For local development, run `python3 -m http.server 8000 --directory docs` and open `http://localhost:8000` on the same computer.
3. On iPhone, open the HTTPS address in Safari. Tap **Share → Add to Home Screen**, enable **Open as Web App** if offered, then tap **Add**.
4. Launch the Home Screen app online once. Open **Settings** and look for **App files cached for offline use**. Switch on Airplane Mode, close and reopen the app, then try a timer.
5. Create your first project and company, or choose **Explore the example workspace**. The example uses a separate database and starts its sample day at 14:32. Open **Personal workspace** from the workspace menu to return to your own records.

Opening `index.html` directly from iPhone Files does not provide reliable installation, module loading, IndexedDB persistence or service-worker caching. Use the HTTPS address. Keep the same host, browser profile and installed app for your records. Safari and an installed app may use different storage.

**Cloudflare Pages.** In Workers & Pages, create a Pages application and choose the drag-and-drop / Direct Upload option. Upload the **contents of `docs/`** with `index.html` at the root. Deploy and open the HTTPS address. [Cloudflare instructions](https://developers.cloudflare.com/pages/get-started/direct-upload/)

**GitHub Pages.** In **Settings → Pages**, select **Deploy from a branch**, then **main** and **/docs**. Save and open the published HTTPS URL. All asset paths are relative, including on a project subpath. [GitHub instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

[Apple’s iPhone installation guide](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)

## Track and review

- **Today.** Pin and reorder shortcuts with **Manage**. Tap a running project to focus it. A paused or stopped shortcut offers resume/start with focus. Use its overflow menu for timer-only actions, clearing focus or editing. Pausing and stopping the focused project clear focus. Ending one session leaves every other timer alone.
- **Timesheet.** Add or edit entries, breaks, notes, reporting status, invoice reference and rate. Enter an explicit finish date for multi-day work. For a manual break, you can supply its date and time. A duration alone places the break at the end of the session. Manual entries have no recorded focus. Use the daylight-saving options for ambiguous repeated local times.
- **Billing.** New work begins unreviewed and non-billable. Select **Billable work**, approve the reportable minutes, and check the snapshotted rate. Changing minutes or status preserves the raw working intervals. A paid status can include a separately entered confirmed amount and payment date.
- **Reports.** Filter completed work, review overlapping sessions and export CSV or print. The print dialog on iPhone can be used to save or share a PDF. Overlap review includes other projects outside the filter. A zero reportable value explicitly excludes that session’s hours from billing. Exports use the portion inside the selected dates. Printing or downloading a report does not mark work submitted, invoiced or paid.
- **Goals.** Edit recurring defaults or override one period, including future periods. Blank hours and earnings independently clear those targets. Recurring changes take effect at the beginning of the chosen period. Settings control week start, the hours basis, goal currency and rounding of reportable suggestions.

## What the totals mean

Working intervals use exact timestamps and half-open boundaries. Total project time sums every working segment. Unique clock time uses their union. Overlap excess is total project time minus unique clock time. Two projects working 09:00–12:00 and 10:00–13:00 therefore produce 6 project hours, 4 unique hours and 2 hours of excess.

Earnings use approved billable duration and the entry’s recorded rate. Money is calculated in integer minor units. Across period boundaries the app distributes reviewed time and money by the portion of actual working time in each window. Cumulative allocation reconciles adjacent ranges to the full entry. Displayed minutes are abbreviated, while CSV includes fractional hours and UTC timestamps. Currency totals remain separate. Goals show the selected currency only. A missing rate marks the estimate incomplete. Invoiced figures include paid invoices. Confirmed receipts use the payment date.

Open sessions count toward live hours. They enter the timesheet when stopped. Company and project names are linked by stable IDs, and rates are captured per entry. The initial rate acts as the historical default. Later changes apply from the time of editing. You can correct a retrospective entry’s recorded rate explicitly.

## Back up and restore

Use **Settings → Backup & restore → Download JSON backup** and save it outside the app, for example in iCloud Drive or on another device. The backup contains your full ledger, including open timers, focus, rates, goals, payments, review changes and report batches. Treat it as sensitive financial information. The last-backup date records when a download was requested. Check the saved file in Files.

To restore, choose a JSON file, check the record counts, then explicitly select **Merge records** or **Replace all data**. Merge keeps local settings and adds records with new IDs. A conflicting record, invalid reference or overlapping focus history rejects the entire merge. Replace restores the backup’s complete dataset and settings after confirmation. Back up before replacing data, changing host, removing the app or clearing Safari data.

Timers save timestamps on each action and reconstruct elapsed time after a restart. They need no background tick. Device clock changes can alter elapsed time. Correct the device clock before making another transition, then review the completed timeline. Reports group timestamps in the device’s current local time zone. Local storage can be lost to device loss, deletion or storage pressure. [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)

## Tests

From the project root, run **`node --test tests/*.test.mjs`** with Node 22 or newer. The deterministic suite covers timers, focus, overlap, DST, calendar goals, billing, allocations, exports, validation, backup merge, persistence transactions and the service-worker cache path.

The separate browser acceptance suite uses an isolated local HTTP server and temporary Chromium profile. Install Python 3, the Playwright Python package and its Chromium browser (`python3 -m playwright install chromium`), then run **`python3 tests/browser_test.py`**. You can also set `CHROMIUM_PATH` to a local Chromium executable. It exercises the real UI, IndexedDB, downloads and a cold browser restart with the server shut down and networking disabled. A physical iPhone remains the final check for Safari installation and native share/print dialogs.

For an app update, keep the existing origin and increase the cache version in `docs/sw.js`. Keep the asset list in sync with the app. Close other app windows and reopen online to activate the new worker. Updating the app shell leaves the IndexedDB ledger in place.
