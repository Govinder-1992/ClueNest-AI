// Tests for frontend/js/config.js: the sign-in return address follows where the site is served from.
// Run from the project root:   node --test "frontend/tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const CONFIG_PATH = path.join(__dirname, "..", "js", "config.js");
const fs = require("node:fs");

function load(origin) {
  globalThis.window = { location: { origin } };
  delete require.cache[CONFIG_PATH];
  require(CONFIG_PATH);
  const cfg = globalThis.window.CLUENEST_CONFIG;
  delete globalThis.window;
  return cfg;
}

test("local development keeps the registered localhost address", () => {
  for (const origin of ["http://localhost:5500", "http://localhost:3000", "http://127.0.0.1:5500", "null", "", "file://"]) {
    const c = load(origin);
    assert.equal(c.cognito.redirectUri, "http://localhost:5500/", origin);
    assert.equal(c.cognito.logoutUri, "http://localhost:5500/", origin);
  }
});

test("the hosted https site uses its own address, with a trailing slash and no path", () => {
  const c = load("https://d1234abcd.cloudfront.net");
  assert.equal(c.cognito.redirectUri, "https://d1234abcd.cloudfront.net/");
  assert.equal(c.cognito.logoutUri, "https://d1234abcd.cloudfront.net/");
});

test("plain http on another host never becomes the return address", () => {
  assert.equal(load("http://example.com").cognito.redirectUri, "http://localhost:5500/");
});

test("the rest of the configuration is the same in both places", () => {
  const a = load("http://localhost:5500"), b = load("https://d1234abcd.cloudfront.net");
  for (const c of [a, b]) {
    assert.equal(c.apiBaseUrl, "https://ttgu8aq0bh.execute-api.us-east-1.amazonaws.com/dev");
    assert.equal(c.technicianSearchPath, "/technicians/search");
    assert.equal(c.cognito.clientId, "2o0tmubl9bksl35dpkobg3tcu1");
    assert.equal(c.cognito.hostedUiDomain, "cluenest-ai-dev.auth.us-east-1.amazoncognito.com");
    assert.equal(c.cognito.region, "us-east-1");
  }
});

test("the file contains no secrets", () => {
  const text = fs.readFileSync(CONFIG_PATH, "utf8");
  for (const bad of [/AIza[0-9A-Za-z_-]{20,}/, /client_?secret\s*[:=]\s*["'][^"']/i, /AKIA[0-9A-Z]{16}/, /eyJ[A-Za-z0-9_-]{10,}\./]) {
    assert.ok(!bad.test(text), String(bad));
  }
});
