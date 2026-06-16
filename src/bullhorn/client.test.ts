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
    mockFetchOnce("<timesheet><errorStatus>okay</errorStatus><authenticationKey>key2</authenticationKey></timesheet>", 209);
    const client = createBullhornClient(session, "provisionsgroup");
    const xml = await client.postForm("/php/timesheet/getTimesheetDay.php", { timesheetdetailId: "1" });
    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[0]).toBe("https://provisionsgroup.bbo.bullhornstaffing.com/php/timesheet/getTimesheetDay.php");
    expect(String(call[1].body)).toContain("authenticationKey=key1");
    expect(String(call[1].body)).toContain("timesheetdetailId=1");
    expect(session.authKey).toBe("key2"); // rotated
    expect(xml).toContain("okay");
  });
  it("accepts HTTP 209 as a normal (non-error) response", async () => {
    mockFetchOnce("<timesheet><errorStatus>okay</errorStatus></timesheet>", 209);
    const client = createBullhornClient({ authKey: "k" }, "v");
    await expect(client.postForm("/x", {})).resolves.toContain("okay");
  });
  it("throws AUTH_EXPIRED on HTTP 401", async () => {
    mockFetchOnce("nope", 401);
    const client = createBullhornClient({ authKey: "k" }, "v");
    await expect(client.postForm("/php/timesheet/getTimesheetDay.php", {})).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
  });
  it("throws HTTP_ERROR on a non-2xx, non-401/403 status", async () => {
    mockFetchOnce("oops", 500);
    const client = createBullhornClient({ authKey: "k" }, "v");
    await expect(client.postForm("/x", {})).rejects.toMatchObject({ code: "HTTP_ERROR" });
  });
  it("throws BULLHORN_ERROR with the errorMessage when errorStatus is not okay", async () => {
    mockFetchOnce("<root><errorStatus>error</errorStatus><errorMessage>already been created</errorMessage></root>", 209);
    const client = createBullhornClient({ authKey: "k" }, "v");
    await expect(client.postForm("/php/timesheet/create.php", {})).rejects.toMatchObject({ code: "BULLHORN_ERROR", message: expect.stringContaining("already been created") });
  });
});
