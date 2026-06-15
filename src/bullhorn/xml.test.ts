import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tag, parseDay } from "./xml.js";

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
    expect(d.maxCheckinId).toBe("357271");
    expect(d.errorStatus).toBe("okay");
    expect(d.blocks).toHaveLength(1);
    expect(d.blocks[0]).toMatchObject({ timesheetBlockId: "357263", hours: 2, minutes: 0, note: "notes", type: 0, editable: true });
  });
  it("extracts the refreshed authenticationKey when present", () => {
    expect(parseDay("<timesheet><authenticationKey>abc</authenticationKey></timesheet>").authenticationKey).toBe("abc");
  });
});
