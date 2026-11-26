// Tests for the Troubleshooting screen's handling of the demo (mock) answer and of the real (Bedrock) answer.
// Run from the project root:   node --test "frontend/tests/*.test.js"
// Nothing here uses the network. The answers below are copies of what the backend sends.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Troubleshoot = require(path.join(__dirname, "..", "js", "troubleshoot.js"));

const LABEL = "Demo Mode \u2014 Not AI-generated";
const DISCLAIMER = "These are possible causes, not a confirmed diagnosis. If you are unsure or the problem continues, contact a qualified technician.";
const demoAnswer = (over = {}) => Object.assign({
  mode: "mock", mock: true, demoLabel: LABEL, demoNotice: "This is a ready-made example. It was not written by an AI model.", demoScope: "specific",
  hazardDetected: false, safetyResponse: "", summary: "Your washing machine is not draining the water at the end of the cycle.",
  safetyWarnings: ["Never open the appliance, touch wiring or electrical parts, bypass a safety switch or work on gas connections yourself.",
    "Contact a professional if: the water still does not drain after these checks.", DISCLAIMER],
  possibleCauses: ["The drain hose is kinked, crushed or blocked", "The drain pump filter is clogged"],
  recommendedSolutions: ["Stop the cycle, unplug the washer and turn off the water taps.", "Check the drain hose for kinks.", "Clean the drain pump filter.", "Run a drain cycle."],
  callProfessionalIf: ["The water still does not drain"], repairVsReplace: "Problems like this are often a small fix, so repair is usually worth trying first.",
  disclaimer: DISCLAIMER }, over);
const bedrockAnswer = () => ({ mode: "bedrock", hazardDetected: false, safetyResponse: "", safetyWarnings: [DISCLAIMER],
  possibleCauses: ["The drain hose may be kinked"], recommendedSolutions: ["Check the drain hose."], callProfessionalIf: ["It still does not drain"], disclaimer: DISCLAIMER });
const hazardAnswer = () => ({ mode: "safety-rules", hazardDetected: true, safetyResponse: "Possible gas leak. Stop using the appliance and leave the area now.",
  safetyWarnings: ["Possible gas leak. Stop using the appliance and leave the area now.", DISCLAIMER], possibleCauses: [],
  recommendedSolutions: ["Leave the building.", "Call your gas utility or 911 from outside."], disclaimer: DISCLAIMER });

test("the demo answer is recognised as a demo, never as a Bedrock answer", () => {
  const r = Troubleshoot.parseResult(demoAnswer());
  assert.equal(r.mock, true);
  assert.equal(r.bedrockConfirmed, false);
  assert.equal(r.hazard, false);
  assert.equal(r.empty, false);
  assert.equal(r.causes.length, 2);
  assert.equal(r.steps.length, 4);
  assert.equal(r.summary, "Your washing machine is not draining the water at the end of the cycle.");
  assert.match(r.repairVsReplace, /repair is usually worth trying first/);
});

test("a demo answer wrapped in an API Gateway style body is read the same way", () => {
  const r = Troubleshoot.parseResult({ statusCode: 200, body: JSON.stringify(demoAnswer()) });
  assert.equal(r.mock, true);
  assert.equal(r.steps.length, 4);
});

test("the demo answer shows the exact label, every section and the numbered steps", () => {
  const html = Troubleshoot.resultHtml(Troubleshoot.parseResult(demoAnswer()));
  assert.ok(html.includes("Demo Mode \u2014 Not AI-generated"));
  assert.match(html, /not written by an AI model/);
  assert.match(html, /result-summary/);
  assert.match(html, /Safety Warnings/);
  assert.match(html, /Possible Causes/);
  assert.match(html, /<ol class="result-list">(<li>.*<\/li>){4}<\/ol>/);                   // numbered steps
  assert.match(html, /Recommended Solutions/);
  assert.match(html, /Repair or Replace\?/);
  assert.match(html, /Contact a professional if:/);
  assert.match(html, /Did this solve the problem\?/);
  assert.ok(!/Bedrock/i.test(html), "the page must not mention Bedrock for a demo answer");
  assert.ok(!/did not confirm which AI model/.test(html));
  assert.ok(html.indexOf("Demo Mode") < html.indexOf("Possible Causes"), "the label comes first");
});

test("a real (Bedrock) answer has no demo label and no repair section", () => {
  const r = Troubleshoot.parseResult(bedrockAnswer());
  assert.equal(r.mock, false);
  assert.equal(r.bedrockConfirmed, true);
  assert.equal(r.summary, "");
  assert.equal(r.repairVsReplace, "");
  const html = Troubleshoot.resultHtml(r);
  assert.ok(!html.includes("Demo Mode"));
  assert.ok(!/Repair or Replace\?/.test(html));
  assert.ok(!/result-summary/.test(html));
  assert.match(html, /Possible Causes/);
  assert.match(html, /Recommended Solutions/);
});

test("a dangerous-problem answer from the safety rules is not labelled as a demo", () => {
  const r = Troubleshoot.parseResult(hazardAnswer());
  assert.equal(r.hazard, true);
  assert.equal(r.mock, false);
  const html = Troubleshoot.resultHtml(r);
  assert.ok(!html.includes("Demo Mode"));
  assert.match(html, /Safety Response/);
  assert.match(html, /Do not attempt a DIY repair/);
  assert.match(html, /Stop using the appliance/);
});

test("text from the answer is escaped before it is shown", () => {
  const html = Troubleshoot.resultHtml(Troubleshoot.parseResult(demoAnswer({
    summary: "<img src=x onerror=alert(1)>", repairVsReplace: "<script>alert(1)</script>",
    possibleCauses: ["<b>bold</b>"], recommendedSolutions: ["a & b"], safetyWarnings: ["\"quoted\" <i>x</i>"] })));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("<b>bold</b>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("a &amp; b"));
});

test("the existing answer fields still work with the older response shape", () => {
  const r = Troubleshoot.parseResult({ mode: "bedrock", possibleCauses: ["x"], recommendedSolutions: ["y"], safetyWarnings: ["z"] });
  assert.deepEqual([r.causes, r.steps, r.warnings, r.summary, r.repairVsReplace], [["x"], ["y"], ["z"], "", ""]);
  const empty = Troubleshoot.parseResult({});
  assert.equal(empty.empty, true);
  assert.match(Troubleshoot.resultHtml(empty), /returned no guidance/);
});

test("the label constant is exactly the required text", () => {
  assert.equal(Troubleshoot.DEMO_LABEL, "Demo Mode \u2014 Not AI-generated");
});

test("the request the screen sends is unchanged", () => {
  const appliance = { id: "11111111-aaaa-4aaa-8aaa-111111111111" };
  assert.deepEqual(Troubleshoot.buildPayload({ category: "Not Draining", description: " Water stays ", errorCode: "" }, appliance),
    { applianceId: appliance.id, category: "Not Draining", description: "Water stays" });
  assert.deepEqual(Troubleshoot.buildPayload({ category: "Error Code", description: "", errorCode: " E24 " }, appliance),
    { applianceId: appliance.id, category: "Error Code", description: "", errorCode: "E24" });
});
