# Bullhorn Timesheet MCP — Design

**Date:** 2026-06-15
**Status:** Approved (brainstorm)
**Owner:** gustavogomez092@gmail.com

## Purpose

A standalone MCP server that programmatically enters time into **Bullhorn Back Office (BBO) staffing timesheets**, mirroring the Accelo MCP's Blitzit→time-tracking sync. Time must be entered in both Accelo and Bullhorn; this MCP is the Bullhorn half. It reads completed Blitzit tasks (the same source of truth as the Accelo MCP) and writes them as timesheet **blocks** via BBO's PHP API. Preview by default; the user confirms; the timesheet is never submitted automatically.

## Background — BBO timesheet model (from captured requests + prior tatui-sync work)

BBO at `https://provisionsgroup.bbo.bullhornstaffing.com`. Time lives in a **weekly timesheet** per **assignment**, broken into **days**, each day holding **blocks** (individual time entries).

Known PHP endpoints (form-encoded POST; all take `authenticationKey`):

- **`/php/timesheet/create.php`** — ensure/create a week's blank timesheet.
  Sample: `authenticationKey, assignmentId=6599, periodEndDate=26-06-15, timezoneOffset=420, subaction=Blank`.
- **`/php/timesheet/getTimesheetDay.php`** — read a day.
  Sample: `authenticationKey, timesheetdetailId=956339`. Returns the day incl. `maxCheckinId` and existing blocks.
- **`/php/timesheet/updateDay.php`** — write a day's blocks.
  Sample: `authenticationKey, timesheetdetailId=956339, maxCheckinId=357262, block[1][timesheetBlockId]=, block[1][timesheetBlockHours]=2, block[1][timesheetBlockMinutes]=0, block[1][timesheetBlockType]=0, block[1][timesheetBlockNote]=`.

Block fields (1-based index): `timesheetBlockId` (empty for new), `timesheetBlockHours`, `timesheetBlockMinutes`, `timesheetBlockType` (0 = Normal), `timesheetBlockNote`. Note format (matches Accelo + prior tatui-sync): **`Project :: Topic :: Description`**.

`authenticationKey` is a BBO JWT (sub=staff id, vanity=provisionsgroup) that **expires (~48 h)**.

## Discovery results (confirmed live in-browser 2026-06-15)

- **Login:** `POST https://provisionsgroup.bbo.bullhornstaffing.com/Login/` (form-encoded) with `process=login`, `flashEnabled=true`, `username`, `password`, `rememberMe`. On success it sets session cookies and redirects to `/employee/?authenticationKey=<hex>` where `<hex>` is a **one-time handoff key** (reusing it on a fresh load bounces back to `/Login/`).
- **JWT acquisition:** the `/employee/` page embeds the JWT as the JS global `window.SESSION_AUTHENTICATION_KEY` (also present in page HTML). The page also exposes `window.Assignment.assignmentId` (= **6599**, single assignment confirmed — `assignments.length === 1`) and `window.Timesheet.timesheetId` (the week's id).
- **JWT rotation:** every `/php/timesheet/*.php` response is **XML** and contains a fresh `<authenticationKey>…</authenticationKey>` — chain it into the next request.
- **`getTimesheetDay.php` response** (XML):
  ```xml
  <timesheet>
    <isHoliday>no</isHoliday>
    <maxCheckinId>357267</maxCheckinId>
    <timesheetdetailsid>956339</timesheetdetailsid>
    <timesheetdates>2026-06-15</timesheetdates>
    <timesheetdateFormatted>Mon 06/15/2026</timesheetdateFormatted>
    <hoursworked>2:00</hoursworked>
    <totalHours>2:00</totalHours>
    <blocks><block>
      <id>0</id><timesheetBlockId>357263</timesheetBlockId>
      <date>2026-06-15</date><hours>2</hours><minutes>0</minutes>
      <checkin>12:00 am</checkin><checkout>12:00 am</checkout>
      <note>notes</note><projectId></projectId><type>0</type><editable>yes</editable>
    </block></blocks>
    <authenticationKey>…fresh JWT…</authenticationKey>
    <errorStatus>okay</errorStatus>
  </timesheet>
  ```
  To preserve an existing block on `updateDay.php`, resend it with its `timesheetBlockId`; new blocks use an empty `timesheetBlockId`.
- **Week boundaries:** **Sunday → Saturday** (observed period `06/14/2026 – 06/20/2026`). Timesheet status text (e.g. `In Progress`) is shown in the UI; the status used by the guard comes from the create/load response (shape to confirm — see below).

## Decisions (from brainstorm)

1. **Auth:** auto-login from credentials (confirmed feasible — plain form POST, no SSO/captcha): `POST /Login/` → load `/employee/` → scrape `window.SESSION_AUTHENTICATION_KEY` (the JWT) from the page, then chain the refreshed `<authenticationKey>` returned by each API call. A `BULLHORN_AUTH_KEY` env override remains as a manual fallback.
2. **Source of truth:** Blitzit (re-read completed tasks, same as the Accelo MCP). The Blitzit-read layer is vendored into this repo for independence.
3. **Assignments:** a default `BULLHORN_ASSIGNMENT_ID` (= 6599; single assignment confirmed) plus an optional `config/bullhorn-assignment-map.json` (Blitzit project → assignmentId) override for multiple assignments.
4. **Discovery-first:** done in-browser (see Discovery results). One contract remains to confirm at implementation time — the `create.php` response (how the 7 day `timesheetdetailId`s + timesheet status come back, and the exact `periodEndDate` value to pass).

## Hard rules (carried from tatui-sync)

1. **Never automate Submit/Approve/Sign/Finalize.** No code path may call those endpoints.
2. **Refuse to write** a timesheet whose status is anything other than not-created / in-progress (guards already-submitted weeks).
3. **Preview by default**; only `confirm:true` writes.
4. **Credentials from env, never written to disk or logged. The JWT is never logged.**

## Architecture

Standalone MCP mirroring the Accelo MCP (TypeScript, NodeNext ESM with `.js` import specifiers, `@modelcontextprotocol/sdk`, `zod`, `vitest`, native `fetch`).

```
bullhorn MCP/
  package.json, tsconfig.json, .env.example, .gitignore, README.md
  src/
    index.ts            # MCP server bootstrap (mirror Accelo index.ts)
    config.ts           # env loader
    bullhorn/
      auth.ts           # login(username,password) -> JWT; cache + refresh on expiry/401; BULLHORN_AUTH_KEY override
      client.ts         # postForm(endpoint, fields, authKey) helper; error mapping (AUTH_EXPIRED, HTTP_ERROR)
      timesheet.ts      # ensureWeek(), loadWeek() -> {status, days:[{date,timesheetdetailId}]}, getDay(), updateDay(); status guard
      period.ts         # Bullhorn week window + periodEndDate from a date (boundaries confirmed in discovery)
    blitzit/            # vendored from Accelo MCP (Firestore read)
      auth.ts, client.ts, tasks.ts
    plan/
      plan.ts           # pure: group BlitzitTask[] -> per-day blocks; note + hours/minutes; dedup vs existing blocks
    tools/
      util.ts           # text()
      sync-core.ts      # runBullhornSync(config, {from?,to?,listId?,confirm?,defaultRange})
      sync-day.ts       # bullhorn_sync_blitzit_day
      sync-week.ts      # bullhorn_sync_blitzit_week
      time-list.ts      # bullhorn_list_my_time (read-only)
      register.ts
  config/
    bullhorn-assignment-map.example.json   # optional project -> assignmentId
  docs/superpowers/specs|plans/
  tests next to source (*.test.ts)
```

### Components

| Component | Responsibility | Boundaries |
|---|---|---|
| `config.ts` | env: `BULLHORN_VANITY` (provisionsgroup), `BULLHORN_USERNAME`/`BULLHORN_PASSWORD`, `BULLHORN_ASSIGNMENT_ID`, `BULLHORN_AUTH_KEY?` (override), `BULLHORN_TIMEZONE_OFFSET?` (default 420), `BULLHORN_ASSIGNMENT_MAP?` path, `BULLHORN_WORKDAY_TZ?` | no I/O beyond reading env |
| `bullhorn/auth.ts` | obtain + cache the JWT; refresh on expiry/401; honor `BULLHORN_AUTH_KEY` override | knows nothing about timesheets |
| `bullhorn/client.ts` | form-encoded POST to `/php/timesheet/*.php`; parse JSON/response; map auth/HTTP errors | no business logic |
| `bullhorn/timesheet.ts` | `ensureWeek(assignmentId, periodEndDate)`, `loadWeek(...)` → status + day ids, `getDay(detailId)` → maxCheckinId + blocks, `updateDay(detailId, maxCheckinId, blocks)`; **status guard** | no Blitzit knowledge |
| `bullhorn/period.ts` | map a date → Bullhorn week (`periodEndDate`, day list) | pure |
| `blitzit/*` | vendored Firestore read (auth/client/tasks) | unchanged from Accelo |
| `plan/plan.ts` | pure: filter/group done-tasks into per-day block sets, build notes + hours/minutes, dedup vs existing-by-note, report unmapped/zero/duplicate | no I/O |
| `tools/sync-core.ts` | orchestrate auth → period → ensureWeek/guard → Blitzit read → plan → per-day get/update → preview/confirm payload | thin |

### Block / entry shapes

```ts
type Block = { id?: string; hours: number; minutes: number; type: number; note: string }; // type 0 = Normal
type DayPlan = { date: string; timesheetdetailId?: string; blocks: Block[] };
```

Hours/minutes from Blitzit `timeTaken` ms: `hours = floor(sec/3600)`, `minutes = round((sec%3600)/60)`. Note = `Project :: Topic :: Detail` (reuse the Accelo nomenclature/parse).

## Data flow

1. Resolve auth (login or `BULLHORN_AUTH_KEY`).
2. For the target date(s), `period.ts` computes the Bullhorn week's `periodEndDate` and the in-week day dates.
3. `ensureWeek()` (create.php `subaction=Blank` if needed); `loadWeek()` returns status + each day's `timesheetdetailId`. **Status guard**: throw if not editable.
4. Read Blitzit done-tasks for the window (vendored blitzit layer), filtered to the Bullhorn day(s).
5. `plan.ts` groups tasks per day → candidate blocks (one per task), resolving assignment via default/map.
6. Per day: `getDay()` → `maxCheckinId` + existing blocks; dedup candidates vs existing by note; if writing, `updateDay()` with the day's **full** block set (existing + new — append semantics confirmed in discovery).
7. Return preview (per-day blocks, totals, unmapped/zero/dup) or, with `confirm:true`, the written result. **Never submit.**

## Tool surface

- `bullhorn_sync_blitzit_day` — `date?` (default today, tz), `listId?`, `confirm?`.
- `bullhorn_sync_blitzit_week` — `from?`/`to?` (default current Bullhorn week), `listId?`, `confirm?`.
- `bullhorn_list_my_time` — `from?`/`to?`; read-only listing of existing blocks for verification/dedup.

## Error handling

- Auth: expired/invalid → `AUTH_EXPIRED` with guidance (re-login or refresh `BULLHORN_AUTH_KEY`).
- Status guard: non-editable timesheet → clear refusal naming the status.
- Blitzit app/token missing → actionable error (as in Accelo).
- HTTP/parse errors → surfaced with status.
- Unmapped projects / zero-duration / duplicates → reported, never block other entries.
- Nothing writes unless `confirm:true`.

## Testing (vitest)

- `period.ts`: date → Bullhorn week/periodEndDate boundaries, day lists.
- `plan.ts`: grouping, hours/minutes split, note format, dedup vs existing-by-note, unmapped/zero reporting.
- `client.ts`: form-encoding, auth-error mapping (mock fetch).
- `auth.ts`: JWT cache/refresh/override logic (pure parts; network mocked).
- `timesheet.ts`: status-guard logic; request payload shapes (mock client).
- Tools: preview-vs-confirm, never-submit (no submit endpoint referenced).
- No live network in tests.

## Discovery — status

Done in-browser on 2026-06-15 (see "Discovery results" above): login flow, JWT acquisition + rotation, `getTimesheetDay.php` XML shape, block fields, single assignment (6599), and Sun–Sat week boundaries are all confirmed.

**One contract remains to confirm at implementation time** (plan's Task 1), via a single read-only `create.php` call (the week already exists, so `subaction=Blank` should return the existing week idempotently — verify it does not duplicate):

1. **`create.php` response** — how the 7 day `timesheetdetailId`s and the timesheet **status** are returned, and the exact **`periodEndDate`** value to pass (the displayed period end is Sat `06/20`, but the captured sample used `26-06-15`; determine whether the param is the Saturday end, the period, or a reference date the server snaps to the Sun–Sat week).
2. Whether **`updateDay.php` replaces or appends** the day's blocks (we send the full day set incl. existing blocks regardless, so this is a safety confirmation).

Until confirmed, `timesheet.ts` builds the day-id map and status from the `create.php` response behind a small adapter so only that parser changes once the shape is pinned.

## Out of scope (v1)

- Submitting/approving/signing timesheets.
- Editing already-submitted weeks.
- A combined "sync both Accelo+Bullhorn" tool (the assistant invokes both day tools).
- Headless scheduling / cron.
- Writing back to Blitzit.
