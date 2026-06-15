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

## Decisions (from brainstorm)

1. **Auth:** auto-login from credentials — reverse-engineer the BBO login to mint the JWT from username/password. A `BULLHORN_AUTH_KEY` env override is supported as a fallback if login is SSO/captcha-gated.
2. **Source of truth:** Blitzit (re-read completed tasks, same as the Accelo MCP). The Blitzit-read layer is vendored into this repo for independence.
3. **Assignments:** a default `BULLHORN_ASSIGNMENT_ID` (single-assignment case) plus an optional `config/bullhorn-assignment-map.json` (Blitzit project → assignmentId) override for multiple assignments.
4. **Discovery-first:** capture the exact shapes of login, week-load, and day responses before building on them.

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

## Discovery-first (plan's Task 1)

Before implementing against assumptions, capture from live (browser network capture and/or read-only calls with a valid `authenticationKey`):

1. **BBO login** request/response — endpoint, payload, where the JWT comes back. Fallback to `BULLHORN_AUTH_KEY` env if SSO/captcha-gated.
2. **Week load / `create.php` response** — how day `timesheetdetailId`s and the timesheet **status** are returned.
3. **`periodEndDate` semantics & week boundaries** (sample `26-06-15` is a Monday; reconcile with the prior Sun–Sat observation) and whether **`updateDay.php` replaces or appends** the day's blocks.

The plan pins these shapes down first; later tasks build against the confirmed contracts.

## Out of scope (v1)

- Submitting/approving/signing timesheets.
- Editing already-submitted weeks.
- A combined "sync both Accelo+Bullhorn" tool (the assistant invokes both day tools).
- Headless scheduling / cron.
- Writing back to Blitzit.
