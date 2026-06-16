import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDay, updateDay, buildBlockFields, loadCurrentWeek, createWeek, assertEditable, isEditableStatus, StatusGuardError } from "./timesheet.js";
import { BullhornError } from "./client.js";
import type { BullhornClient } from "./client.js";

function makeClient(responses: Array<string | Error>) {
  const calls: Array<{ path: string; fields: Record<string, string> }> = [];
  let i = 0;
  const c: BullhornClient = {
    postForm: async (path, fields) => {
      calls.push({ path, fields });
      const r = responses[i++];
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { c, calls };
}

const DAY_XML = `<timesheet><maxCheckinId>999</maxCheckinId><timesheetdetailsid>956339</timesheetdetailsid><timesheetdates>2026-06-15</timesheetdates><hoursworked>2:00</hoursworked><blocks><block><timesheetBlockId>357263</timesheetBlockId><hours>2</hours><minutes>0</minutes><note>old</note><type>0</type><editable>yes</editable></block></blocks><errorStatus>okay</errorStatus></timesheet>`;

describe("loadCurrentWeek", () => {
  it("parses the landing-page week", () => {
    const html = readFileSync(join(process.cwd(), "tests/fixtures/employee-week.html"), "utf8");
    const w = loadCurrentWeek(html);
    expect(w.days).toHaveLength(7);
    expect(w.status).toBe("In Progress");
  });
});

describe("getDay", () => {
  it("parses a day via the client", async () => {
    const { c, calls } = makeClient([DAY_XML]);
    const d = await getDay(c, "956339");
    expect(calls[0]).toEqual({ path: "/php/timesheet/getTimesheetDay.php", fields: { timesheetdetailId: "956339" } });
    expect(d.maxCheckinId).toBe("999");
    expect(d.blocks[0].note).toBe("old");
  });
});

describe("buildBlockFields", () => {
  it("encodes 1-based fields, empty id for new blocks", () => {
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
    const { c, calls } = makeClient([DAY_XML]);
    await updateDay(c, "956339", "999", [{ hours: 1, minutes: 0, note: "x", type: 0, editable: true }]);
    expect(calls[0].path).toBe("/php/timesheet/updateDay.php");
    expect(calls[0].fields.timesheetdetailId).toBe("956339");
    expect(calls[0].fields.maxCheckinId).toBe("999");
    expect(calls[0].fields["block[1][timesheetBlockHours]"]).toBe("1");
  });
});

describe("status guard", () => {
  it("accepts editable statuses", () => {
    expect(isEditableStatus("In Progress")).toBe(true);
    expect(isEditableStatus("Not Created")).toBe(true);
    expect(isEditableStatus("")).toBe(true);
    expect(() => assertEditable("In Progress")).not.toThrow();
  });
  it("rejects non-editable statuses", () => {
    expect(isEditableStatus("Approved")).toBe(false);
    expect(() => assertEditable("Approved")).toThrow(StatusGuardError);
    expect(() => assertEditable("Submitted")).toThrow(StatusGuardError);
  });
});

describe("createWeek", () => {
  it("returns true when newly created", async () => {
    const { c } = makeClient(["<root><errorStatus>okay</errorStatus></root>"]);
    expect(await createWeek(c, "6599", "26-06-20", "420")).toBe(true);
  });
  it("returns false when the week already exists", async () => {
    const { c } = makeClient([new BullhornError("BULLHORN_ERROR", "BBO error for /php/timesheet/create.php: The timesheet you are attempting to create has already been created")]);
    expect(await createWeek(c, "6599", "26-06-20", "420")).toBe(false);
  });
  it("rethrows other BBO errors", async () => {
    const { c } = makeClient([new BullhornError("BULLHORN_ERROR", "BBO error: something else")]);
    await expect(createWeek(c, "6599", "26-06-20", "420")).rejects.toThrow(/something else/);
  });
});
