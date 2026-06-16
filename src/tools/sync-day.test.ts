import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// getData.php is the source of truth for the week's day rows (the landing page no
// longer renders them). The mocked BBO client returns this week XML for every postForm.
const getDataXml = readFileSync(join(process.cwd(), "tests/fixtures/getdata-week.xml"), "utf8");

vi.mock("../bullhorn/auth.js", () => ({ resolveAuth: vi.fn(async () => ({ jwt: "jwt", landingHtml: null })) }));
vi.mock("../blitzit/auth.js", () => ({ getBlitzitAuth: vi.fn(async () => ({ idToken: "t", uid: "u" })) }));
vi.mock("../blitzit/client.js", () => ({ createBlitzitClient: vi.fn(() => ({ queryTasksByOwner: vi.fn() })) }));
vi.mock("../bullhorn/client.js", () => ({ createBullhornClient: vi.fn(() => ({ postForm: vi.fn(async () => getDataXml) })) }));

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

describe("bullhorn_sync_blitzit_day", () => {
  beforeEach(() => vi.clearAllMocks());

  it("previews the day's new blocks and writes nothing", async () => {
    const res = await buildSyncDayTool(config).handler({ date: "2026-06-15" });
    const p = JSON.parse(res.content[0].text);
    expect(p.mode).toBe("preview");
    expect(p.days[0].willAdd[0]).toEqual({ note: "Datamax :: Web :: dns", hours: 1, minutes: 0 });
    expect(updateDay).not.toHaveBeenCalled();
  });

  it("writes merged blocks when confirm:true", async () => {
    const res = await buildSyncDayTool(config).handler({ date: "2026-06-15", confirm: true });
    const p = JSON.parse(res.content[0].text);
    expect(p.mode).toBe("logged");
    expect(p.days[0].added).toBe(1);
    expect(updateDay).toHaveBeenCalledTimes(1);
    const args = updateDay.mock.calls[0];
    expect(args[1]).toBe("956339"); // detailId
    expect(args[2]).toBe("999");    // maxCheckinId
    expect(args[3]).toHaveLength(1);
    expect(args[3][0].note).toBe("Datamax :: Web :: dns");
  });

  it("rejects a date outside the current week", async () => {
    const res = await buildSyncDayTool(config).handler({ date: "2026-05-01" });
    const p = JSON.parse(res.content[0].text);
    expect(p.error).toMatch(/outside the current Bullhorn week|not supported/i);
    expect(updateDay).not.toHaveBeenCalled();
  });
});
