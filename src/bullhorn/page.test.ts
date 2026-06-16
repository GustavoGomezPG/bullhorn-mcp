import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWeekXml } from "./page.js";

const getDataXml = readFileSync(join(process.cwd(), "tests/fixtures/getdata-week.xml"), "utf8");
const getDataEmpty = readFileSync(join(process.cwd(), "tests/fixtures/getdata-empty.xml"), "utf8");

describe("parseWeekXml", () => {
  it("extracts the 7 day rows, status and timesheetId from getData.php XML", () => {
    const w = parseWeekXml(getDataXml);
    expect(w.status).toBe("In Progress");
    expect(w.timesheetId).toBe("128713");
    expect(w.days).toHaveLength(7);
    expect(w.days[0]).toEqual({ date: "2026-06-14", timesheetdetailId: "956338" });
    expect(w.days[6]).toEqual({ date: "2026-06-20", timesheetdetailId: "956344" });
  });
  it("returns zero days for an uncreated (empty) week", () => {
    expect(parseWeekXml(getDataEmpty).days).toEqual([]);
  });
});
