# BBO Timesheet API — Discovery (confirmed live 2026-06-15)

Vanity: `provisionsgroup` → `https://provisionsgroup.bbo.bullhornstaffing.com`. Assignment `6599` (single assignment for this user). Week is Sunday→Saturday.

## Auth
- `POST /Login/` form `{process:login, flashEnabled:true, username, password, rememberMe:''}` → sets session cookies, redirects to `/employee/?authenticationKey=<HEX>` (the hex key is **one-time** — reusing it on reload logs you out).
- The landing `/employee/` page exposes the JWT as `window.SESSION_AUTHENTICATION_KEY = "eyJ..."`. All PHP API calls take `authenticationKey=<JWT>`.
- **JWT rotates**: every PHP response includes a fresh `<authenticationKey>`; use it for the next call.

## Week / day discovery — IMPORTANT
- The 7 day rows render in the **authenticated landing page DOM** as:
  ```html
  <tbody id="timesheetDateData">
    <tr class="timesheetDay" timesheetdetailid="956338" ...><td>Sun 06/14/2026</td>...</tr>
    ... 7 rows Sun..Sat (detailIds were sequential 956338..956344) ...
  </tbody>
  ```
  Overall status renders as `...Status">In Progress`. `window.Timesheet.timesheetId` = e.g. `128713`.
- A plain XHR `GET /employee/?date=...` (cookie auth, no one-time key) returns the page **shell with no day rows** — the table is populated only on the authenticated landing render. Status 200 but `#timesheetDateData` empty.
- `getTimesheet.php` → **404** (does not exist). There is **no confirmed JSON/XML endpoint that lists a week's day detailIds.** `getTimesheetDay.php` **requires** `timesheetdetailId` (rejects date-only with "Missing timesheetdetailId").
- **Consequence:** the current week (post-login landing) is the reliably loadable week headlessly. Loading an **arbitrary past/future** week's detailIds headlessly is **not yet solved** — UI week-nav (`button.previousRange`/`.nextRange`) is JS-driven and fired no observable network call in testing. Follow-up needed (find the JS data source or a server route that renders a chosen week with `authenticationKey`).

## create.php (create-only, NOT a loader)
- `POST /php/timesheet/create.php` form `{authenticationKey, assignmentId, periodEndDate:'YY-MM-DD'(Saturday end), timezoneOffset:'420', subaction:'Blank'}`.
- If the week already exists → HTTP 209, `<root>...<errorStatus>error</errorStatus><errorMessage>The timesheet you are attempting to create has already been created</errorMessage></root>` (see `create-week-exists.xml`).
- Does **not** return the day detailId list. Success-shape for a brand-new week was not captured (current week already existed).

## getTimesheetDay.php (read a day) — confirmed
- `POST /php/timesheet/getTimesheetDay.php` form `{authenticationKey, timesheetdetailId}` → `<timesheet>` (see `get-day.xml`):
  `maxCheckinId`, `timesheetdetailsid`, `timesheetdates` (YYYY-MM-DD), `timesheetdateFormatted`, `hoursworked`, `totalHours`,
  `blocks > block { id, timesheetBlockId, date, hours, minutes, checkin, checkout, note, projectIds, projectId, type, editable }`,
  `googleAnalyticsPage`, `authenticationKey` (rotated), `errorStatus` (`okay`).

## updateDay.php (write a day) — confirmed shape (from user capture)
- `POST /php/timesheet/updateDay.php` form `{authenticationKey, timesheetdetailId, maxCheckinId, block[N][timesheetBlockId], block[N][timesheetBlockHours], block[N][timesheetBlockMinutes], block[N][timesheetBlockType], block[N][timesheetBlockNote]}` (N is 1-based).
  - Existing blocks: pass their `timesheetBlockId`. New blocks: empty `timesheetBlockId`.
  - `type` 0 = Normal. `note` carries the description.

## HTTP note
- These PHP endpoints return HTTP **209** on normal responses (both success and app-level error). Do not treat 209 as failure; parse `<errorStatus>` / `<errorMessage>` instead. Reserve hard failure for 401/403 (auth) and other non-2xx.
