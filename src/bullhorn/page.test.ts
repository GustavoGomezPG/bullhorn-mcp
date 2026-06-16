import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWeekHtml, parseWeekXml } from "./page.js";

const html = readFileSync(join(process.cwd(), "tests/fixtures/employee-week.html"), "utf8");
const getDataXml = readFileSync(join(process.cwd(), "tests/fixtures/getdata-week.xml"), "utf8");
const getDataEmpty = readFileSync(join(process.cwd(), "tests/fixtures/getdata-empty.xml"), "utf8");

describe("parseWeekHtml", () => {
  it("extracts the 7 day rows with date -> detailId", () => {
    const w = parseWeekHtml(html);
    expect(w.days).toHaveLength(7);
    expect(w.days[0]).toEqual({ date: "2026-06-14", timesheetdetailId: "956338" });
    expect(w.days[6]).toEqual({ date: "2026-06-20", timesheetdetailId: "956344" });
    expect(w.days.map((d) => d.timesheetdetailId)).toEqual(["956338","956339","956340","956341","956342","956343","956344"]);
  });
  it("extracts the week status", () => {
    expect(parseWeekHtml(html).status).toBe("In Progress");
  });
  it("returns empty days for a shell page with no table", () => {
    expect(parseWeekHtml("<html><body>no table here</body></html>").days).toEqual([]);
  });
});

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
