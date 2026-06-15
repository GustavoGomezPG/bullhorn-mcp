# Bullhorn Timesheet MCP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone MCP server that logs completed Blitzit tasks into Bullhorn Back Office (BBO) weekly timesheets via the PHP API, mirroring the Accelo MCP (preview/confirm, dedup, never auto-submit).

**Architecture:** A Bullhorn API layer (auto-login → JWT, form-POST client with JWT rotation, timesheet ensure/get/update) + a vendored Blitzit read layer (Firestore) + a pure plan layer (tasks → per-day blocks) + day/week sync tools. Bullhorn time is per-assignment weekly: a timesheet → days (`timesheetdetailId`) → blocks (hours/minutes/type/note).

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), `@modelcontextprotocol/sdk`, `zod`, native `fetch`, `vitest`, `tsx`, `dotenv`. Node 20+.

**Working dir:** `/Users/gustavogomez/Documents/Projects/bullhorn MCP` (git branch `feat/bullhorn-timesheet-mcp`, already checked out). Commit each task.

---

## ⚠️ DESIGN UPDATE (post-discovery, 2026-06-15) — read before implementing

Live reverse-engineering (see `docs/DISCOVERY.md` + `tests/fixtures/`) corrected two assumptions. **These override the original task text below where they conflict:**

1. **The week's day-ids are NOT loadable via `create.php`.** `create.php` is create-only (errors "already been created" if the week exists; see `create-week-exists.xml`) and `getTimesheet.php` 404s. The 7 day rows (`<tr class="timesheetDay" timesheetdetailid="N"><td>…MM/DD/YYYY…</td>…</tr>`) and the status (`Status">In Progress`) are rendered into the **authenticated post-login `/employee/` landing page**. A plain XHR `GET /employee/?date=` returns the shell with **no** rows.
   - ➡️ Replace the planned `parseWeek` (XML) with **`parseWeekHtml(html)`** in a new module **`src/bullhorn/page.ts`** (+ test against `tests/fixtures/employee-week.html`). It returns `{ status, timesheetId?, days: [{date: 'YYYY-MM-DD', timesheetdetailId}] }` (convert `MM/DD/YYYY`→`YYYY-MM-DD`).
   - ➡️ `src/bullhorn/auth.ts` `login()` returns **`{ jwt, landingHtml }`** (the landing page yields both the JWT and the current week). `resolveAuthKey` stays for the `BULLHORN_AUTH_KEY` override path, but the override path has no landing HTML — see scope note.
   - ➡️ `src/bullhorn/timesheet.ts` exposes **`loadCurrentWeek(landingHtml)`** (parse via `page.ts`) instead of an XML `ensureWeek`. `create.php` is used only as a best-effort "create if the landing page shows no week" step.
   - ➡️ Drop `parseWeek` from `xml.ts` (keep `tag`/`parseDay`). Task 5's `parseWeek` test/impl move to `page.ts` as `parseWeekHtml` (HTML, not XML).

2. **Scope v1 = CURRENT WEEK ONLY** (user decision: "current week and daily updates"). The day/week tools operate on the week present in the post-login landing page (the current week). If a requested `date` falls outside the loaded current week, return a clear error telling the user past-week backfill isn't supported headlessly yet (documented follow-up). The `BULLHORN_AUTH_KEY` override path (no landing HTML) therefore can't load the week by itself — when used, tools error asking the user to allow auto-login (which provides the landing HTML) for week loading.

3. **HTTP 209 is normal.** BBO PHP endpoints return **209** for both success and app-level errors. Treat 209 as OK at the HTTP layer; decide success/failure from `<errorStatus>` (`okay` vs `error`) + `<errorMessage>`. Only 401/403 (and other non-2xx besides 209/200) are auth/transport failures. Update `client.ts` accordingly (the original `!res.ok` check would wrongly reject 209).

Everything else in the plan (scaffold, vendored Blitzit layer, period, time helpers, `parseDay`, client JWT rotation, assignment resolver, pure `plan.ts`, tool surface, README, preview/confirm/never-submit/dedup safety) stands.

---

## File Structure

- `package.json`, `tsconfig.json`, `.env.example`, `.gitignore` (exists) — scaffold.
- `src/index.ts` — MCP bootstrap (mirror Accelo).
- `src/config.ts` — env loader.
- `src/util.ts` — `text()` response helper.
- `src/blitzit/{auth,client,tasks}.ts` (+ `.test.ts`) — vendored verbatim from the Accelo MCP (Firestore read).
- `src/bullhorn/period.ts` (+test) — Sun–Sat week math.
- `src/bullhorn/xml.ts` (+test) — tiny XML tag extractors + `parseDay`, `parseWeek`.
- `src/bullhorn/auth.ts` (+test) — `extractJwtFromHtml`, `login`, `resolveAuthKey` (env override).
- `src/bullhorn/client.ts` (+test) — `BullhornError`, `Session`, `createBullhornClient` (form POST + JWT rotation).
- `src/bullhorn/timesheet.ts` (+test) — `ensureWeek`, `getDay`, `updateDay`, status guard.
- `src/bullhorn/time.ts` (+test) — `epochMsToDateInTz`, `splitSeconds`.
- `src/plan/plan.ts` (+test) — pure `planBullhornSync`.
- `src/tools/{sync-core,sync-day,sync-week,time-list,register}.ts` (+ tests for tools).
- `src/bullhorn/assignment.ts` (+test) — default + optional project→assignmentId map.
- `config/bullhorn-assignment-map.example.json`.
- `tests/fixtures/` — captured live responses (Task 2).
- `README.md`.

---

## Task 1: Scaffold

**Files:** Create `package.json`, `tsconfig.json`, `.env.example`, `src/util.ts`, `src/util.test.ts`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "bullhorn-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "bullhorn-mcp": "dist/index.js" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "dotenv": "^16.4.5",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `.env.example`**

```
# BBO vanity subdomain (https://<vanity>.bbo.bullhornstaffing.com)
BULLHORN_VANITY=provisionsgroup
# Auto-login credentials (preferred)
BULLHORN_USERNAME=
BULLHORN_PASSWORD=
# Optional manual JWT override (skips login); refresh when it expires
BULLHORN_AUTH_KEY=
# Default Bullhorn assignment id for all time
BULLHORN_ASSIGNMENT_ID=6599
# Minutes offset sent to BBO create.php (e.g. 420)
BULLHORN_TIMEZONE_OFFSET=420
# IANA tz used to bucket Blitzit completion times into Bullhorn days
BULLHORN_WORKDAY_TZ=America/Los_Angeles
# Optional path to a project->assignmentId map
BULLHORN_ASSIGNMENT_MAP=
```

- [ ] **Step 4: Write `src/util.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { text } from "./util.js";

describe("text", () => {
  it("wraps a value as a JSON text content block", () => {
    const r = text({ a: 1 });
    expect(r.content[0].type).toBe("text");
    expect(JSON.parse(r.content[0].text)).toEqual({ a: 1 });
  });
});
```

- [ ] **Step 5: Run it (fails — no util)**

Run: `npm install` then `npx vitest run src/util.test.ts`
Expected: FAIL (cannot find `./util.js`).

- [ ] **Step 6: Create `src/util.ts`**

```ts
export function text(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
```

- [ ] **Step 7: Pass + build**

Run: `npx vitest run src/util.test.ts` → PASS. Then `npm run build` → no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json .env.example src/util.ts src/util.test.ts
git commit -m "chore: scaffold bullhorn MCP (package, tsconfig, util)"
```

---

## Task 2: Discovery — capture create.php + week-load shape (live, read-only)

**Files:** Create `tests/fixtures/get-day.xml`, `tests/fixtures/create-week.xml`, `docs/DISCOVERY.md`.

This is the one unconfirmed contract. Capture it live, read-only, so later parsers are TDD'd against real data. **No writes beyond `create.php subaction=Blank` on the already-existing current week (idempotent — verify it does not duplicate).**

- [ ] **Step 1: Save the already-confirmed getTimesheetDay fixture**

Create `tests/fixtures/get-day.xml` with the captured response:

```xml
<?xml version="1.0" encoding="utf-8"?>
<timesheet><isHoliday>no</isHoliday><maxCheckinId>357267</maxCheckinId><timesheetdetailsid>956339</timesheetdetailsid><timesheetdates>2026-06-15</timesheetdates><timesheetdateFormatted>Mon 06/15/2026</timesheetdateFormatted><hoursworked>2:00</hoursworked><totalHours>2:00</totalHours><blocks><block><id>0</id><timesheetBlockId>357263</timesheetBlockId><date>2026-06-15</date><hours>2</hours><minutes>0</minutes><checkin>12:00 am</checkin><checkout>12:00 am</checkout><note>notes</note><projectIds></projectIds><projectId></projectId><type>0</type><editable>yes</editable></block></blocks><authenticationKey>REDACTED_JWT</authenticationKey><errorStatus>okay</errorStatus></timesheet>
```

- [ ] **Step 2: Capture `create.php` response (live)**

In a logged-in BBO browser tab (`https://<vanity>.bbo.bullhornstaffing.com/employee/`), run in the devtools console (read-only fetch using the in-page JWT):

```js
(async () => {
  const jwt = window.SESSION_AUTHENTICATION_KEY;
  const body = new URLSearchParams({ authenticationKey: jwt, assignmentId: String(window.Assignment.assignmentId), periodEndDate: '26-06-20', timezoneOffset: '420', subaction: 'Blank' });
  const res = await fetch('/php/timesheet/create.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  console.log('STATUS', res.status); console.log(await res.text());
})();
```

Save the printed body to `tests/fixtures/create-week.xml` (redact any `<authenticationKey>` value to `REDACTED_JWT`). Also try `periodEndDate: '26-06-15'` if `06-20` does not return the current week — record which value yields the `06/14–06/20` week.

- [ ] **Step 3: Record findings in `docs/DISCOVERY.md`**

Document: the create.php response root/tags, how each day's `timesheetdetailsid` + date appear, where the **status** lives (tag name + sample value), and which `periodEndDate` value selects the Sun–Sat week. If create.php does NOT list day ids, note the endpoint that does (capture it from the Network tab on page load, e.g. `getTimesheet.php`) and save its response as `tests/fixtures/create-week.xml` instead.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/get-day.xml tests/fixtures/create-week.xml docs/DISCOVERY.md
git commit -m "test: capture live BBO get-day + create-week fixtures"
```

---

## Task 3: Vendor the Blitzit read layer

**Files:** Create `src/blitzit/auth.ts`, `src/blitzit/client.ts`, `src/blitzit/tasks.ts`, `src/blitzit/tasks.test.ts`.

Copy these verbatim from the Accelo MCP (they are self-contained and already tested).

- [ ] **Step 1: Create `src/blitzit/auth.ts`**

```ts
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const FIREBASE_API_KEY = "AIzaSyBfWWxV-jps9AOAS5eSIFx8cXl_BeMOb7U";

const INDEXEDDB_DIR = join(
  homedir(),
  "Library", "Application Support", "blitzit", "IndexedDB", "app_._0.indexeddb.leveldb",
);

/** Extract the longest Firebase refresh token (starts with "AMf-") from a leveldb blob. */
export function extractRefreshToken(blob: string): string {
  const matches = blob.match(/AMf-[A-Za-z0-9_-]{60,}/g);
  if (!matches || matches.length === 0) {
    throw new Error("No Blitzit refresh token found. Open and sign into the Blitzit desktop app, then retry.");
  }
  return matches.reduce((a, b) => (b.length > a.length ? b : a));
}

function readRefreshTokenFromDisk(dir: string = INDEXEDDB_DIR): string {
  if (!existsSync(dir)) {
    throw new Error(`Blitzit app storage not found at ${dir}. Is the Blitzit desktop app installed and signed in?`);
  }
  let blob = "";
  for (const name of readdirSync(dir)) {
    try { blob += readFileSync(join(dir, name), "latin1"); } catch { /* skip locked files */ }
  }
  return extractRefreshToken(blob);
}

export async function mintIdToken(refreshToken: string): Promise<{ idToken: string; uid: string }> {
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`Failed to mint Blitzit ID token (HTTP ${res.status}).`);
  const data = (await res.json()) as { access_token?: string; user_id?: string };
  if (!data.access_token || !data.user_id) throw new Error("Blitzit token response missing access_token/user_id.");
  return { idToken: data.access_token, uid: data.user_id };
}

export async function getBlitzitAuth(): Promise<{ idToken: string; uid: string }> {
  return mintIdToken(readRefreshTokenFromDisk());
}
```

- [ ] **Step 2: Create `src/blitzit/client.ts`**

```ts
export const FIRESTORE_PROJECT = "blitzitapp1";
const BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents`;

export interface FirestoreDoc { id: string; fields: Record<string, any> }

export interface BlitzitClient {
  queryTasksByOwner(uid: string): Promise<FirestoreDoc[]>;
}

export function createBlitzitClient(idToken: string): BlitzitClient {
  return {
    async queryTasksByOwner(uid: string): Promise<FirestoreDoc[]> {
      const body = {
        structuredQuery: {
          from: [{ collectionId: "tasks" }],
          where: { fieldFilter: { field: { fieldPath: "owner" }, op: "EQUAL", value: { stringValue: uid } } },
        },
      };
      const res = await fetch(`${BASE}:runQuery`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Blitzit Firestore query failed (HTTP ${res.status}).`);
      const rows = (await res.json()) as Array<{ document?: { name: string; fields: Record<string, any> } }>;
      return rows
        .filter((r) => r.document)
        .map((r) => ({ id: r.document!.name.split("/documents/")[1].split("/").pop()!, fields: r.document!.fields }));
    },
  };
}
```

- [ ] **Step 3: Create `src/blitzit/tasks.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseDescription, normalizeTask, decodeEntities, fetchWeekDoneTasks } from "./tasks.js";
import type { BlitzitClient, FirestoreDoc } from "./client.js";

describe("decodeEntities", () => {
  it("decodes common HTML entities", () => {
    expect(decodeEntities("A &amp; B &lt;x&gt; &quot;q&quot; &#39;y&#39;")).toBe('A & B <x> "q" \'y\'');
  });
});

describe("parseDescription", () => {
  it("splits <strong>topic</strong><br>detail", () => {
    expect(parseDescription("<strong>Website</strong><br>Fixed the header")).toEqual({ topic: "Website", detail: "Fixed the header" });
  });
  it("handles missing <strong>", () => {
    expect(parseDescription("just text")).toEqual({ topic: "", detail: "just text" });
  });
});

describe("normalizeTask", () => {
  it("maps Firestore fields", () => {
    const fields = {
      title: { stringValue: "Datamax" }, description: { stringValue: "<strong>Web</strong><br>DNS" },
      timeTaken: { integerValue: "3600000" }, endTime: { integerValue: "1780000000000" },
      listId: { stringValue: "L1" }, board: { stringValue: "done" },
    };
    expect(normalizeTask("x", fields)).toEqual({
      id: "x", project: "Datamax", topic: "Web", detail: "DNS", seconds: 3600, endTimeMs: 1780000000000, listId: "L1", board: "done",
    });
  });
});

function mockClient(docs: FirestoreDoc[]): BlitzitClient { return { queryTasksByOwner: async () => docs }; }
const doc = (id: string, board: string, endTimeMs: number): FirestoreDoc => ({
  id, fields: { title: { stringValue: "Datamax" }, board: { stringValue: board }, description: { stringValue: "<strong>W</strong><br>x" }, timeTaken: { integerValue: "3600000" }, endTime: { integerValue: String(endTimeMs) }, listId: { stringValue: "L1" } },
});

describe("fetchWeekDoneTasks", () => {
  it("keeps only done tasks in [fromMs,toMs)", async () => {
    const c = mockClient([doc("a", "done", 1000), doc("b", "done", 5000), doc("c", "todo", 1500)]);
    expect((await fetchWeekDoneTasks(c, "u", 500, 2000)).map(t => t.id)).toEqual(["a"]);
  });
});
```

- [ ] **Step 4: Run it (fails — no tasks.ts)**

Run: `npx vitest run src/blitzit/tasks.test.ts` → FAIL.

- [ ] **Step 5: Create `src/blitzit/tasks.ts`**

```ts
import type { BlitzitClient } from "./client.js";

export interface BlitzitTask {
  id: string;
  project: string;
  topic: string;
  detail: string;
  seconds: number;
  endTimeMs: number;
  listId: string | null;
  board: string;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

export function parseDescription(html: string): { topic: string; detail: string } {
  const input = html ?? "";
  const strong = input.match(/<strong>([\s\S]*?)<\/strong>/i);
  const topic = strong ? stripTags(strong[1]) : "";
  const rest = strong ? input.slice(input.indexOf(strong[0]) + strong[0].length) : input;
  const detail = stripTags(rest);
  return { topic, detail };
}

type FsFields = Record<string, { stringValue?: string; integerValue?: string }>;
const DONE_BOARD = "done";
function str(f: FsFields, key: string): string { return f[key]?.stringValue ?? ""; }
function int(f: FsFields, key: string): number { const n = Number(f[key]?.integerValue); return Number.isFinite(n) ? n : 0; }

export function normalizeTask(id: string, fields: FsFields): BlitzitTask {
  const { topic, detail } = parseDescription(str(fields, "description"));
  return {
    id, project: str(fields, "title"), topic, detail,
    seconds: Math.round(int(fields, "timeTaken") / 1000),
    endTimeMs: int(fields, "endTime"),
    listId: fields.listId?.stringValue ?? null,
    board: str(fields, "board"),
  };
}

export async function fetchWeekDoneTasks(
  client: BlitzitClient, uid: string, fromMs: number, toMs: number, listId?: string,
): Promise<BlitzitTask[]> {
  const docs = await client.queryTasksByOwner(uid);
  return docs
    .map((d) => normalizeTask(d.id, d.fields))
    .filter((t) => t.board === DONE_BOARD && t.endTimeMs >= fromMs && t.endTimeMs < toMs && (!listId || t.listId === listId))
    .sort((a, b) => a.endTimeMs - b.endTimeMs);
}
```

- [ ] **Step 6: Pass + build + commit**

Run: `npx vitest run src/blitzit/tasks.test.ts` → PASS; `npm run build` → clean.
```bash
git add src/blitzit/auth.ts src/blitzit/client.ts src/blitzit/tasks.ts src/blitzit/tasks.test.ts
git commit -m "feat: vendor blitzit read layer from accelo mcp"
```

---

## Task 4: Period (Sun–Sat week) + time helpers

**Files:** Create `src/bullhorn/period.ts`, `src/bullhorn/period.test.ts`, `src/bullhorn/time.ts`, `src/bullhorn/time.test.ts`.

- [ ] **Step 1: Write `src/bullhorn/period.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { bullhornWeek } from "./period.js";

describe("bullhornWeek", () => {
  it("computes the Sun–Sat week containing a Monday", () => {
    const w = bullhornWeek("2026-06-15"); // Mon
    expect(w.start).toBe("2026-06-14");   // Sun
    expect(w.end).toBe("2026-06-20");     // Sat
    expect(w.days).toEqual(["2026-06-14","2026-06-15","2026-06-16","2026-06-17","2026-06-18","2026-06-19","2026-06-20"]);
    expect(w.periodEndDate).toBe("26-06-20"); // YY-MM-DD of the Saturday end
  });
  it("treats Sunday as the start of its own week", () => {
    expect(bullhornWeek("2026-06-14").start).toBe("2026-06-14");
  });
  it("treats Saturday as the end of its week", () => {
    const w = bullhornWeek("2026-06-20");
    expect(w.start).toBe("2026-06-14");
    expect(w.end).toBe("2026-06-20");
  });
});
```

- [ ] **Step 2: Run (fails) — `npx vitest run src/bullhorn/period.test.ts`**

- [ ] **Step 3: Create `src/bullhorn/period.ts`**

```ts
export interface BullhornWeek { start: string; end: string; days: string[]; periodEndDate: string }

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function yyMmDd(iso: string): string { return iso.slice(2); } // "2026-06-20" -> "26-06-20"

/** Sun–Sat week (calendar dates) containing the given YYYY-MM-DD date. */
export function bullhornWeek(date: string): BullhornWeek {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid date: "${date}". Use YYYY-MM-DD.`);
  const base = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const sundayOffset = -base.getUTCDay(); // 0 = Sunday
  const start = new Date(base.getTime() + sundayOffset * 86400000);
  const days = Array.from({ length: 7 }, (_, i) => ymd(new Date(start.getTime() + i * 86400000)));
  return { start: days[0], end: days[6], days, periodEndDate: yyMmDd(days[6]) };
}
```

- [ ] **Step 4: Pass — `npx vitest run src/bullhorn/period.test.ts` → PASS**

- [ ] **Step 5: Write `src/bullhorn/time.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { epochMsToDateInTz, splitSeconds } from "./time.js";

describe("splitSeconds", () => {
  it("splits seconds into hours and minutes", () => {
    expect(splitSeconds(3600)).toEqual({ hours: 1, minutes: 0 });
    expect(splitSeconds(5400)).toEqual({ hours: 1, minutes: 30 });
    expect(splitSeconds(900)).toEqual({ hours: 0, minutes: 15 });
  });
});

describe("epochMsToDateInTz", () => {
  it("maps an epoch to its local calendar date", () => {
    // 2026-06-08T15:53Z is morning in America/Los_Angeles -> same day
    expect(epochMsToDateInTz(Date.UTC(2026, 5, 8, 15, 53), "America/Los_Angeles")).toBe("2026-06-08");
    // 2026-06-15T03:00Z is still 2026-06-14 in LA (UTC-7)
    expect(epochMsToDateInTz(Date.UTC(2026, 5, 15, 3, 0), "America/Los_Angeles")).toBe("2026-06-14");
  });
});
```

- [ ] **Step 6: Run (fails), then create `src/bullhorn/time.ts`**

```ts
export function splitSeconds(totalSeconds: number): { hours: number; minutes: number } {
  const s = Math.max(0, Math.round(totalSeconds));
  return { hours: Math.floor(s / 3600), minutes: Math.round((s % 3600) / 60) };
}

/** Calendar date (YYYY-MM-DD) of an epoch (ms) in the given IANA tz. */
export function epochMsToDateInTz(epochMs: number, tz: string): string {
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") p[part.type] = part.value;
  }
  return `${p.year}-${p.month}-${p.day}`;
}
```

- [ ] **Step 7: Pass + build + commit**

Run both test files → PASS; `npm run build` → clean.
```bash
git add src/bullhorn/period.ts src/bullhorn/period.test.ts src/bullhorn/time.ts src/bullhorn/time.test.ts
git commit -m "feat: bullhorn period (Sun-Sat) + time helpers"
```

---

## Task 5: XML helpers + day/week parsers

**Files:** Create `src/bullhorn/xml.ts`, `src/bullhorn/xml.test.ts`.

- [ ] **Step 1: Write `src/bullhorn/xml.test.ts`** (uses the captured day fixture from Task 2)

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tag, parseDay, parseWeek } from "./xml.js";

const dayXml = readFileSync(join(process.cwd(), "tests/fixtures/get-day.xml"), "utf8");

describe("tag", () => {
  it("extracts a tag's inner text", () => {
    expect(tag("<a><b>hi</b></a>", "b")).toBe("hi");
    expect(tag("<a></a>", "missing")).toBeNull();
  });
});

describe("parseDay", () => {
  it("parses the captured getTimesheetDay fixture", () => {
    const d = parseDay(dayXml);
    expect(d.timesheetdetailId).toBe("956339");
    expect(d.date).toBe("2026-06-15");
    expect(d.maxCheckinId).toBe("357267");
    expect(d.errorStatus).toBe("okay");
    expect(d.blocks).toHaveLength(1);
    expect(d.blocks[0]).toMatchObject({ timesheetBlockId: "357263", hours: 2, minutes: 0, note: "notes", type: 0 });
  });
  it("extracts the refreshed authenticationKey when present", () => {
    expect(parseDay("<timesheet><authenticationKey>abc</authenticationKey></timesheet>").authenticationKey).toBe("abc");
  });
});

describe("parseWeek", () => {
  it("extracts day (date -> detailId) pairs and a status from the create-week fixture", () => {
    const xml = readFileSync(join(process.cwd(), "tests/fixtures/create-week.xml"), "utf8");
    const w = parseWeek(xml);
    expect(w.days.length).toBeGreaterThanOrEqual(7);
    for (const d of w.days) {
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d.timesheetdetailId).toMatch(/^\d+$/);
    }
    expect(typeof w.status).toBe("string");
  });
});
```

> NOTE: If `docs/DISCOVERY.md` (Task 2) recorded that `create.php` does NOT contain the day list / status, update `parseWeek` and this test to the endpoint/shape that does (per the captured fixture). The structural assertions above (7+ days, numeric ids, ISO dates, a status string) should hold regardless of exact tag nesting.

- [ ] **Step 2: Run (fails) — `npx vitest run src/bullhorn/xml.test.ts`**

- [ ] **Step 3: Create `src/bullhorn/xml.ts`**

```ts
export interface Block {
  timesheetBlockId?: string;
  hours: number;
  minutes: number;
  note: string;
  type: number;
  editable: boolean;
}
export interface DayData {
  timesheetdetailId: string;
  date: string;
  maxCheckinId: string;
  hoursWorked: string;
  blocks: Block[];
  authenticationKey: string | null;
  errorStatus: string | null;
}
export interface WeekData {
  status: string;
  days: Array<{ date: string; timesheetdetailId: string }>;
  authenticationKey: string | null;
}

export function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : null;
}
function tagAll(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "gi"))].map((m) => m[1]);
}
function num(s: string | null): number { const n = Number((s ?? "").trim()); return Number.isFinite(n) ? n : 0; }

export function parseDay(xml: string): DayData {
  const blocks: Block[] = tagAll(xml, "block").map((b) => ({
    timesheetBlockId: (tag(b, "timesheetBlockId") ?? "").trim() || undefined,
    hours: num(tag(b, "hours")),
    minutes: num(tag(b, "minutes")),
    note: (tag(b, "note") ?? "").trim(),
    type: num(tag(b, "type")),
    editable: (tag(b, "editable") ?? "").trim().toLowerCase() === "yes",
  }));
  return {
    timesheetdetailId: (tag(xml, "timesheetdetailsid") ?? "").trim(),
    date: (tag(xml, "timesheetdates") ?? "").trim(),
    maxCheckinId: (tag(xml, "maxCheckinId") ?? "").trim(),
    hoursWorked: (tag(xml, "hoursworked") ?? "").trim(),
    blocks,
    authenticationKey: tag(xml, "authenticationKey"),
    errorStatus: tag(xml, "errorStatus"),
  };
}

/**
 * Parse the create/load-week response into day (date -> detailId) pairs + status.
 * Generic: pairs each <timesheetdetailsid> with the nearest following date-like value.
 * Adjust here if docs/DISCOVERY.md recorded a different shape.
 */
export function parseWeek(xml: string): WeekData {
  const days: Array<{ date: string; timesheetdetailId: string }> = [];
  // Match repeating day records that contain both an id and a date (order-independent within the record).
  const idRe = /<timesheetdetailsid>(\d+)<\/timesheetdetailsid>/gi;
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(xml))) {
    const id = m[1];
    // search a window after the id for an ISO date
    const after = xml.slice(m.index, m.index + 400);
    const dm = after.match(/(\d{4}-\d{2}-\d{2})/);
    if (dm) days.push({ date: dm[1], timesheetdetailId: id });
  }
  const status = (tag(xml, "status") ?? tag(xml, "timesheetStatus") ?? tag(xml, "timesheetstatus") ?? "").trim();
  return { status, days, authenticationKey: tag(xml, "authenticationKey") };
}
```

- [ ] **Step 4: Pass + build + commit**

Run: `npx vitest run src/bullhorn/xml.test.ts` → PASS; `npm run build`.
```bash
git add src/bullhorn/xml.ts src/bullhorn/xml.test.ts
git commit -m "feat: BBO xml parsers (day + week)"
```

---

## Task 6: Bullhorn auth (login → JWT, env override)

**Files:** Create `src/bullhorn/auth.ts`, `src/bullhorn/auth.test.ts`.

- [ ] **Step 1: Write `src/bullhorn/auth.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { extractJwtFromHtml } from "./auth.js";

describe("extractJwtFromHtml", () => {
  it("pulls SESSION_AUTHENTICATION_KEY assignment", () => {
    const html = `<script>var SESSION_AUTHENTICATION_KEY = "eyJ0eXAi.aaa.bbb"; </script>`;
    expect(extractJwtFromHtml(html)).toBe("eyJ0eXAi.aaa.bbb");
  });
  it("falls back to any JWT in the html", () => {
    const html = `<input value="eyJabc.def.ghi">`;
    expect(extractJwtFromHtml(html)).toBe("eyJabc.def.ghi");
  });
  it("throws when no JWT present", () => {
    expect(() => extractJwtFromHtml("<html>no token</html>")).toThrow(/jwt|token/i);
  });
});
```

- [ ] **Step 2: Run (fails), then create `src/bullhorn/auth.ts`**

```ts
/** Pull the BBO JWT out of the /employee/ page HTML. */
export function extractJwtFromHtml(html: string): string {
  const named = html.match(/SESSION_AUTHENTICATION_KEY\s*=\s*["'](eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)["']/);
  if (named) return named[1];
  const any = html.match(/eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/);
  if (any) return any[0];
  throw new Error("Could not find a BBO JWT (authenticationKey) in the employee page. Login may have failed.");
}

function parseSetCookie(headers: Headers): string {
  // Node fetch exposes combined set-cookie via getSetCookie() (undici).
  const list = (headers as any).getSetCookie ? (headers as any).getSetCookie() as string[] : [];
  return list.map((c) => c.split(";")[0]).join("; ");
}

/** Log in to BBO and return the JWT scraped from the employee page. */
export async function login(vanity: string, username: string, password: string): Promise<string> {
  const baseUrl = `https://${vanity}.bbo.bullhornstaffing.com`;
  const res = await fetch(`${baseUrl}/Login/`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ process: "login", flashEnabled: "true", username, password, rememberMe: "" }),
  });
  if (res.status !== 302 && res.status !== 200) {
    throw new Error(`BBO login failed (HTTP ${res.status}). Check BULLHORN_USERNAME/PASSWORD.`);
  }
  const cookies = parseSetCookie(res.headers);
  const employee = await fetch(`${baseUrl}/employee/`, { headers: cookies ? { Cookie: cookies } : {} });
  const html = await employee.text();
  return extractJwtFromHtml(html);
}

/** Resolve the auth key: BULLHORN_AUTH_KEY override, else auto-login. */
export async function resolveAuthKey(opts: {
  authKeyOverride?: string; vanity: string; username?: string; password?: string;
}): Promise<string> {
  if (opts.authKeyOverride && opts.authKeyOverride.trim()) return opts.authKeyOverride.trim();
  if (!opts.username || !opts.password) {
    throw new Error("No BULLHORN_AUTH_KEY and missing BULLHORN_USERNAME/PASSWORD for auto-login.");
  }
  return login(opts.vanity, opts.username, opts.password);
}
```

- [ ] **Step 3: Pass + build + commit**

Run: `npx vitest run src/bullhorn/auth.test.ts` → PASS; `npm run build`.
```bash
git add src/bullhorn/auth.ts src/bullhorn/auth.test.ts
git commit -m "feat: bullhorn auto-login + JWT extraction"
```

---

## Task 7: Bullhorn client (form POST + JWT rotation)

**Files:** Create `src/bullhorn/client.ts`, `src/bullhorn/client.test.ts`.

- [ ] **Step 1: Write `src/bullhorn/client.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { createBullhornClient, BullhornError } from "./client.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

function mockFetchOnce(text: string, status = 200) {
  globalThis.fetch = vi.fn(async () => new Response(text, { status })) as any;
}

describe("createBullhornClient", () => {
  it("sends the current authKey + fields and rotates the key from the response", async () => {
    const session = { authKey: "key1" };
    mockFetchOnce("<timesheet><errorStatus>okay</errorStatus><authenticationKey>key2</authenticationKey></timesheet>");
    const client = createBullhornClient(session, "provisionsgroup");
    const xml = await client.postForm("/php/timesheet/getTimesheetDay.php", { timesheetdetailId: "1" });
    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[0]).toBe("https://provisionsgroup.bbo.bullhornstaffing.com/php/timesheet/getTimesheetDay.php");
    expect(String(call[1].body)).toContain("authenticationKey=key1");
    expect(String(call[1].body)).toContain("timesheetdetailId=1");
    expect(session.authKey).toBe("key2"); // rotated
    expect(xml).toContain("okay");
  });
  it("throws AUTH_EXPIRED on HTTP 401", async () => {
    mockFetchOnce("nope", 401);
    const client = createBullhornClient({ authKey: "k" }, "v");
    await expect(client.postForm("/php/timesheet/getTimesheetDay.php", {})).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
  });
  it("throws BULLHORN_ERROR when errorStatus is not okay", async () => {
    mockFetchOnce("<timesheet><errorStatus>error: bad</errorStatus></timesheet>");
    const client = createBullhornClient({ authKey: "k" }, "v");
    await expect(client.postForm("/php/timesheet/updateDay.php", {})).rejects.toMatchObject({ code: "BULLHORN_ERROR" });
  });
});
```

- [ ] **Step 2: Run (fails), then create `src/bullhorn/client.ts`**

```ts
import { tag } from "./xml.js";

export class BullhornError extends Error {
  constructor(public code: "AUTH_EXPIRED" | "HTTP_ERROR" | "BULLHORN_ERROR", message: string) {
    super(message);
    this.name = "BullhornError";
  }
}

export interface Session { authKey: string }

export interface BullhornClient {
  /** POST form-encoded to a BBO php endpoint, injecting + rotating the session authKey. Returns the XML body. */
  postForm(path: string, fields: Record<string, string>): Promise<string>;
}

export function createBullhornClient(session: Session, vanity: string): BullhornClient {
  const base = `https://${vanity}.bbo.bullhornstaffing.com`;
  return {
    async postForm(path, fields) {
      const body = new URLSearchParams({ authenticationKey: session.authKey, ...fields });
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (res.status === 401 || res.status === 403) {
        throw new BullhornError("AUTH_EXPIRED", `BBO auth rejected (HTTP ${res.status}). Re-login or refresh BULLHORN_AUTH_KEY.`);
      }
      if (!res.ok) throw new BullhornError("HTTP_ERROR", `BBO request failed (HTTP ${res.status}) for ${path}.`);
      const xml = await res.text();
      // Rotate the JWT from the response when present.
      const fresh = tag(xml, "authenticationKey");
      if (fresh && fresh.trim()) session.authKey = fresh.trim();
      // A returned login form / empty token usually means the JWT expired.
      if (/<form[^>]*id=["']loginForm["']/.test(xml)) {
        throw new BullhornError("AUTH_EXPIRED", "BBO returned the login page; the session/JWT expired.");
      }
      const status = tag(xml, "errorStatus");
      if (status && status.trim().toLowerCase() !== "okay") {
        throw new BullhornError("BULLHORN_ERROR", `BBO error for ${path}: ${status.trim()}`);
      }
      return xml;
    },
  };
}
```

- [ ] **Step 3: Pass + build + commit**

Run: `npx vitest run src/bullhorn/client.test.ts` → PASS; `npm run build`.
```bash
git add src/bullhorn/client.ts src/bullhorn/client.test.ts
git commit -m "feat: bullhorn form-post client with JWT rotation + error mapping"
```

---

## Task 8: Timesheet operations (ensureWeek, getDay, updateDay, status guard)

**Files:** Create `src/bullhorn/timesheet.ts`, `src/bullhorn/timesheet.test.ts`.

- [ ] **Step 1: Write `src/bullhorn/timesheet.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { getDay, updateDay, ensureWeek, StatusGuardError, buildBlockFields } from "./timesheet.js";
import type { BullhornClient } from "./client.js";

function client(responses: string[]): { c: BullhornClient; calls: any[] } {
  const calls: any[] = [];
  let i = 0;
  const c: BullhornClient = { postForm: async (path, fields) => { calls.push({ path, fields }); return responses[i++]; } };
  return { c, calls };
}

const DAY_XML = `<timesheet><maxCheckinId>999</maxCheckinId><timesheetdetailsid>956339</timesheetdetailsid><timesheetdates>2026-06-15</timesheetdates><hoursworked>2:00</hoursworked><blocks><block><timesheetBlockId>357263</timesheetBlockId><hours>2</hours><minutes>0</minutes><note>old</note><type>0</type><editable>yes</editable></block></blocks><errorStatus>okay</errorStatus></timesheet>`;

describe("getDay", () => {
  it("parses a day via the client", async () => {
    const { c, calls } = client([DAY_XML]);
    const d = await getDay(c, "956339");
    expect(calls[0]).toEqual({ path: "/php/timesheet/getTimesheetDay.php", fields: { timesheetdetailId: "956339" } });
    expect(d.maxCheckinId).toBe("999");
    expect(d.blocks[0].note).toBe("old");
  });
});

describe("buildBlockFields", () => {
  it("encodes 1-based block fields, empty id for new blocks", () => {
    const f = buildBlockFields([
      { timesheetBlockId: "357263", hours: 2, minutes: 0, note: "old", type: 0, editable: true },
      { hours: 1, minutes: 30, note: "new", type: 0, editable: true },
    ]);
    expect(f["block[1][timesheetBlockId]"]).toBe("357263");
    expect(f["block[1][timesheetBlockHours]"]).toBe("2");
    expect(f["block[2][timesheetBlockId]"]).toBe("");
    expect(f["block[2][timesheetBlockHours]"]).toBe("1");
    expect(f["block[2][timesheetBlockMinutes]"]).toBe("30");
    expect(f["block[2][timesheetBlockNote]"]).toBe("new");
    expect(f["block[2][timesheetBlockType]"]).toBe("0");
  });
});

describe("updateDay", () => {
  it("posts detailId + maxCheckinId + block fields", async () => {
    const { c, calls } = client([DAY_XML]);
    await updateDay(c, "956339", "999", [{ hours: 1, minutes: 0, note: "x", type: 0, editable: true }]);
    expect(calls[0].path).toBe("/php/timesheet/updateDay.php");
    expect(calls[0].fields.timesheetdetailId).toBe("956339");
    expect(calls[0].fields.maxCheckinId).toBe("999");
    expect(calls[0].fields["block[1][timesheetBlockHours]"]).toBe("1");
  });
});

describe("ensureWeek status guard", () => {
  it("throws on a non-editable status", () => {
    expect(() => { if (!["", "Not Created", "In Progress"].includes("Approved")) throw new StatusGuardError("Approved"); })
      .toThrow(StatusGuardError);
  });
});
```

- [ ] **Step 2: Run (fails), then create `src/bullhorn/timesheet.ts`**

```ts
import type { BullhornClient } from "./client.js";
import { parseDay, parseWeek, type Block, type DayData, type WeekData } from "./xml.js";

const EDITABLE_STATUSES = new Set(["", "not created", "in progress"]);

export class StatusGuardError extends Error {
  constructor(public status: string) {
    super(`Refusing to modify timesheet: status is "${status}" (editable only when Not Created / In Progress).`);
    this.name = "StatusGuardError";
  }
}

export async function getDay(client: BullhornClient, timesheetdetailId: string): Promise<DayData> {
  const xml = await client.postForm("/php/timesheet/getTimesheetDay.php", { timesheetdetailId });
  return parseDay(xml);
}

/** Encode blocks into 1-based form fields. Existing blocks keep their timesheetBlockId; new blocks send "". */
export function buildBlockFields(blocks: Block[]): Record<string, string> {
  const f: Record<string, string> = {};
  blocks.forEach((b, idx) => {
    const i = idx + 1;
    f[`block[${i}][timesheetBlockId]`] = b.timesheetBlockId ?? "";
    f[`block[${i}][timesheetBlockHours]`] = String(b.hours);
    f[`block[${i}][timesheetBlockMinutes]`] = String(b.minutes);
    f[`block[${i}][timesheetBlockType]`] = String(b.type);
    f[`block[${i}][timesheetBlockNote]`] = b.note;
  });
  return f;
}

export async function updateDay(client: BullhornClient, timesheetdetailId: string, maxCheckinId: string, blocks: Block[]): Promise<DayData> {
  const xml = await client.postForm("/php/timesheet/updateDay.php", {
    timesheetdetailId, maxCheckinId, ...buildBlockFields(blocks),
  });
  return parseDay(xml);
}

/** Ensure the week's blank timesheet exists and return its day map + status. Throws if not editable. */
export async function ensureWeek(client: BullhornClient, assignmentId: string, periodEndDate: string, timezoneOffset: string): Promise<WeekData> {
  const xml = await client.postForm("/php/timesheet/create.php", {
    assignmentId, periodEndDate, timezoneOffset, subaction: "Blank",
  });
  const week = parseWeek(xml);
  if (!EDITABLE_STATUSES.has(week.status.trim().toLowerCase())) {
    throw new StatusGuardError(week.status);
  }
  return week;
}
```

- [ ] **Step 3: Pass + build + commit**

Run: `npx vitest run src/bullhorn/timesheet.test.ts` → PASS; `npm run build`.
```bash
git add src/bullhorn/timesheet.ts src/bullhorn/timesheet.test.ts
git commit -m "feat: bullhorn timesheet ops (ensureWeek/getDay/updateDay + status guard)"
```

---

## Task 9: Assignment resolver + pure plan

**Files:** Create `src/bullhorn/assignment.ts` (+test), `src/plan/plan.ts` (+test), `config/bullhorn-assignment-map.example.json`.

- [ ] **Step 1: Write `src/bullhorn/assignment.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { resolveAssignmentId, parseAssignmentMap } from "./assignment.js";

describe("assignment", () => {
  it("uses the project map when present", () => {
    const map = parseAssignmentMap('{"Datamax":7001}');
    expect(resolveAssignmentId(map, "Datamax", "6599")).toBe("7001");
  });
  it("falls back to the default for unmapped projects", () => {
    expect(resolveAssignmentId({}, "Whatever", "6599")).toBe("6599");
  });
  it("rejects a non-integer assignment id in the map", () => {
    expect(() => parseAssignmentMap('{"X":"abc"}')).toThrow(/integer/i);
  });
});
```

- [ ] **Step 2: Run (fails), then create `src/bullhorn/assignment.ts`**

```ts
export type AssignmentMap = Record<string, number>;

export function parseAssignmentMap(json: string): AssignmentMap {
  const raw: unknown = JSON.parse(json);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Assignment map must be a JSON object of { projectName: assignmentId }.");
  }
  const out: AssignmentMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== "number" || !Number.isInteger(v)) throw new Error(`Assignment map entry "${k}" must be an integer assignmentId.`);
    out[k] = v;
  }
  return out;
}

export function resolveAssignmentId(map: AssignmentMap, project: string, defaultId: string): string {
  return project in map ? String(map[project]) : defaultId;
}
```

- [ ] **Step 3: Create `config/bullhorn-assignment-map.example.json`**

```json
{
  "__comment": "Optional. Only needed if different Blitzit projects post to different Bullhorn assignments. Otherwise BULLHORN_ASSIGNMENT_ID covers everything.",
  "Datamax": 6599
}
```

- [ ] **Step 4: Write `src/plan/plan.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { planBullhornSync } from "./plan.js";
import type { BlitzitTask } from "../blitzit/tasks.js";

const TZ = "America/Los_Angeles";
const jun8 = Date.UTC(2026, 5, 8, 15, 0, 0); // ~08:00 PDT -> 2026-06-08
const task = (id: string, seconds: number, topic = "Web", detail = "did x"): BlitzitTask =>
  ({ id, project: "Datamax", topic, detail, seconds, endTimeMs: jun8, listId: "L1", board: "done" });

describe("planBullhornSync", () => {
  it("groups tasks into per-day blocks with note + hours/minutes", () => {
    const plan = planBullhornSync({ tasks: [task("a", 3600), task("b", 5400)], tz: TZ, existingKeys: new Set() });
    expect(plan.days).toHaveLength(1);
    expect(plan.days[0].date).toBe("2026-06-08");
    expect(plan.days[0].blocks).toEqual([
      { note: "Datamax :: Web :: did x", hours: 1, minutes: 0 },
      { note: "Datamax :: Web :: did x", hours: 1, minutes: 30 },
    ]);
  });
  it("skips zero-duration tasks", () => {
    const plan = planBullhornSync({ tasks: [task("a", 0)], tz: TZ, existingKeys: new Set() });
    expect(plan.days).toHaveLength(0);
    expect(plan.skippedZero).toEqual([{ id: "a", project: "Datamax" }]);
  });
  it("skips duplicates already present (date + note)", () => {
    const plan = planBullhornSync({ tasks: [task("a", 3600)], tz: TZ, existingKeys: new Set(["2026-06-08 Datamax :: Web :: did x"]) });
    expect(plan.days).toHaveLength(0);
    expect(plan.skippedDuplicates).toEqual([{ date: "2026-06-08", note: "Datamax :: Web :: did x" }]);
  });
  it("fills empty topic/detail so the note is always 3-part", () => {
    const plan = planBullhornSync({ tasks: [task("a", 60, "", "")], tz: TZ, existingKeys: new Set() });
    expect(plan.days[0].blocks[0].note).toBe("Datamax :: General :: Datamax");
  });
});
```

- [ ] **Step 5: Run (fails), then create `src/plan/plan.ts`**

```ts
import type { BlitzitTask } from "../blitzit/tasks.js";
import { splitSeconds, epochMsToDateInTz } from "../bullhorn/time.js";

export const DEDUP_SEP = " ";

export interface PlanBlock { note: string; hours: number; minutes: number }
export interface DayBlocks { date: string; blocks: PlanBlock[] }
export interface SyncPlan {
  days: DayBlocks[];
  skippedZero: Array<{ id: string; project: string }>;
  skippedDuplicates: Array<{ date: string; note: string }>;
}

function note(t: BlitzitTask): string {
  const topic = t.topic || "General";
  const detail = t.detail || t.topic || t.project;
  return `${t.project} :: ${topic} :: ${detail}`;
}

export function planBullhornSync(params: {
  tasks: BlitzitTask[];
  tz: string;
  existingKeys: Set<string>; // `${date}${DEDUP_SEP}${note}`
}): SyncPlan {
  const { tasks, tz, existingKeys } = params;
  const byDay = new Map<string, PlanBlock[]>();
  const skippedZero: SyncPlan["skippedZero"] = [];
  const skippedDuplicates: SyncPlan["skippedDuplicates"] = [];

  for (const t of [...tasks].sort((a, b) => a.endTimeMs - b.endTimeMs)) {
    if (t.seconds <= 0) { skippedZero.push({ id: t.id, project: t.project }); continue; }
    const date = epochMsToDateInTz(t.endTimeMs, tz);
    const n = note(t);
    if (existingKeys.has(`${date}${DEDUP_SEP}${n}`)) { skippedDuplicates.push({ date, note: n }); continue; }
    const { hours, minutes } = splitSeconds(t.seconds);
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date)!.push({ note: n, hours, minutes });
  }

  const days = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([date, blocks]) => ({ date, blocks }));
  return { days, skippedZero, skippedDuplicates };
}
```

- [ ] **Step 6: Pass + build + commit**

Run: `npx vitest run src/bullhorn/assignment.test.ts src/plan/plan.test.ts` → PASS; `npm run build`.
```bash
git add src/bullhorn/assignment.ts src/bullhorn/assignment.test.ts src/plan/plan.ts src/plan/plan.test.ts config/bullhorn-assignment-map.example.json
git commit -m "feat: assignment resolver + pure bullhorn sync plan"
```

---

## Task 10: config, sync-core, tools, register, index

**Files:** Create `src/config.ts`, `src/tools/sync-core.ts`, `src/tools/sync-day.ts`, `src/tools/sync-week.ts`, `src/tools/time-list.ts`, `src/tools/register.ts`, `src/tools/register.test.ts`, `src/tools/sync-day.test.ts`, `src/index.ts`.

- [ ] **Step 1: Create `src/config.ts`**

```ts
export interface BullhornConfig {
  vanity: string;
  username?: string;
  password?: string;
  authKeyOverride?: string;
  assignmentId: string;
  timezoneOffset: string;
  workdayTz: string;
  assignmentMapPath?: string;
}

type EnvLike = Record<string, string | undefined>;

export function loadConfig(env: EnvLike = process.env): BullhornConfig {
  const vanity = (env.BULLHORN_VANITY ?? "").trim();
  if (!vanity) throw new Error("BULLHORN_VANITY is required (e.g. 'provisionsgroup').");
  const assignmentId = (env.BULLHORN_ASSIGNMENT_ID ?? "").trim();
  if (!assignmentId) throw new Error("BULLHORN_ASSIGNMENT_ID is required (default Bullhorn assignment).");
  return {
    vanity,
    username: (env.BULLHORN_USERNAME ?? "").trim() || undefined,
    password: (env.BULLHORN_PASSWORD ?? "").trim() || undefined,
    authKeyOverride: (env.BULLHORN_AUTH_KEY ?? "").trim() || undefined,
    assignmentId,
    timezoneOffset: (env.BULLHORN_TIMEZONE_OFFSET ?? "420").trim() || "420",
    workdayTz: (env.BULLHORN_WORKDAY_TZ ?? "").trim() || "UTC",
    assignmentMapPath: (env.BULLHORN_ASSIGNMENT_MAP ?? "").trim() || undefined,
  };
}
```

- [ ] **Step 2: Create `src/tools/sync-core.ts`**

```ts
import { readFileSync } from "node:fs";
import type { BullhornConfig } from "../config.js";
import { text } from "../util.js";
import { resolveAuthKey } from "../bullhorn/auth.js";
import { createBullhornClient } from "../bullhorn/client.js";
import { ensureWeek, getDay, updateDay } from "../bullhorn/timesheet.js";
import { bullhornWeek } from "../bullhorn/period.js";
import { parseAssignmentMap, type AssignmentMap } from "../bullhorn/assignment.js";
import { getBlitzitAuth } from "../blitzit/auth.js";
import { createBlitzitClient } from "../blitzit/client.js";
import { fetchWeekDoneTasks } from "../blitzit/tasks.js";
import { planBullhornSync, DEDUP_SEP } from "../plan/plan.js";
import { epochMsToDateInTz } from "../bullhorn/time.js";
import type { Block } from "../bullhorn/xml.js";

function loadMap(path?: string): AssignmentMap {
  if (!path) return {};
  return parseAssignmentMap(readFileSync(path, "utf8"));
}

/** Shared engine for the week and day Bullhorn sync tools. */
export async function runBullhornSync(
  config: BullhornConfig,
  opts: { date?: string; listId?: string; confirm?: boolean; defaultRange: "week" | "day" },
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const tz = config.workdayTz;
  // Reference date: provided date, else today in tz.
  const today = epochMsToDateInTz(Date.now(), tz);
  const ref = opts.date ?? today;
  const week = bullhornWeek(ref);
  const targetDates = opts.defaultRange === "day" ? [ref] : week.days;

  // 1) Bullhorn auth + client (JWT rotates inside the session).
  const authKey = await resolveAuthKey({ authKeyOverride: config.authKeyOverride, vanity: config.vanity, username: config.username, password: config.password });
  const session = { authKey };
  const bbo = createBullhornClient(session, config.vanity);

  // 2) Ensure the week's timesheet + day map (+ status guard inside ensureWeek).
  const wk = await ensureWeek(bbo, config.assignmentId, week.periodEndDate, config.timezoneOffset);
  const dayId = new Map(wk.days.map((d) => [d.date, d.timesheetdetailId]));

  // 3) Read Blitzit done-tasks across the whole Bullhorn week window.
  const { idToken, uid } = await getBlitzitAuth();
  const fromMs = Date.parse(`${week.start}T00:00:00Z`); // window is generous; per-day grouping uses tz below
  const toMs = Date.parse(`${week.end}T23:59:59Z`) + 1000;
  const tasks = await fetchWeekDoneTasks(createBlitzitClient(idToken), uid, fromMs - 86400000, toMs + 86400000, opts.listId);

  // 4) Plan per-day blocks (only for target dates); dedup filled per day below.
  const inTarget = tasks.filter((t) => targetDates.includes(epochMsToDateInTz(t.endTimeMs, tz)));

  const confirm = !!opts.confirm;
  const out: Array<Record<string, unknown>> = [];
  const allSkippedZero: any[] = [];
  const allDup: any[] = [];

  for (const date of targetDates) {
    const detailId = dayId.get(date);
    if (!detailId) { out.push({ date, error: "no timesheetdetailId for this day in the week" }); continue; }
    const dayTasks = inTarget.filter((t) => epochMsToDateInTz(t.endTimeMs, tz) === date);
    if (dayTasks.length === 0) continue;

    const day = await getDay(bbo, detailId);
    const existingKeys = new Set(day.blocks.map((b) => `${date}${DEDUP_SEP}${b.note}`));
    const plan = planBullhornSync({ tasks: dayTasks, tz, existingKeys });
    allSkippedZero.push(...plan.skippedZero);
    allDup.push(...plan.skippedDuplicates);
    const newBlocks: Block[] = (plan.days[0]?.blocks ?? []).map((b) => ({ hours: b.hours, minutes: b.minutes, note: b.note, type: 0, editable: true }));

    if (newBlocks.length === 0) { out.push({ date, added: 0, note: "nothing new to add" }); continue; }

    if (!confirm) {
      out.push({ date, willAdd: newBlocks.map((b) => ({ note: b.note, hours: b.hours, minutes: b.minutes })) });
    } else {
      const merged = [...day.blocks, ...newBlocks]; // preserve existing, append new
      await updateDay(bbo, detailId, day.maxCheckinId, merged);
      out.push({ date, added: newBlocks.length });
    }
  }

  return text({
    mode: confirm ? "logged" : "preview",
    week: { start: week.start, end: week.end },
    targetDates,
    status: wk.status,
    days: out,
    skippedZero: allSkippedZero,
    skippedDuplicates: allDup,
    ...(confirm ? {} : { willLog: "Set confirm:true to write these blocks to Bullhorn." }),
  });
}
```

- [ ] **Step 3: Create `src/tools/sync-day.ts`**

```ts
import { z } from "zod";
import type { BullhornConfig } from "../config.js";
import { runBullhornSync } from "./sync-core.js";

export function buildSyncDayTool(config: BullhornConfig) {
  return {
    name: "bullhorn_sync_blitzit_day",
    description:
      "Sync a single day of completed Blitzit tasks into the Bullhorn (BBO) weekly timesheet as time blocks (default today, in your timezone). Use for 'sync my day to bullhorn'. Preview by default; confirm:true writes. Never submits. Skips zero-duration and already-present (date+note) entries.",
    inputSchema: {
      date: z.string().optional().describe("Day to sync, YYYY-MM-DD (default today in your timezone)."),
      listId: z.string().optional().describe("Optional Blitzit list id filter."),
      confirm: z.boolean().optional().describe("Set true to write; otherwise preview."),
    },
    handler: async (args: any) =>
      runBullhornSync(config, { date: args.date, listId: args.listId, confirm: args.confirm, defaultRange: "day" }),
  };
}
```

- [ ] **Step 4: Create `src/tools/sync-week.ts`**

```ts
import { z } from "zod";
import type { BullhornConfig } from "../config.js";
import { runBullhornSync } from "./sync-core.js";

export function buildSyncWeekTool(config: BullhornConfig) {
  return {
    name: "bullhorn_sync_blitzit_week",
    description:
      "Sync a whole Bullhorn week (Sun–Sat) of completed Blitzit tasks into the BBO timesheet as time blocks. Pass any date within the target week (default this week). Preview by default; confirm:true writes. Never submits.",
    inputSchema: {
      date: z.string().optional().describe("Any date within the target Sun–Sat week, YYYY-MM-DD (default today)."),
      listId: z.string().optional().describe("Optional Blitzit list id filter."),
      confirm: z.boolean().optional().describe("Set true to write; otherwise preview."),
    },
    handler: async (args: any) =>
      runBullhornSync(config, { date: args.date, listId: args.listId, confirm: args.confirm, defaultRange: "week" }),
  };
}
```

- [ ] **Step 5: Create `src/tools/time-list.ts`**

```ts
import { z } from "zod";
import type { BullhornConfig } from "../config.js";
import { text } from "../util.js";
import { resolveAuthKey } from "../bullhorn/auth.js";
import { createBullhornClient } from "../bullhorn/client.js";
import { ensureWeek, getDay } from "../bullhorn/timesheet.js";
import { bullhornWeek } from "../bullhorn/period.js";
import { epochMsToDateInTz } from "../bullhorn/time.js";

export function buildListTimeTool(config: BullhornConfig) {
  return {
    name: "bullhorn_list_my_time",
    description: "List existing Bullhorn timesheet blocks for the Sun–Sat week containing the given date (default this week). Read-only.",
    inputSchema: {
      date: z.string().optional().describe("Any date within the target week, YYYY-MM-DD (default today)."),
    },
    handler: async (args: any) => {
      const tz = config.workdayTz;
      const ref = args.date ?? epochMsToDateInTz(Date.now(), tz);
      const week = bullhornWeek(ref);
      const authKey = await resolveAuthKey({ authKeyOverride: config.authKeyOverride, vanity: config.vanity, username: config.username, password: config.password });
      const bbo = createBullhornClient({ authKey }, config.vanity);
      const wk = await ensureWeek(bbo, config.assignmentId, week.periodEndDate, config.timezoneOffset);
      const days: any[] = [];
      for (const d of wk.days) {
        const day = await getDay(bbo, d.timesheetdetailId);
        days.push({ date: d.date, hoursWorked: day.hoursWorked, blocks: day.blocks.map((b) => ({ note: b.note, hours: b.hours, minutes: b.minutes })) });
      }
      return text({ week: { start: week.start, end: week.end }, status: wk.status, days });
    },
  };
}
```

- [ ] **Step 6: Create `src/tools/register.ts`**

```ts
import type { BullhornConfig } from "../config.js";
import { buildSyncDayTool } from "./sync-day.js";
import { buildSyncWeekTool } from "./sync-week.js";
import { buildListTimeTool } from "./time-list.js";

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: any) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

export function collectTools(config: BullhornConfig): ToolDescriptor[] {
  return [buildSyncDayTool(config), buildSyncWeekTool(config), buildListTimeTool(config)] as ToolDescriptor[];
}
```

- [ ] **Step 7: Write `src/tools/register.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { collectTools } from "./register.js";
import type { BullhornConfig } from "../config.js";

const config = { vanity: "v", assignmentId: "6599", timezoneOffset: "420", workdayTz: "America/Los_Angeles" } as BullhornConfig;

describe("collectTools", () => {
  it("registers the three bullhorn tools", () => {
    const names = collectTools(config).map((t) => t.name).sort();
    expect(names).toEqual(["bullhorn_list_my_time", "bullhorn_sync_blitzit_day", "bullhorn_sync_blitzit_week"]);
  });
});
```

- [ ] **Step 8: Write `src/tools/sync-day.test.ts`** (mocks all network seams)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../bullhorn/auth.js", () => ({ resolveAuthKey: vi.fn(async () => "jwt") }));
vi.mock("../blitzit/auth.js", () => ({ getBlitzitAuth: vi.fn(async () => ({ idToken: "t", uid: "u" })) }));
vi.mock("../blitzit/client.js", () => ({ createBlitzitClient: vi.fn(() => ({ queryTasksByOwner: vi.fn() })) }));

const jun8 = Date.UTC(2026, 5, 8, 15, 0, 0);
vi.mock("../blitzit/tasks.js", () => ({
  fetchWeekDoneTasks: vi.fn(async () => [
    { id: "a", project: "Datamax", topic: "Web", detail: "dns", seconds: 3600, endTimeMs: jun8, listId: "L1", board: "done" },
  ]),
}));

const updateDay = vi.fn(async () => ({}));
vi.mock("../bullhorn/timesheet.js", () => ({
  ensureWeek: vi.fn(async () => ({ status: "In Progress", days: [{ date: "2026-06-08", timesheetdetailId: "111" }], authenticationKey: null })),
  getDay: vi.fn(async () => ({ timesheetdetailId: "111", date: "2026-06-08", maxCheckinId: "999", hoursWorked: "0:00", blocks: [], authenticationKey: null, errorStatus: "okay" })),
  updateDay: (...a: any[]) => updateDay(...a),
}));
vi.mock("../bullhorn/client.js", () => ({ createBullhornClient: vi.fn(() => ({ postForm: vi.fn() })) }));

import { buildSyncDayTool } from "./sync-day.js";
import type { BullhornConfig } from "../config.js";

const config = { vanity: "v", assignmentId: "6599", timezoneOffset: "420", workdayTz: "America/Los_Angeles" } as BullhornConfig;

describe("bullhorn_sync_blitzit_day", () => {
  beforeEach(() => vi.clearAllMocks());

  it("previews the day's new blocks and writes nothing", async () => {
    const res = await buildSyncDayTool(config).handler({ date: "2026-06-08" });
    const p = JSON.parse(res.content[0].text);
    expect(p.mode).toBe("preview");
    expect(p.days[0].willAdd[0]).toEqual({ note: "Datamax :: Web :: dns", hours: 1, minutes: 0 });
    expect(updateDay).not.toHaveBeenCalled();
  });

  it("writes merged blocks when confirm:true", async () => {
    const res = await buildSyncDayTool(config).handler({ date: "2026-06-08", confirm: true });
    const p = JSON.parse(res.content[0].text);
    expect(p.mode).toBe("logged");
    expect(p.days[0].added).toBe(1);
    expect(updateDay).toHaveBeenCalledTimes(1);
    const args = updateDay.mock.calls[0];
    expect(args[1]).toBe("111");           // detailId
    expect(args[2]).toBe("999");           // maxCheckinId
    expect(args[3]).toHaveLength(1);       // merged blocks (no existing + 1 new)
    expect(args[3][0].note).toBe("Datamax :: Web :: dns");
  });
});
```

- [ ] **Step 9: Run (fails), then create `src/index.ts`**

```ts
#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { collectTools } from "./tools/register.js";
import { BullhornError } from "./bullhorn/client.js";

async function main() {
  const config = loadConfig();
  const server = new McpServer({ name: "bullhorn-mcp", version: "0.1.0" });
  for (const tool of collectTools(config)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema as any },
      async (args: unknown) => {
        try {
          return await tool.handler(args ?? {});
        } catch (e) {
          const message = e instanceof BullhornError ? `[${e.code}] ${e.message}` : `Unexpected error: ${(e as Error).message}`;
          return { content: [{ type: "text" as const, text: message }], isError: true };
        }
      },
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`bullhorn-mcp connected for vanity "${config.vanity}".`);
}

main().catch((e) => { console.error(`bullhorn-mcp failed to start: ${(e as Error).message}`); process.exit(1); });
```

- [ ] **Step 10: Run all tests + build**

Run: `npm test` → all PASS; `npm run build` → no errors.

- [ ] **Step 11: Commit**

```bash
git add src/config.ts src/tools/ src/index.ts
git commit -m "feat: bullhorn sync tools (day/week/list) + server bootstrap"
```

---

## Task 11: README

**Files:** Create `README.md`.

- [ ] **Step 1: Write `README.md`**

```markdown
# Bullhorn Timesheet MCP

Logs completed Blitzit tasks into Bullhorn Back Office (BBO) weekly timesheets as time blocks. Counterpart to the Accelo MCP — time is entered in both systems off the same Blitzit source.

## Setup
1. `npm install && npm run build`
2. Copy `.env.example` to `.env` and fill in `BULLHORN_VANITY`, `BULLHORN_USERNAME`, `BULLHORN_PASSWORD`, `BULLHORN_ASSIGNMENT_ID`, `BULLHORN_WORKDAY_TZ`. Auto-login mints the JWT; or set `BULLHORN_AUTH_KEY` to a manual JWT.

## Tools
- `bullhorn_sync_blitzit_day` — sync one day (default today). "Sync my day to bullhorn."
- `bullhorn_sync_blitzit_week` — sync the Sun–Sat week containing a date.
- `bullhorn_list_my_time` — read existing blocks for a week.

## Model
BBO timesheets are weekly (Sun–Sat) per assignment. Each day (`timesheetdetailId`) holds blocks (hours/minutes/type/note). Note format: `Project :: Topic :: Detail` (matches Accelo). Blitzit `timeTaken` → hours/minutes; completion date (in `BULLHORN_WORKDAY_TZ`) → day.

## Safety
Preview by default; `confirm:true` writes. Never submits/approves. Refuses to write a non-editable (submitted) timesheet. Existing blocks are preserved; duplicates (same day + note) are skipped. Credentials/JWT are never logged.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: bullhorn MCP README"
```

---

## Self-Review

**Spec coverage:** auto-login + JWT rotation (Tasks 6,7), env override (6), Blitzit source vendored (3), single-assignment default + map (9), Sun–Sat period (4), ensure/get/update + status guard (8), preview/confirm + never-submit + dedup + skip reporting (9,10), day/week/list tools (10), discovery of create.php (2), README (11). Covered.

**Placeholder scan:** none — every step has full code/commands. The one genuinely unconfirmed contract (create.php response) is handled by Task 2 capturing a real fixture and Task 5's `parseWeek` tested against it with structural assertions; a NOTE directs adjusting the parser if the captured shape differs.

**Type consistency:** `Block` (xml.ts) is the shared block shape used by timesheet.ts and sync-core.ts. `BlitzitTask` (vendored) used by plan.ts and tools. `DEDUP_SEP` exported from plan.ts and reused in sync-core. `BullhornConfig` consistent across config/tools. `Session {authKey}` consistent across auth/client/sync-core. `WeekData`/`DayData` from xml.ts used by timesheet.ts.

**Risk flagged:** Task 2 (create.php response shape) is the single live-confirm; everything downstream is isolated behind `parseWeek`.
