// Tests for frontend/js/auth.js and the token handling in frontend/js/api.js.
// Run from the project root:   node --test frontend/tests
// Needs Node 20 or newer. No network is used: fetch, storage, location and history are faked,
// and no real Cognito user, e-mail or token is involved. Tokens here are unsigned test strings.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const AUTH_PATH = path.join(__dirname, "..", "js", "auth.js");
const API_PATH = path.join(__dirname, "..", "js", "api.js");
const POOL = "us-east-1_TESTPOOL1";
const CLIENT = "testclientid1234567890abcd";
const HOST = "cluenest-ai-dev.auth.us-east-1.amazoncognito.com";
const ISS = "https://cognito-idp.us-east-1.amazonaws.com/" + POOL;
const REDIRECT = "http://localhost:5500/";
const SUB = "11111111-aaaa-4aaa-8aaa-111111111111";
const SCOPES = "openid email profile cluenest-api/read cluenest-api/write";
const START = 1_800_000_000_000;                       // fixed "now" in milliseconds

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o), "utf8").toString("base64url");
const jwt = (payload) => b64({ alg: "none" }) + "." + b64(payload) + "." + "sig";

class MemoryStorage {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
// Object.keys(sessionStorage) must list the stored keys, like a browser's Storage.
function storage() {
  const s = new MemoryStorage();
  return new Proxy(s, { ownKeys: () => [...s.m.keys()], getOwnPropertyDescriptor: (t, k) => (s.m.has(k) ? { enumerable: true, configurable: true, value: s.m.get(k) } : undefined) });
}

// A fresh browser: new module state, new storage, fixed clock, recorded console output.
function setup(opts = {}) {
  const env = { now: START, calls: [], assigned: [], replaced: [], logs: [], realNow: Date.now, realFetch: globalThis.fetch };
  env.session = storage();
  env.local = storage();
  env.search = opts.search || "";
  env.hash = opts.hash || "";
  env.window = {
    CLUENEST_CONFIG: opts.config || {
      apiBaseUrl: "https://api.example.test/dev", technicianSearchPath: "/technicians/search",
      cognito: { region: "us-east-1", userPoolId: POOL, clientId: CLIENT, hostedUiDomain: HOST, redirectUri: REDIRECT, logoutUri: REDIRECT }
    },
    sessionStorage: env.session, localStorage: env.local, crypto: globalThis.crypto,
    location: {
      get search() { return env.search; }, get hash() { return env.hash; }, pathname: "/",
      assign: (u) => env.assigned.push(u)
    },
    history: { replaceState: (_s, _t, url) => { env.replaced.push(url); const i = url.indexOf("#"); env.search = ""; env.hash = i >= 0 ? url.slice(i) : ""; } }
  };
  globalThis.window = env.window;
  Date.now = () => env.now;
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    env["real_" + level] = console[level];
    console[level] = (...a) => env.logs.push(a.map(String).join(" "));
  }
  delete require.cache[AUTH_PATH];
  delete require.cache[API_PATH];
  env.Auth = require(AUTH_PATH);
  globalThis.Auth = env.Auth;
  env.fetchCalls = [];
  env.setFetch = (fn) => { globalThis.fetch = async (url, init) => { env.fetchCalls.push({ url: String(url), init }); return fn(url, init); }; };
  env.done = () => {
    Date.now = env.realNow;
    globalThis.fetch = env.realFetch;
    for (const level of ["log", "info", "warn", "error", "debug"]) console[level] = env["real_" + level];
    delete globalThis.window; delete globalThis.Auth;
  };
  return env;
}
function tokens(env, over = {}) {
  const exp = Math.floor(env.now / 1000) + 3600;
  const access = jwt({ sub: SUB, token_use: "access", client_id: CLIENT, iss: ISS, exp, scope: over.scope === undefined ? SCOPES : over.scope });
  const id = jwt({ sub: SUB, token_use: "id", aud: CLIENT, iss: ISS, exp, nonce: env.nonce, given_name: "Zo\u00eb", email: "zoe@example.test", email_verified: true });
  const extra = Object.assign({}, over); delete extra.scope;
  return Object.assign({ access_token: access, id_token: id, refresh_token: "REFRESH-TOKEN-VALUE", token_type: "Bearer", expires_in: 3600 }, extra);
}
const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });
async function loginAndGetTx(env) {
  await env.Auth.login();
  const url = new URL(env.assigned.at(-1));
  const tx = JSON.parse(env.session.getItem("cluenest_oauth_tx"));
  env.nonce = tx.nonce;
  return { url, tx };
}
function returnFromCognito(env, tx, over = {}) {
  const q = new URLSearchParams(Object.assign({ code: "abcDEF123-._~xyz", state: tx.state }, over));
  for (const [k, v] of [...q]) if (v === "") q.delete(k);
  env.search = "?" + q.toString();
}
function assertSignedOut(env) {
  assert.equal(env.Auth.isAuthenticated(), false);
  assert.equal(env.Auth.getToken(), null);
  assert.equal(env.session.getItem("cluenest_session"), null);
  assert.equal(env.session.getItem("cluenest_oauth_tx"), null);      // a callback can only be used once
  assert.equal(env.search, "");                                       // ?code=... removed from the address
}
function assertNoSecretsLogged(env, ...values) {
  const text = env.logs.join("\n");
  for (const v of values) assert.ok(!text.includes(v), "a token was logged");
}

// ------------------------------------------------------------------ configuration and login redirect
test("not configured until the API URL, client, domain and redirect are all set", () => {
  const env = setup({ config: { apiBaseUrl: "", cognito: { clientId: "", hostedUiDomain: "", redirectUri: "" } } });
  try {
    assert.equal(env.Auth.isConfigured(), false);
    assert.equal(env.Auth.isAuthenticated(), false);
    assert.equal(env.Auth.signOut(), "");
  } finally { env.done(); }
  const env2 = setup();
  try { assert.equal(env2.Auth.isConfigured(), true); } finally { env2.done(); }
});

test("login redirects to the Cognito authorize endpoint with code flow and PKCE S256", async () => {
  const env = setup({ hash: "#/maintenance?id=abc" });
  try {
    const { url, tx } = await loginAndGetTx(env);
    assert.equal(url.origin, "https://" + HOST);
    assert.equal(url.pathname, "/oauth2/authorize");
    const q = url.searchParams;
    assert.equal(q.get("response_type"), "code");
    assert.equal(q.get("client_id"), CLIENT);
    assert.equal(q.get("redirect_uri"), REDIRECT);
    assert.equal(q.get("scope"), SCOPES);                             // includes the API scopes the routes require
    assert.equal(q.get("code_challenge_method"), "S256");
    assert.equal(q.get("state"), tx.state);
    assert.equal(q.get("nonce"), tx.nonce);
    const expected = require("node:crypto").createHash("sha256").update(tx.verifier).digest("base64url");
    assert.equal(q.get("code_challenge"), expected);                  // challenge = base64url(SHA-256(verifier))
    assert.notEqual(q.get("code_challenge"), tx.verifier);            // the verifier itself is never sent
    assert.ok(tx.verifier.length >= 43 && /^[A-Za-z0-9_-]+$/.test(tx.verifier));
    assert.ok(tx.state.length >= 20 && tx.nonce.length >= 20);
    assert.equal(tx.route, "#/maintenance?id=abc");                   // where to return after sign-in
    for (const forbidden of ["client_secret", "response_type=token", "access_token", "id_token"]) assert.ok(!url.href.includes(forbidden));
  } finally { env.done(); }
});

test("every login uses fresh random values", async () => {
  const env = setup();
  try {
    const a = (await loginAndGetTx(env)).tx, b = (await loginAndGetTx(env)).tx;
    assert.notEqual(a.verifier, b.verifier);
    assert.notEqual(a.state, b.state);
    assert.notEqual(a.nonce, b.nonce);
  } finally { env.done(); }
});

test("create account goes to the hosted sign-up page with the same protections", async () => {
  const env = setup();
  try {
    await env.Auth.signUp();
    const url = new URL(env.assigned.at(-1));
    assert.equal(url.origin + url.pathname, "https://" + HOST + "/signup");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.ok(url.searchParams.get("state"));
  } finally { env.done(); }
});

test("login does nothing unsafe when it is not configured", async () => {
  const env = setup({ config: {} });
  try {
    await assert.rejects(() => env.Auth.login());
    assert.deepEqual(env.assigned, []);
  } finally { env.done(); }
});

test("a return route that is not a plain hash route is not remembered", async () => {
  const env = setup({ hash: "#/x\"><script>" });
  try {
    const { tx } = await loginAndGetTx(env);
    assert.equal(tx.route, "");
  } finally { env.done(); }
});

// ------------------------------------------------------------------ successful callback
test("successful callback exchanges the code with PKCE and stores a session", async () => {
  const env = setup({ hash: "#/dashboard" });
  try {
    const { tx } = await loginAndGetTx(env);
    returnFromCognito(env, tx);
    env.search = env.search;                                         // ?code=...&state=...
    assert.equal(env.Auth.hasCallback(), true);
    const t = tokens(env);
    env.setFetch(() => okResponse(t));
    env.hash = "";                                                    // Cognito redirects to "/", the hash is gone
    assert.equal(await env.Auth.handleCallback(), true);
    // token request
    assert.equal(env.fetchCalls.length, 1);
    const call = env.fetchCalls[0];
    assert.equal(call.url, "https://" + HOST + "/oauth2/token");
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers["Content-Type"], "application/x-www-form-urlencoded");
    assert.equal(call.init.credentials, "omit");
    const body = new URLSearchParams(call.init.body);
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("client_id"), CLIENT);
    assert.equal(body.get("code"), "abcDEF123-._~xyz");
    assert.equal(body.get("redirect_uri"), REDIRECT);
    assert.equal(body.get("code_verifier"), tx.verifier);
    assert.equal(body.has("client_secret"), false);
    assert.equal(call.init.headers.Authorization, undefined);        // no secret, so no Basic authorization
    // result
    assert.equal(env.Auth.isAuthenticated(), true);
    assert.equal(env.Auth.getToken(), t.access_token);               // the ACCESS token is what the API gets
    assert.equal(env.Auth.getUserId(), SUB);
    assert.equal(env.Auth.getFirstName(), "Zo\u00eb");               // read from the ID token, UTF-8 intact
    assert.deepEqual(env.Auth.getProfile(), { name: "Zo\u00eb", email: "zoe@example.test", emailVerified: true });
    assert.equal(env.session.getItem("cluenest_oauth_tx"), null);
    assert.equal(env.search, "");
    assert.equal(env.replaced.at(-1), "/#/dashboard");               // the screen the user came from is restored
    assert.equal(env.hash, "#/dashboard");
    assert.equal(env.Auth.getNotice(), "");
    // storage rules
    assert.equal(env.local.length, 0);                                // nothing in localStorage
    const stored = env.session.getItem("cluenest_session");
    assert.ok(!stored.includes("REFRESH-TOKEN-VALUE"));              // the refresh token is not kept
    assert.deepEqual(Object.keys(JSON.parse(stored)).sort(), ["access", "exp", "id"]);
    assertNoSecretsLogged(env, t.access_token, t.id_token, "REFRESH-TOKEN-VALUE", tx.verifier, "abcDEF123");
  } finally { env.done(); }
});

test("the token request is abandoned after the timeout", async () => {
  const env = setup();
  try {
    const { tx } = await loginAndGetTx(env);
    returnFromCognito(env, tx);
    env.setFetch((_u, init) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))));
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms >= 10000 ? 5 : ms, ...a);   // do not wait 10 s
    try { assert.equal(await env.Auth.handleCallback(), false); } finally { globalThis.setTimeout = realSetTimeout; }
    assertSignedOut(env);
    assert.match(env.Auth.getNotice(), /could not be completed/);
  } finally { env.done(); }
});

// ------------------------------------------------------------------ invalid callbacks
test("invalid callbacks never sign the user in", async (t) => {
  const cases = {
    "state does not match": (env, tx) => returnFromCognito(env, tx, { state: "WRONG-STATE-VALUE-0000000000" }),
    "state missing": (env, tx) => returnFromCognito(env, tx, { state: "" }),
    "code missing": (env, tx) => returnFromCognito(env, tx, { code: "" }),
    "code has odd characters": (env, tx) => returnFromCognito(env, tx, { code: "abc<script>alert(1)" }),
    "code too short": (env, tx) => returnFromCognito(env, tx, { code: "abc" }),
    "sign-in was too long ago": (env, tx) => { returnFromCognito(env, tx); env.now += 11 * 60 * 1000; }
  };
  for (const [name, arrange] of Object.entries(cases)) {
    await t.test(name, async () => {
      const env = setup();
      try {
        const { tx } = await loginAndGetTx(env);
        arrange(env, tx);
        env.setFetch(() => okResponse(tokens(env)));
        assert.equal(await env.Auth.handleCallback(), false);
        assert.equal(env.fetchCalls.length, 0, "no token request for a bad callback");
        assertSignedOut(env);
        assert.match(env.Auth.getNotice(), /Sign-in could not be completed/);
      } finally { env.done(); }
    });
  }
});

test("a callback with no sign-in in progress is rejected (for example a copied or replayed link)", async () => {
  const env = setup({ search: "?code=abcDEF123-._~xyz&state=whatever-state-value-123" });
  try {
    env.setFetch(() => okResponse(tokens(env)));
    assert.equal(await env.Auth.handleCallback(), false);
    assert.equal(env.fetchCalls.length, 0);
    assertSignedOut(env);
  } finally { env.done(); }
});

test("a callback cannot be used twice", async () => {
  const env = setup();
  try {
    const { tx } = await loginAndGetTx(env);
    returnFromCognito(env, tx);
    env.setFetch(() => okResponse(tokens(env)));
    assert.equal(await env.Auth.handleCallback(), true);
    env.Auth.signOut();
    returnFromCognito(env, tx);                                      // same code and state again
    assert.equal(await env.Auth.handleCallback(), false);
    assert.equal(env.fetchCalls.length, 1);
    assertSignedOut(env);
  } finally { env.done(); }
});

test("an error from Cognito (for example the user cancelled) is handled without a token request", async () => {
  const env = setup();
  try {
    const { tx } = await loginAndGetTx(env);
    env.search = "?error=access_denied&error_description=" + encodeURIComponent("<b>evil</b>") + "&state=" + tx.state;
    assert.equal(env.Auth.hasCallback(), true);
    assert.equal(await env.Auth.handleCallback(), false);
    assert.equal(env.fetchCalls.length, 0);
    assertSignedOut(env);
    assert.ok(!env.Auth.getNotice().includes("evil"));               // provider text is never shown
    assert.match(env.Auth.getNotice(), /cancelled or did not complete/);
  } finally { env.done(); }
});

test("a token endpoint failure leaves the user signed out", async (t) => {
  const failures = {
    "HTTP 400": () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) }),
    "HTTP 500": () => ({ ok: false, status: 500, json: async () => ({}) }),
    "network error": () => { throw new TypeError("Failed to fetch"); },
    "response is not JSON": () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } }),
    "empty answer": () => okResponse({})
  };
  for (const [name, fn] of Object.entries(failures)) {
    await t.test(name, async () => {
      const env = setup();
      try {
        const { tx } = await loginAndGetTx(env);
        returnFromCognito(env, tx);
        env.setFetch(fn);
        assert.equal(await env.Auth.handleCallback(), false);
        assertSignedOut(env);
        assert.match(env.Auth.getNotice(), /could not be completed/);
      } finally { env.done(); }
    });
  }
});

test("tokens that do not match this app, pool or sign-in are rejected", async (t) => {
  const exp = () => Math.floor(START / 1000) + 3600;
  const base = (env) => ({
    access: { sub: SUB, token_use: "access", client_id: CLIENT, iss: ISS, exp: exp(), scope: SCOPES },
    id: { sub: SUB, token_use: "id", aud: CLIENT, iss: ISS, exp: exp(), nonce: env.nonce }
  });
  const cases = {
    "access token for another client": (c) => { c.access.client_id = "otherclient"; },
    "ID token for another client": (c) => { c.id.aud = "otherclient"; },
    "wrong nonce": (c) => { c.id.nonce = "not-the-nonce"; },
    "missing nonce": (c) => { delete c.id.nonce; },
    "other issuer": (c) => { c.access.iss = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_OTHER"; },
    "access token used as ID token": (c) => { c.id.token_use = "access"; },
    "ID token used as access token": (c) => { c.access.token_use = "id"; },
    "different users in the two tokens": (c) => { c.id.sub = "99999999-bbbb-4bbb-8bbb-999999999999"; },
    "already expired": (c) => { c.access.exp = Math.floor(START / 1000) - 10; },
    "expires within the safety margin": (c) => { c.id.exp = Math.floor(START / 1000) + 10; },
    "no expiry": (c) => { delete c.access.exp; },
    "no API scopes granted": (c) => { c.access.scope = "openid email profile"; },
    "only the read scope granted": (c) => { c.access.scope = "openid cluenest-api/read"; },
    "no scope claim": (c) => { delete c.access.scope; },
    "scope is not text": (c) => { c.access.scope = ["cluenest-api/read", "cluenest-api/write"]; }
  };
  for (const [name, mutate] of Object.entries(cases)) {
    await t.test(name, async () => {
      const env = setup();
      try {
        const { tx } = await loginAndGetTx(env);
        returnFromCognito(env, tx);
        const c = base(env);
        mutate(c);
        env.setFetch(() => okResponse({ access_token: jwt(c.access), id_token: jwt(c.id), refresh_token: "R" }));
        assert.equal(await env.Auth.handleCallback(), false);
        assertSignedOut(env);
      } finally { env.done(); }
    });
  }
  for (const [name, body] of Object.entries({ "not JWTs": { access_token: "abc", id_token: "def" }, "only an access token": { access_token: "a.b.c" } })) {
    await t.test(name, async () => {
      const env = setup();
      try {
        const { tx } = await loginAndGetTx(env);
        returnFromCognito(env, tx);
        env.setFetch(() => okResponse(body));
        assert.equal(await env.Auth.handleCallback(), false);
        assertSignedOut(env);
      } finally { env.done(); }
    });
  }
});

// ------------------------------------------------------------------ session restore, expiry, logout
async function signedIn(env) {
  const { tx } = await loginAndGetTx(env);
  returnFromCognito(env, tx);
  const t = tokens(env);
  env.setFetch(() => okResponse(t));
  assert.equal(await env.Auth.handleCallback(), true);
  return t;
}

test("session is restored after a page refresh, and only in the same tab", async () => {
  const env = setup();
  try {
    const t = await signedIn(env);
    delete require.cache[AUTH_PATH];
    const reloaded = require(AUTH_PATH);                              // a new page load: fresh module, same sessionStorage
    assert.equal(reloaded.isAuthenticated(), true);
    assert.equal(reloaded.getToken(), t.access_token);
    assert.equal(reloaded.getFirstName(), "Zo\u00eb");
    env.window.sessionStorage = storage();                            // a different tab or window: empty storage
    delete require.cache[AUTH_PATH];
    assert.equal(require(AUTH_PATH).isAuthenticated(), false);
  } finally { env.done(); }
});

test("an expired session is dropped and the reason is remembered", async () => {
  const env = setup();
  try {
    await signedIn(env);
    env.now += 3600 * 1000 - 20 * 1000;                               // 20 s before expiry: inside the 30 s margin
    assert.equal(env.Auth.getToken(), null);
    assert.equal(env.Auth.isAuthenticated(), false);
    assert.equal(env.session.getItem("cluenest_session"), null);
    assert.match(env.Auth.getNotice(), /session has expired/);
    assert.equal(env.Auth.getUserId(), null);
    assert.equal(env.Auth.getFirstName(), null);
  } finally { env.done(); }
});

test("a session is still valid shortly before it expires", async () => {
  const env = setup();
  try {
    await signedIn(env);
    env.now += 3600 * 1000 - 60 * 1000;
    assert.equal(env.Auth.isAuthenticated(), true);
  } finally { env.done(); }
});

test("a damaged stored session is ignored", () => {
  for (const bad of ["not json", "{}", JSON.stringify({ access: 1, id: 2, exp: "x" }), JSON.stringify({ access: "a", id: "b" })]) {
    const env = setup();
    try {
      env.session.setItem("cluenest_session", bad);
      assert.equal(env.Auth.isAuthenticated(), false);
      assert.equal(env.Auth.getToken(), null);
    } finally { env.done(); }
  }
});

test("sign out clears the session and all ClueNest data for the tab, then returns the Cognito logout URL", async () => {
  const env = setup();
  try {
    await signedIn(env);
    env.session.setItem("cluenest_selected_appliance", "{}");
    env.session.setItem("cluenest_problem_context", "{}");
    env.session.setItem("other_site_key", "keep");
    const url = env.Auth.signOut();
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, "https://" + HOST + "/logout");
    assert.equal(u.searchParams.get("client_id"), CLIENT);
    assert.equal(u.searchParams.get("logout_uri"), REDIRECT);
    assert.equal(env.Auth.isAuthenticated(), false);
    assert.equal(env.session.getItem("cluenest_session"), null);
    assert.equal(env.session.getItem("cluenest_selected_appliance"), null);
    assert.equal(env.session.getItem("cluenest_problem_context"), null);
    assert.equal(env.session.getItem("other_site_key"), "keep");
    assert.equal(env.Auth.getNotice(), "");                           // signing out is not an "expired" message
  } finally { env.done(); }
});

test("the logout URL needs a safe return address", () => {
  const cfg = (logoutUri) => ({ apiBaseUrl: "https://a", cognito: { clientId: CLIENT, hostedUiDomain: HOST, redirectUri: REDIRECT, logoutUri } });
  for (const bad of ["", "http://example.com/", "javascript:alert(1)", "ftp://x"]) {
    const env = setup({ config: cfg(bad) });
    try { assert.equal(env.Auth.getLogoutUrl(), "", bad); } finally { env.done(); }
  }
  for (const good of ["https://app.example.com/", "http://localhost:5500/"]) {
    const env = setup({ config: cfg(good) });
    try { assert.ok(env.Auth.getLogoutUrl().startsWith("https://" + HOST + "/logout?"), good); } finally { env.done(); }
  }
});

test("a bad domain in the configuration is refused", async () => {
  const env = setup({ config: { apiBaseUrl: "https://a", cognito: { clientId: CLIENT, hostedUiDomain: "evil.com/\"><x", redirectUri: REDIRECT, logoutUri: REDIRECT } } });
  try {
    await assert.rejects(() => env.Auth.login());
    assert.equal(env.Auth.getLogoutUrl(), "");
    assert.deepEqual(env.assigned, []);
  } finally { env.done(); }
});

test("tokens are never written to localStorage or the console during a full sign-in and sign-out", async () => {
  const env = setup();
  try {
    const t = await signedIn(env);
    env.Auth.signOut();
    assert.equal(env.local.length, 0);
    assertNoSecretsLogged(env, t.access_token, t.id_token, "REFRESH-TOKEN-VALUE");
  } finally { env.done(); }
});

// ------------------------------------------------------------------ API requests
function apiWith(env) {
  const { Api } = require(API_PATH);
  return Api;
}

test("API requests send the access token as a Bearer token", async () => {
  const env = setup();
  try {
    const t = await signedIn(env);
    env.setFetch(() => ({ ok: true, status: 200, json: async () => ({ appliances: [] }) }));
    env.fetchCalls.length = 0;
    await apiWith(env).getAppliances();
    const call = env.fetchCalls[0];
    assert.equal(call.url, "https://api.example.test/dev/appliances");
    assert.equal(call.init.headers.Authorization, "Bearer " + t.access_token);
    assert.notEqual(call.init.headers.Authorization, "Bearer " + t.id_token);
    assertNoSecretsLogged(env, t.access_token);
  } finally { env.done(); }
});

test("technician search goes to the configured path with the Bearer access token", async () => {
  const env = setup();
  try {
    const t = await signedIn(env);
    env.setFetch(() => ({ ok: true, status: 200, json: async () => ({ results: [] }) }));
    env.fetchCalls.length = 0;
    await apiWith(env).searchTechnicians({ location: "Toronto", radiusKm: 10 });
    assert.equal(env.fetchCalls[0].url, "https://api.example.test/dev/technicians/search?location=Toronto&radiusKm=10");
    assert.equal(env.fetchCalls[0].init.headers.Authorization, "Bearer " + t.access_token);
  } finally { env.done(); }
});

test("with no session the API is not called at all", async () => {
  const env = setup();
  try {
    env.setFetch(() => { throw new Error("must not be called"); });
    await assert.rejects(() => apiWith(env).getAppliances(), (e) => e.code === "unauthenticated");
    assert.equal(env.fetchCalls.length, 0);
  } finally { env.done(); }
});

test("an expired session stops API calls before they are sent and asks for sign-in", async () => {
  const env = setup();
  try {
    await signedIn(env);
    env.now += 2 * 3600 * 1000;
    env.fetchCalls.length = 0;
    env.setFetch(() => { throw new Error("must not be called"); });
    await assert.rejects(() => apiWith(env).getAppliances(), (e) => e.code === "unauthenticated" && /expired/.test(e.message));
    assert.equal(env.fetchCalls.length, 0);
  } finally { env.done(); }
});

test("a 401 from the API ends the session, shows an expiry message and schedules the sign-in screen", async () => {
  const env = setup();
  const realSetTimeout = globalThis.setTimeout;
  try {
    await signedIn(env);
    let prompted = 0;
    env.Auth.onSignInNeeded(() => { prompted++; });
    const timers = [];
    globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return 0; };
    env.setFetch(() => ({ ok: false, status: 401, json: async () => ({ message: "Unauthorized" }) }));
    await assert.rejects(() => apiWith(env).getAppliances(), (e) => e.code === "unauthenticated" && /expired/.test(e.message));
    assert.equal(env.Auth.isAuthenticated(), false);
    assert.equal(env.session.getItem("cluenest_session"), null);
    assert.match(env.Auth.getNotice(), /expired/);
    assert.equal(timers.length, 1);
    timers[0].fn();
    assert.equal(prompted, 1);
  } finally { globalThis.setTimeout = realSetTimeout; env.done(); }
});

test("a 403 (token without the required scope) ends the session so the user signs in again", async () => {
  const env = setup();
  const realSetTimeout = globalThis.setTimeout;
  try {
    await signedIn(env);
    let prompted = 0;
    env.Auth.onSignInNeeded(() => { prompted++; });
    const timers = [];
    globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return 0; };
    env.setFetch(() => ({ ok: false, status: 403, json: async () => ({ message: "Forbidden" }) }));
    await assert.rejects(() => apiWith(env).getAppliances(), (e) => e.code === "unauthenticated" && /not authorised/.test(e.message));
    assert.equal(env.Auth.isAuthenticated(), false);
    assert.match(env.Auth.getNotice(), /not authorised/);
    timers[0].fn();
    assert.equal(prompted, 1);
  } finally { globalThis.setTimeout = realSetTimeout; env.done(); }
});

test("a stored session from before the API required scopes is dropped with a clear message", () => {
  const env = setup();
  try {
    const exp = Math.floor(START / 1000) + 3600;
    const old = { access: jwt({ sub: SUB, token_use: "access", client_id: CLIENT, iss: ISS, exp, scope: "openid email profile" }),
                  id: jwt({ sub: SUB, token_use: "id", aud: CLIENT, iss: ISS, exp }), exp: exp * 1000 };
    env.session.setItem("cluenest_session", JSON.stringify(old));
    assert.equal(env.Auth.isAuthenticated(), false);
    assert.equal(env.Auth.getToken(), null);
    assert.equal(env.session.getItem("cluenest_session"), null);
    assert.match(env.Auth.getNotice(), /updated.*sign in again/i);
  } finally { env.done(); }
});

test("the ID token is never sent to the API, even when the access token is missing", async () => {
  const env = setup();
  try {
    const t = await signedIn(env);
    env.setFetch(() => ({ ok: true, status: 200, json: async () => ({ appliances: [] }) }));
    env.fetchCalls.length = 0;
    await apiWith(env).getAppliances();
    for (const c of env.fetchCalls) assert.ok(!JSON.stringify(c.init.headers).includes(t.id_token));
    env.session.setItem("cluenest_session", JSON.stringify({ id: t.id_token, access: "", exp: START + 3600000 }));
    env.fetchCalls.length = 0;
    await assert.rejects(() => apiWith(env).getAppliances(), (e) => e.code === "unauthenticated");
    assert.equal(env.fetchCalls.length, 0);
  } finally { env.done(); }
});

test("other API errors keep the session and the server's message", async () => {
  const env = setup();
  try {
    await signedIn(env);
    env.setFetch(() => ({ ok: false, status: 503, json: async () => ({ message: "The service is busy." }) }));
    await assert.rejects(() => apiWith(env).getAppliances(), (e) => e.code === "http" && /503/.test(e.message) && /busy/.test(e.message));
    assert.equal(env.Auth.isAuthenticated(), true);
  } finally { env.done(); }
});

// ------------------------------------------------------------------ maintenance reminder e-mail setting
test("the e-mail reminder setting is read with the Bearer access token", async () => {
  const env = setup();
  try {
    const t = await signedIn(env);
    env.setFetch(() => ({ ok: true, status: 200, json: async () => ({ maintenanceEmail: { enabled: true, status: "pending" } }) }));
    env.fetchCalls.length = 0;
    const prefs = await apiWith(env).getNotificationPreferences();
    assert.deepEqual(prefs, { enabled: true, status: "pending" });
    const call = env.fetchCalls[0];
    assert.equal(call.url, "https://api.example.test/dev/notifications/preferences");
    assert.equal(call.init.method, "GET");
    assert.equal(call.init.headers.Authorization, "Bearer " + t.access_token);
  } finally { env.done(); }
});

test("turning the e-mail reminders on or off sends only true or false", async () => {
  const env = setup();
  try {
    const t = await signedIn(env);
    env.setFetch((_u, init) => ({ ok: true, status: 200, json: async () => ({ maintenanceEmail: { enabled: JSON.parse(init.body).maintenanceEmail, status: "pending" } }) }));
    env.fetchCalls.length = 0;
    assert.deepEqual(await apiWith(env).setMaintenanceEmail(true), { enabled: true, status: "pending" });
    const call = env.fetchCalls[0];
    assert.equal(call.init.method, "PUT");
    assert.deepEqual(JSON.parse(call.init.body), { maintenanceEmail: true });                  // no e-mail address is ever sent
    assert.equal(call.init.headers.Authorization, "Bearer " + t.access_token);
    for (const bad of ["true", 1, null, undefined, {}, "alice@example.test"]) {
      await assert.rejects(() => apiWith(env).setMaintenanceEmail(bad), (e) => e.code === "invalid");
    }
    assert.equal(env.fetchCalls.length, 1);
  } finally { env.done(); }
});

test("unknown or missing values from the server read as off", async () => {
  const env = setup();
  try {
    await signedIn(env);
    for (const body of [null, {}, { maintenanceEmail: null }, { maintenanceEmail: { enabled: "yes", status: "weird" } }, { maintenanceEmail: { enabled: true, status: "<b>x</b>" } }]) {
      env.setFetch(() => ({ ok: true, status: 200, json: async () => body }));
      const p = await apiWith(env).getNotificationPreferences();
      assert.equal(p.status, "off");
      assert.equal(p.enabled, Boolean(body && body.maintenanceEmail && body.maintenanceEmail.enabled === true));
    }
  } finally { env.done(); }
});

test("setting errors show the server's message and keep the session", async () => {
  const env = setup();
  try {
    await signedIn(env);
    for (const [status, message] of [[409, "Your account has no verified e-mail address."], [429, "Please wait a few minutes."], [503, "Notification settings are temporarily unavailable."]]) {
      env.setFetch(() => ({ ok: false, status, json: async () => ({ message }) }));
      await assert.rejects(() => apiWith(env).setMaintenanceEmail(true), (e) => e.code === "http" && e.message.includes(String(status)) && e.message.includes(message));
    }
    assert.equal(env.Auth.isAuthenticated(), true);
  } finally { env.done(); }
});

test("every status has a plain explanation, and nothing is claimed that is not true", () => {
  const Settings = require(path.join(__dirname, "..", "js", "settings.js"));
  for (const s of ["off", "pending", "active", "needs_attention"]) assert.ok(Settings.emailStatus(s).text.length > 20, s);
  assert.match(Settings.emailStatus("pending").text, /confirm/i);
  assert.match(Settings.emailStatus("pending").text, /nothing is sent/i);
  assert.match(Settings.emailStatus("needs_attention").text, /again/i);
  assert.equal(Settings.emailStatus("something else"), Settings.emailStatus("off"));          // unknown means off
  assert.match(Settings.PROTOTYPE_NOTE, /warranty and repair/i);
  assert.doesNotMatch(Settings.PROTOTYPE_NOTE, /maintenance/i);                                  // the maintenance switch is not a prototype
});
