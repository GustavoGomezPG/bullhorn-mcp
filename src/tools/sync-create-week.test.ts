import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const populated = readFileSync(join(process.cwd(), "tests/fixtures/employee-week.html"), "utf8");
const empty = readFileSync(join(process.cwd(), "tests/fixtures/employee-week-empty.html"), "utf8");

const resolveAuth = vi.fn();
vi.mock("../bullhorn/auth.js", () => ({ resolveAuth: (...a: any[]) => resolveAuth(...a) }));
vi.mock("../blitzit/auth.js", () => ({ getBlitzitAuth: vi.fn(async () => ({ idToken: "t", uid: "u" })) }));
vi.mock("../blitzit/client.js", () => ({ createBlitzitClient: vi.fn(() => ({ queryTasksByOwner: vi.fn() })) }));

const postForm = vi.fn(async (..._a: any[]) => "<response><errorStatus>okay</errorStatus></response>");
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

describe("auto-create week when the landing page has no day rows", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the current week then reloads and previews", async () => {
    // First auth load: empty week. After create.php, re-auth returns the populated week.
    resolveAuth.mockResolvedValueOnce({ jwt: "jwt1", landingHtml: empty });
    resolveAuth.mockResolvedValueOnce({ jwt: "jwt2", landingHtml: populated });

    const res = await buildSyncDayTool(config).handler({ date: "2026-06-15" });
    const p = JSON.parse(res.content[0].text);

    // create.php was POSTed with the Saturday period-end + assignment/timezone.
    const createCall = postForm.mock.calls.find((c) => String(c[0]).includes("create.php"));
    expect(createCall).toBeTruthy();
    expect(createCall![1]).toMatchObject({ assignmentId: "6599", periodEndDate: "26-06-20", timezoneOffset: "420", subaction: "Blank" });

    // Re-authenticated to reload the freshly created week.
    expect(resolveAuth).toHaveBeenCalledTimes(2);

    // And the sync proceeded normally on the reloaded week.
    expect(p.error).toBeUndefined();
    expect(p.mode).toBe("preview");
    expect(p.days[0].willAdd[0]).toEqual({ note: "Datamax :: Web :: dns", hours: 1, minutes: 0 });
  });

  it("errors clearly if the week still won't load after creation", async () => {
    resolveAuth.mockResolvedValueOnce({ jwt: "jwt1", landingHtml: empty });
    resolveAuth.mockResolvedValueOnce({ jwt: "jwt2", landingHtml: empty });

    const res = await buildSyncDayTool(config).handler({ date: "2026-06-15" });
    const p = JSON.parse(res.content[0].text);
    expect(p.error).toMatch(/created the bullhorn week/i);
    expect(updateDay).not.toHaveBeenCalled();
  });
});
