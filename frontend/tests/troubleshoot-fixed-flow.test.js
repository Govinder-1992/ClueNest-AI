// Tests for the "Problem Fixed" path: saving the troubleshooting result (api.js), the context carried to the Maintenance
// Reminder form (navigation.js) and the maintenance recommendations (maintenance.js). Nothing here uses the network.
// Run from the project root:   node --test "frontend/tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const js = f => path.join(__dirname, "..", "js", f);

const store = {};
globalThis.sessionStorage = {
  getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; }
};
globalThis.location = { hash: "" };
globalThis.window = { CLUENEST_CONFIG: { apiBaseUrl: "https://api.example.test/dev" } };
globalThis.Auth = { getToken: () => "access-token", isConfigured: () => true, endSession: () => {}, getNotice: () => "" };
globalThis.WarrantyChecker = require(js("warranty.js"));
globalThis.RepairVsReplace = require(js("repair-replace.js"));
const { Api } = require(js("api.js"));
const Navigation = require(js("navigation.js"));
const MaintenanceScreen = require(js("maintenance.js"));

const RESULT_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
let calls;
function mockFetch(status, body) {
  calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

test("saveTroubleshootingResult posts the save-result action to /troubleshoot and returns the record", async () => {
  mockFetch(201, { result: { id: RESULT_ID, outcome: "resolved" }, duplicate: false });
  const rec = await Api.saveTroubleshootingResult({ resultId: RESULT_ID, applianceId: "a1", category: "Not Draining", description: "Stays in the drum" });
  assert.equal(rec.id, RESULT_ID);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example.test/dev/troubleshoot");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, { resultId: RESULT_ID, applianceId: "a1", category: "Not Draining", description: "Stays in the drum",
    action: "save-result", outcome: "resolved" });
});

test("a retry with the same resultId is accepted (the server returns the saved record)", async () => {
  mockFetch(200, { result: { id: RESULT_ID, outcome: "resolved" }, duplicate: true });
  const rec = await Api.saveTroubleshootingResult({ resultId: RESULT_ID, applianceId: "a1", category: "Not Draining" });
  assert.equal(rec.id, RESULT_ID);
});

test("an answer that is not a saved record is treated as a failure", async () => {
  // This is what a server without "save-result" would send: a normal troubleshooting answer.
  mockFetch(200, { mode: "mock", possibleCauses: ["x"], recommendedSolutions: ["y"] });
  await assert.rejects(() => Api.saveTroubleshootingResult({ resultId: RESULT_ID, applianceId: "a1", category: "Other" }),
    e => e.code === "http" && /could not be saved/.test(e.message));
});

test("server errors are reported with the server message", async () => {
  mockFetch(404, { message: "The selected appliance was not found.", code: "APPLIANCE_NOT_FOUND" });
  await assert.rejects(() => Api.saveTroubleshootingResult({ resultId: RESULT_ID, applianceId: "a1", category: "Other" }),
    e => /404/.test(e.message) && /appliance was not found/.test(e.message));
});

test("the troubleshooting-fixed context belongs to one appliance and can be cleared", () => {
  Navigation.setTroubleshootFixedContext({ applianceId: "a1", resultId: RESULT_ID, category: "Not Draining" });
  assert.equal(Navigation.getTroubleshootFixedContext("a1").resultId, RESULT_ID);
  assert.equal(Navigation.getTroubleshootFixedContext("a2"), null);
  Navigation.clearTroubleshootFixedContext();
  assert.equal(Navigation.getTroubleshootFixedContext("a1"), null);
});

test("Problem Fixed does not touch the warranty, repair or technician context", () => {
  Navigation.setWarrantyContext({ applianceId: "a1", status: "Expired", decision: "Not Covered" });
  Navigation.setTroubleshootFixedContext({ applianceId: "a1", resultId: RESULT_ID, category: "Other" });
  Navigation.clearTroubleshootFixedContext();
  assert.equal(Navigation.getWarrantyContext("a1").decision, "Not Covered");
});

test("recommendations: the fixed problem comes first, then routine tasks for the appliance type", () => {
  const recs = MaintenanceScreen.recommend("Washing Machine", "Not Draining");
  assert.equal(recs[0].name, "Check the drain hose and filter");
  assert.ok(recs.some(r => /drain pump filter/i.test(r.name)));
  assert.ok(recs.length >= 3 && recs.length <= 5);
});

test("recommendations: every appliance type and category gives valid, safe, unique suggestions", () => {
  const types = ["Refrigerator", "Washing Machine", "Dryer", "Dishwasher", "Oven", "Microwave", "Air Conditioner", "Other", "", undefined];
  const cats = ["Not Turning On", "Making Unusual Noise", "Not Cooling or Heating", "Leaking Water", "Not Draining", "Not Working Properly", "Error Code", "Other"];
  const repeats = MaintenanceScreen.REPEATS.map(r => r.value);
  for (const t of types) for (const c of cats) {
    const recs = MaintenanceScreen.recommend(t, c);
    assert.ok(recs.length >= 2 && recs.length <= 5, `${t}/${c}`);
    assert.equal(new Set(recs.map(r => r.name.toLowerCase())).size, recs.length, `${t}/${c} duplicates`);
    for (const r of recs) {
      assert.ok(r.name && r.name.length <= 100, r.name);
      assert.ok(r.description.length <= 500, r.name);
      assert.ok(repeats.includes(r.repeat) && r.repeat !== "once", r.name);
      assert.ok(r.months > 0, r.name);
      // Only routine homeowner tasks: nothing about opening panels, wiring, gas or live parts.
      assert.doesNotMatch(r.name + " " + r.description, /\b(open|remove)\b[^.]*\b(panel|cover)\b|\bwiring\b|\bgas (line|valve)\b|\blive\b|\bbypass/i, r.name);
    }
  }
});

test("recommendations: an unknown type falls back to general tasks and the type match ignores case", () => {
  assert.equal(MaintenanceScreen.recommend("Toaster", "Other")[0].name, "Clean accessible filters and vents");
  assert.equal(MaintenanceScreen.recommend("DISHWASHER", "Other")[0].name, "Clean the dishwasher filter");
});

test("recommended tasks pass the same validation as a typed reminder", () => {
  const today = "2025-06-15";
  for (const r of MaintenanceScreen.recommend("Refrigerator", "Not Cooling or Heating")) {
    const { errors } = MaintenanceScreen.validate({ applianceId: "a1", taskName: r.name, description: r.description,
      dueDate: MaintenanceScreen.addMonthsToDate(today, r.months), repeat: r.repeat, notes: "" }, today);
    assert.deepEqual(errors, {}, r.name);
  }
});

test("addMonthsToDate keeps the day inside short months and crosses the year", () => {
  assert.equal(MaintenanceScreen.addMonthsToDate("2025-01-31", 1), "2025-02-28");
  assert.equal(MaintenanceScreen.addMonthsToDate("2024-01-31", 1), "2024-02-29");
  assert.equal(MaintenanceScreen.addMonthsToDate("2025-11-15", 3), "2026-02-15");
  assert.equal(MaintenanceScreen.addMonthsToDate("2025-06-15", 12), "2026-06-15");
});
