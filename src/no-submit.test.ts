import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Hard safety rule carried over from the old Playwright sync (tatui-sync):
 * this tool fills time blocks and NEVER submits, approves, signs, or finalizes
 * a timesheet — the user does that manually after reviewing. The old project
 * enforced it by banning such selectors from selectors.ts; the MCP equivalent
 * is banning the corresponding BBO endpoints (submit.php, unSubmit.php, …) and
 * any "subaction: Submit/Approve" from shipped source.
 *
 * BBO's real submit/approve endpoints (seen in timesheet.js) are:
 *   /php/timesheet/submit.php, /php/timesheet/unSubmit.php
 * If a future change adds one, this test fails on purpose.
 */
const SRC = join(process.cwd(), "src");

// Quoted PHP endpoint whose filename mentions a finalizing action, or a
// "subaction" set to Submit/Approve/Sign/Finalize. Avoids false positives on
// words like "assignment"/"design" by requiring a .php endpoint or subaction.
const FORBIDDEN = [
  /["'`][^"'`]*\b(?:un)?submit[^"'`]*\.php["'`]/i,
  /["'`][^"'`]*\b(?:approve|finalize|sign)[^"'`]*\.php["'`]/i,
  /\bsubaction\b\s*[:=]\s*["'`]\s*(?:submit|approve|finalize|sign)/i,
];

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return tsFiles(p);
    return e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
  });
}

describe("safety: the tool never submits/approves/finalizes a timesheet", () => {
  it("no shipped source references a submit/approve/sign/finalize endpoint", () => {
    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const file of tsFiles(SRC)) {
      readFileSync(file, "utf8").split("\n").forEach((text, i) => {
        if (FORBIDDEN.some((re) => re.test(text))) {
          offenders.push({ file: file.replace(process.cwd() + "/", ""), line: i + 1, text: text.trim() });
        }
      });
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});
