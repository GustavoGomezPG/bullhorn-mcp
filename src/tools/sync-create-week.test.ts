import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// getData.php is the week source of truth. "empty" = week not created yet (0 day rows),
// "populated" = the real 7-day week XML returned after create.php.
const populated = readFileSync(join(process.cwd(), "tests/fixtures/getdata-week.xml"), "utf8");
const empty = readFileSync(join(process.cwd(), "tests/fixtures/getdata-empty.xml"), "utf8");

const resolveAuth = vi.fn(async (..._a: any[]) => ({ jwt: "jwt", landingHtml: null }));
vi.mock("../bullhorn/auth.js", () => ({ resolveAuth: (...a: any[]) => resolveAuth(...a) }));
vi.mock("../blitzit/auth.js", () => ({ getBlitzitAuth: vi.fn(async () => ({ idToken: "t", uid: "u" })) }));
vi.mock("../blitzit/client.js", () => ({ createBlitzitClient: vi.fn(() => ({ queryTasksByOwner: vi.fn() })) }));

// Stateful BBO client: getData.php returns the empty week until create.php is POSTed,
// then returns the populated week (when createActuallyWorks). create.php itself returns
// BBO's "okay" response. createActuallyWorks=false models "created but week still won't load".
let weekCreated = false;
let createActuallyWorks = true;
const postForm = vi.fn(async (path: string, ..._a: any[]) => {
  if (path.includes("create.php")) { weekCreated = true; return "<response><errorStatus>okay</errorStatus></response>"; }
  if (path.includes("getData.php")) return weekCreated && createActuallyWorks ? populated : empty;
  return "<response><errorStatus>okay</errorStatus></response>";
});
vi.mock("../bullhorn/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bullhorn/client.js")>();
  return { ...actual, createBullhornClient: vi.fn(() => ({ postForm })) };
});

const jun15 = Date.UTC(2026, 5, 15, 16, 0, 0); // 09:00 PDT -> 2026-06-15
vi.mock("../blitzit/tasks.js", () => ({
  fetchWeekDoneTasks: vi.fn(async () => [
    { id: "a", project: "Datamax", topic: "Web", detail: "dns", seconds: 3600, endTimeMs: jun15, listId: "L1", board: "done" },
  ]),
}));

const getDay = vi.fn(async (..._a: any[]) => ({ timesheetdetailId: "956339", date: "2026-06-15", maxCheckinId: "999", hoursWorked: "0:00", blocks: [], authenticationKey: null, errorStatus: "okay" }));
const updateDay = vi.fn(async (..._a: any[]) => ({}));
vi.mock("../bullhorn/timesheet.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bullhorn/timesheet.js")>();
  return { ...actual, getDay: (...a: any[]) => getDay(...a), updateDay: (...a: any[]) => updateDay(...a) };
});

import { buildSyncDayTool } from "./sync-day.js";
import type { BullhornConfig } from "../config.js";

const config = { vanity: "v", assignmentId: "6599", timezoneOffset: "420", workdayTz: "America/Los_Angeles" } as BullhornConfig;

describe("auto-create week when getData.php has no day rows", () => {
  beforeEach(() => { vi.clearAllMocks(); weekCreated = false; createActuallyWorks = true; });

  it("creates the current week then re-fetches and previews", async () => {
    const res = await buildSyncDayTool(config).handler({ date: "2026-06-15" });
    const p = JSON.parse(res.content[0].text);

    // create.php was POSTed with the Saturday period-end (yy-mm-dd) + assignment/timezone.
    const createCall = postForm.mock.calls.find((c) => String(c[0]).includes("create.php"));
    expect(createCall).toBeTruthy();
    expect(createCall![1]).toMatchObject({ assignmentId: "6599", timezoneOffset: "420", subaction: "Blank" });
    expect(createCall![1].periodEndDate).toMatch(/^\d{2}-\d{2}-\d{2}$/);

    // getData.php was hit twice: once before create (empty) and once after (populated).
    const getDataCalls = postForm.mock.calls.filter((c) => String(c[0]).includes("getData.php"));
    expect(getDataCalls.length).toBe(2);

    // No re-login needed — a single auth resolve, JWT reused across the client.
    expect(resolveAuth).toHaveBeenCalledTimes(1);

    // And the sync proceeded normally on the re-fetched week.
    expect(p.error).toBeUndefined();
    expect(p.mode).toBe("preview");
    expect(p.days[0].willAdd[0]).toEqual({ note: "Datamax :: Web :: dns", hours: 1, minutes: 0 });
  });

  it("errors clearly if the week still won't load after creation", async () => {
    createActuallyWorks = false; // create.php returns okay but getData.php stays empty

    const res = await buildSyncDayTool(config).handler({ date: "2026-06-15" });
    const p = JSON.parse(res.content[0].text);
    expect(p.error).toMatch(/created the bullhorn week/i);
    expect(updateDay).not.toHaveBeenCalled();
  });
});
