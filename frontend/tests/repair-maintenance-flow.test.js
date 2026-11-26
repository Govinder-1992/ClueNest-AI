// Tests for the repair-to-maintenance workflow: the API wrappers in api.js, the request bodies built by the
// Repair History and Maintenance forms, and the Navigation helpers. Nothing here uses the network.
// Run from the project root:   node --test "frontend/tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const js = f => path.join(__dirname, "..", "js", f);

// ---- globals the browser scripts expect ----
const store = {};
globalThis.sessionStorage = {
  getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; }
};
globalThis.location = { hash: "" };
globalThis.window = { CLUENEST_CONFIG: { apiBaseUrl: "https://api.example.test/dev" } };
let endedSession = 0;
globalThis.Auth = { getToken: () => "access-token", isConfigured: () => true, endSession: () => { endedSession++; }, getNotice: () => "" };
globalThis.WarrantyChecker = require(js("warranty.js"));
globalThis.RepairVsReplace = require(js("repair-replace.js"));
const { Api, ApiError } = require(js("api.js"));
const Navigation = require(js("navigation.js"));
const RepairHistory = require(js("repair-history.js"));
const MaintenanceScreen = require(js("maintenance.js"));

// Records every fetch and answers with the next queued response.
let calls, queue;
function mockFetch(...responses) {
  calls = []; queue = responses.slice();
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, method: opts.method, headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : undefined });
    const r = queue.length > 1 ? queue.shift() : queue[0];
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
}
const ok = (status, body) => ({ status, body });

test("Api.createRepairRecord posts to /repair-history with the access token and returns the record", async () => {
  mockFetch(ok(201, { record: { id: "r1", status: "completed" } }));
  const rec = await Api.createRepairRecord({ applianceId: "a1", status: "completed" });
  assert.equal(rec.id, "r1");
  assert.equal(calls[0].url, "https://api.example.test/dev/repair-history");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.Authorization, "Bearer access-token");
  assert.deepEqual(calls[0].body, { applianceId: "a1", status: "completed" });
});

test("repair-history wrappers use the right method and path", async () => {
  mockFetch(ok(200, { records: [{ id: "r1" }, { id: "r2" }] }));
  assert.equal((await Api.getRepairRecords()).length, 2);
  assert.equal(calls[0].method, "GET"); assert.ok(calls[0].url.endsWith("/repair-history"));
  mockFetch(ok(200, { record: { id: "r 1" } }));
  await Api.updateRepairRecord("r 1", { problem: "x" });
  assert.equal(calls[0].method, "PUT"); assert.ok(calls[0].url.endsWith("/repair-history/r%201"));
  mockFetch(ok(200, { deleted: true, id: "r1" }));
  await Api.deleteRepairRecord("r1");
  assert.equal(calls[0].method, "DELETE"); assert.ok(calls[0].url.endsWith("/repair-history/r1"));
});

test("maintenance wrappers use the right method and path", async () => {
  mockFetch(ok(200, { reminders: [{ id: "m1" }] }));
  assert.equal((await Api.getMaintenanceReminders())[0].id, "m1");
  assert.ok(calls[0].url.endsWith("/maintenance"));
  mockFetch(ok(201, { reminder: { id: "m2", repeat: "yearly" } }));
  const r = await Api.createMaintenanceReminder({ applianceId: "a1", taskName: "Clean filter", dueDate: "2030-01-01", repeat: "yearly" });
  assert.equal(r.id, "m2"); assert.equal(calls[0].method, "POST"); assert.ok(calls[0].url.endsWith("/maintenance"));
  mockFetch(ok(200, { reminder: { id: "m2" } }));
  await Api.updateMaintenanceReminder("m2", { taskName: "x" });
  assert.equal(calls[0].method, "PUT"); assert.ok(calls[0].url.endsWith("/maintenance/m2"));
  mockFetch(ok(200, { deleted: true }));
  await Api.deleteMaintenanceReminder("m2");
  assert.equal(calls[0].method, "DELETE");
  mockFetch(ok(200, { completed: { id: "m2" }, next: { id: "m3", dueDate: "2031-01-01" } }));
  const c = await Api.completeMaintenanceReminder("m2", "2030-01-02");
  assert.equal(c.next.id, "m3");
  assert.equal(calls[0].method, "POST"); assert.ok(calls[0].url.endsWith("/maintenance/m2/complete"));
  assert.deepEqual(calls[0].body, { completedDate: "2030-01-02" });
  mockFetch(ok(200, { completed: { id: "m2" }, next: null }));
  assert.equal((await Api.completeMaintenanceReminder("m2", "2030-01-02")).next, null);
});

test("an empty or missing list in the response becomes an empty array", async () => {
  mockFetch(ok(200, {}));
  assert.deepEqual(await Api.getRepairRecords(), []);
  assert.deepEqual(await Api.getMaintenanceReminders(), []);
});

test("a validation error shows the server message and the field messages", async () => {
  mockFetch(ok(400, { message: "Some fields are invalid.", fields: { repairDate: "The repair date cannot be in the future." } }));
  await assert.rejects(() => Api.createRepairRecord({}), e => e instanceof ApiError && e.code === "http" &&
    /Some fields are invalid\./.test(e.message) && /cannot be in the future/.test(e.message) && /400/.test(e.message));
});

test("a network failure becomes a readable ApiError", async () => {
  globalThis.fetch = async () => { throw new Error("boom"); };
  await assert.rejects(() => Api.createMaintenanceReminder({}), e => e.code === "network" && /Could not reach the server/.test(e.message));
});

test("a record ID is required for item routes", async () => {
  await assert.rejects(() => Api.deleteRepairRecord(""), e => e.code === "invalid");
  await assert.rejects(() => Api.completeMaintenanceReminder(null, "2030-01-01"), e => e.code === "invalid");
});

test("RepairHistory.buildPayload sends only the fields the API accepts", () => {
  const { errors, values } = RepairHistory.validate({ applianceId: "a1", problem: "Not draining", repairDate: "2024-05-01", status: "completed",
    company: "FixIt Ltd", cost: "125.50", additional: "", notes: "Replaced the pump" }, "2024-06-01");
  assert.deepEqual(errors, {});
  assert.deepEqual(RepairHistory.buildPayload(values), { applianceId: "a1", problem: "Not draining", repairDate: "2024-05-01",
    status: "completed", company: "FixIt Ltd", costCents: 12550, additionalCents: null, notes: "Replaced the pump" });
});

test("RepairHistory.validate still requires the appliance, problem, date and status", () => {
  const { errors } = RepairHistory.validate({}, "2024-06-01");
  assert.deepEqual(Object.keys(errors).sort(), ["applianceId", "problem", "repairDate", "status"]);
  assert.ok(RepairHistory.validate({ applianceId: "a", problem: "p", repairDate: "2024-07-01", status: "completed" }, "2024-06-01").errors.repairDate);
});

test("MaintenanceScreen.buildPayload sends only the fields the API accepts", () => {
  const { errors, values } = MaintenanceScreen.validate({ applianceId: "a1", taskName: " Clean filter ", description: "", dueDate: "2030-03-31",
    repeat: "semiannual", notes: "n" }, "2030-01-01");
  assert.deepEqual(errors, {});
  assert.deepEqual(MaintenanceScreen.buildPayload(values), { applianceId: "a1", taskName: "Clean filter", description: "",
    dueDate: "2030-03-31", repeat: "semiannual", notes: "n" });
});

test("the five repeat options are unchanged", () => {
  assert.deepEqual(MaintenanceScreen.REPEATS.map(r => [r.value, r.label]), [["once", "One Time"], ["monthly", "Monthly"],
    ["quarterly", "Every 3 Months"], ["semiannual", "Every 6 Months"], ["yearly", "Yearly"]]);
});

test("Navigation.go keeps the old form and adds optional query parameters", () => {
  Navigation.go("maintenance-reminder", "a b");
  assert.equal(location.hash, "#/maintenance-reminder?id=a%20b");
  Navigation.go("repair-history", "a1", { mode: "add", from: "technician" });
  assert.equal(location.hash, "#/repair-history?id=a1&mode=add&from=technician");
  Navigation.go("maintenance");
  assert.equal(location.hash, "#/maintenance");
});

test("the completed-repair context belongs to one appliance and can be cleared", () => {
  Navigation.setRepairCompletedContext({ applianceId: "a1", repairDate: "2024-05-01", company: "FixIt" });
  assert.equal(Navigation.getRepairCompletedContext("a1").company, "FixIt");
  assert.equal(Navigation.getRepairCompletedContext("a2"), null);
  Navigation.clearRepairCompletedContext();
  assert.equal(Navigation.getRepairCompletedContext("a1"), null);
});
