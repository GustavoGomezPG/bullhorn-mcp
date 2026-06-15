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
