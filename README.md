# Bullhorn Timesheet MCP

Logs completed Blitzit tasks into Bullhorn Back Office (BBO) weekly timesheets as time blocks. Counterpart to the Accelo MCP — the same Blitzit source feeds both systems, since time must be entered in each.

## Setup

1. `npm install && npm run build`
2. Copy `.env.example` to `.env` and fill in:
   - `BULLHORN_VANITY` — your BBO subdomain (e.g. `provisionsgroup` for `provisionsgroup.bbo.bullhornstaffing.com`).
   - `BULLHORN_USERNAME` / `BULLHORN_PASSWORD` — used to auto-login and read the timesheet page. **Required for week loading** (see Limitations).
   - `BULLHORN_ASSIGNMENT_ID` — your default Bullhorn assignment id (e.g. `6599`).
   - `BULLHORN_WORKDAY_TZ` — IANA tz used to bucket Blitzit completion times into Bullhorn days (e.g. `America/Los_Angeles`).
   - `BULLHORN_TIMEZONE_OFFSET` — minutes offset sent to BBO (default `420`).
   - `BULLHORN_AUTH_KEY` *(optional)* — a manual JWT override that skips login. Note: this path cannot load the timesheet week (no landing page), so the sync tools need username/password.
   - `BULLHORN_ASSIGNMENT_MAP` *(optional)* — path to a `{ "ProjectName": assignmentId }` JSON file if different Blitzit projects post to different assignments. Otherwise `BULLHORN_ASSIGNMENT_ID` covers everything.

Blitzit auth reuses the local Blitzit **desktop app's** Firebase token (`~/Library/Application Support/blitzit/...`); the app must be installed and signed in on the same machine.

## Connect to Claude Code / Desktop

```json
{
  "mcpServers": {
    "bullhorn": {
      "command": "node",
      "args": ["/absolute/path/to/bullhorn MCP/dist/index.js"],
      "env": {
        "BULLHORN_VANITY": "provisionsgroup",
        "BULLHORN_USERNAME": "<you>",
        "BULLHORN_PASSWORD": "<secret>",
        "BULLHORN_ASSIGNMENT_ID": "6599",
        "BULLHORN_WORKDAY_TZ": "America/Los_Angeles"
      }
    }
  }
}
```

## Tools

- `bullhorn_sync_blitzit_day` — sync one day (default today). Say *"sync my day to bullhorn."*
- `bullhorn_sync_blitzit_week` — sync the current Sun–Sat week.
- `bullhorn_list_my_time` — read existing blocks for the current week (read-only).

## Model

BBO timesheets are weekly (Sun–Sat) per assignment. Each day (`timesheetdetailId`) holds blocks (`hours`/`minutes`/`type`/`note`). Note format is `Project :: Topic :: Detail` (matches Accelo). Blitzit `timeTaken` → hours/minutes; the task's completion time (in `BULLHORN_WORKDAY_TZ`) chooses the day. See `docs/DISCOVERY.md` for the reverse-engineered API.

## Safety

- **Preview by default**; pass `confirm:true` to write.
- **Never submits or approves** a timesheet.
- **Refuses to write** a timesheet whose status isn't editable (Not Created / In Progress).
- **Preserves existing blocks** (appends new ones); **skips duplicates** (same day + note) and zero-duration tasks.
- Credentials and the JWT are never logged.

## Limitations

- **Current week only.** The week's day-ids are read from the authenticated post-login landing page; BBO has no headless API to load an arbitrary past/future week (see `docs/DISCOVERY.md`). Requesting a date outside the current week returns a clear error. Past-week backfill is a planned follow-up.
- The `BULLHORN_AUTH_KEY` override skips login and therefore can't load the week — use username/password for the sync tools.
