// Authentication: Amazon Cognito hosted sign-in with the authorization code flow and PKCE (S256).
// Browser-only, so there is no client secret anywhere. Public values come from config.js.
//
//  * Sign in / create account: redirect to the Cognito hosted pages. Sign-up, e-mail
//    verification, password reset and the password itself are handled by Cognito, never by this code.
//  * Callback: the code in the address is exchanged for tokens at the Cognito token endpoint, using the
//    PKCE verifier kept in sessionStorage for the few minutes the sign-in takes.
//  * Session: the access token and ID token are kept in sessionStorage (this tab only, cleared when the
//    tab closes, never localStorage) so a page refresh keeps you signed in. The refresh token is NOT
//    kept: when the access token expires you sign in again (Cognito's own session usually makes that
//    one redirect with no password prompt).
//  * API calls send "Authorization: Bearer <access token>" (see api.js).
//  * Nothing here logs tokens, and tokens are never put in a URL.
// Limitation of a browser-only app: any script running on the page (for example through a cross-site
// scripting flaw) could read sessionStorage. Keep third-party scripts out of the page. The server
// verifies every token; the checks made here only protect the user from broken or forged callbacks.
const Auth = (() => {
  const SESSION_KEY = "cluenest_session";      // { access, id, exp }  exp = milliseconds since 1970
  const TX_KEY = "cluenest_oauth_tx";          // PKCE verifier, state, nonce and return route during sign-in
  const TX_MAX_AGE_MS = 10 * 60 * 1000;
  const SKEW_MS = 30 * 1000;                   // treat a token as expired 30 s early
  const TOKEN_TIMEOUT_MS = 10 * 1000;
  // The API requires cluenest-api/read (GET routes) and cluenest-api/write (POST, PUT, DELETE routes) in the
  // ACCESS token. Cognito adds them only when they are requested here and allowed on the app client.
  const API_SCOPES = ["cluenest-api/read", "cluenest-api/write"];
  const SCOPES = ["openid", "email", "profile"].concat(API_SCOPES).join(" ");
  const CODE_RE = /^[A-Za-z0-9\-._~]{8,512}$/;
  const ROUTE_RE = /^#\/[\w\-\/?=&%.]{0,200}$/;
  const MSG_EXPIRED = "Your session has expired. Please sign in again.";
  const MSG_FAILED = "Sign-in could not be completed. Please try again.";
  const MSG_UPDATED = "ClueNest has been updated. Please sign in again to continue.";
  let notice = "";
  let promptHandler = null;
  let promptScheduled = false;

  const cfg = () => window.CLUENEST_CONFIG || {};
  const cog = () => cfg().cognito || {};
  const store = () => window.sessionStorage;

  function isConfigured() {
    const c = cfg();
    return Boolean(c.apiBaseUrl && c.cognito && c.cognito.clientId && c.cognito.hostedUiDomain && c.cognito.redirectUri);
  }
  function domain() {
    const d = String(cog().hostedUiDomain || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    return /^[a-z0-9.-]+$/i.test(d) ? d : "";
  }
  function issuer() {
    const c = cog();
    return c.region && c.userPoolId ? "https://cognito-idp." + c.region + ".amazonaws.com/" + c.userPoolId : "";
  }

  // ---------- small helpers ----------
  function b64url(bytes) {
    let s = "";
    bytes.forEach(b => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function randomString(byteCount) {
    const bytes = new Uint8Array(byteCount);
    window.crypto.getRandomValues(bytes);
    return b64url(bytes);
  }
  async function challengeFor(verifier) {
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return b64url(new Uint8Array(digest));
  }
  function sameText(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }
  // Payload of a JWT (no signature check: the server does that). Null when it is not a JWT.
  function decodeJwt(token) {
    try {
      const parts = String(token || "").replace(/^Bearer\s+/i, "").split(".");
      if (parts.length !== 3 || !parts[1]) return null;
      const bin = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
      const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
      const c = JSON.parse(new TextDecoder().decode(bytes));
      return c && typeof c === "object" && !Array.isArray(c) ? c : null;
    } catch (e) {
      return null;
    }
  }

  // ---------- session ----------
  function clearSession() { store().removeItem(SESSION_KEY); }
  function readSession() {
    let s = null;
    try { s = JSON.parse(store().getItem(SESSION_KEY)); } catch (e) { s = null; }
    const ok = s && typeof s.access === "string" && typeof s.id === "string" && Number.isFinite(s.exp);
    return ok ? s : null;
  }
  // The stored session, or null. An expired session is removed and remembered as the reason to show.
  // True when the access token carries every scope the API requires.
  function hasApiScopes(accessClaims) {
    const granted = accessClaims && typeof accessClaims.scope === "string" ? accessClaims.scope.split(/\s+/) : [];
    return API_SCOPES.every(s => granted.includes(s));
  }
  function getSession() {
    const s = readSession();
    if (!s) return null;
    if (!hasApiScopes(decodeJwt(s.access))) {           // a session from before the API required scopes
      clearSession();
      notice = MSG_UPDATED;
      return null;
    }
    if (s.exp - SKEW_MS <= Date.now()) {
      clearSession();
      notice = MSG_EXPIRED;
      return null;
    }
    return s;
  }
  function getToken() {
    const s = getSession();
    return s ? s.access : null;
  }
  function isAuthenticated() {
    return Boolean(getSession());
  }
  // Claims used for display and for the per-user local data. The ID token carries given_name and email.
  function claims() {
    const s = getSession();
    return s ? (decodeJwt(s.id) || decodeJwt(s.access)) : null;
  }
  function getUserId() {
    const c = claims();
    return c && typeof c.sub === "string" && /^[\w\-:.@]{1,128}$/.test(c.sub) ? c.sub : null;
  }
  // First name from the token claims "given_name" (or the first word of "name"). Null when not available.
  // Email addresses and usernames are deliberately not used.
  function getFirstName() {
    const c = claims();
    if (!c) return null;
    const raw = typeof c.given_name === "string" && c.given_name.trim() ? c.given_name : (typeof c.name === "string" ? c.name.trim().split(/\s+/)[0] : "");
    const first = String(raw || "").trim();
    return first && first.length <= 40 && /^[\p{L}][\p{L}\p{M}\x27\- ]*$/u.test(first) ? first : null;
  }
  // Display-only account details from the token claims. The server is what verifies the token;
  // nothing here can be changed from the frontend.
  function getProfile() {
    const c = claims() || {};
    const clean = (v, max) => { const s = typeof v === "string" ? v.trim() : ""; return s && s.length <= max ? s : ""; };
    const email = clean(c.email, 254);
    const ev = c.email_verified;
    return {
      name: clean(c.name, 100) || [clean(c.given_name, 50), clean(c.family_name, 50)].filter(Boolean).join(" "),
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
      emailVerified: ev === true || ev === "true" ? true : (ev === false || ev === "false" ? false : null)
    };
  }

  // ---------- notices and the sign-in prompt ----------
  // Reason the user is signed out (expired session, failed callback), or "". Kept until the next sign-in attempt.
  function getNotice() { return notice; }
  // app.js registers the function that shows the sign-in screen.
  function onSignInNeeded(handler) { promptHandler = typeof handler === "function" ? handler : null; }
  // Called when the API says the session is no longer valid. The sign-in screen appears shortly after,
  // so the screen that made the call can show its own error first.
  function endSession(message) {
    clearSession();
    notice = message || MSG_EXPIRED;
    if (promptHandler && !promptScheduled) {
      promptScheduled = true;
      setTimeout(() => { promptScheduled = false; if (promptHandler) promptHandler(); }, 2500);
    }
  }

  // ---------- sign in / sign up ----------
  function returnRoute() {
    const h = String(window.location.hash || "");
    return ROUTE_RE.test(h) ? h : "";
  }
  function authorizeUrl(path, tx, challenge) {
    const c = cog();
    const q = new URLSearchParams({
      client_id: c.clientId, response_type: "code", scope: SCOPES, redirect_uri: c.redirectUri,
      state: tx.state, nonce: tx.nonce, code_challenge: challenge, code_challenge_method: "S256"
    });
    return "https://" + domain() + path + "?" + q.toString();
  }
  // Starts a sign-in (or sign-up) by sending the browser to Cognito. Returns the URL it went to.
  async function startLogin(options) {
    if (!isConfigured() || !domain()) throw new Error("Sign-in is not configured.");
    const tx = { verifier: randomString(48), state: randomString(24), nonce: randomString(24), route: returnRoute(), at: Date.now() };
    store().setItem(TX_KEY, JSON.stringify(tx));
    notice = "";
    const url = authorizeUrl(options && options.signUp ? "/signup" : "/oauth2/authorize", tx, await challengeFor(tx.verifier));
    window.location.assign(url);
    return url;
  }
  const login = () => startLogin({ signUp: false });
  const signUp = () => startLogin({ signUp: true });

  // ---------- the return from Cognito ----------
  function hasCallback() {
    const q = new URLSearchParams(window.location.search || "");
    return q.has("code") || q.has("error");
  }
  function takeTx() {
    let tx = null;
    try { tx = JSON.parse(store().getItem(TX_KEY)); } catch (e) { tx = null; }
    store().removeItem(TX_KEY);                    // one use only
    const ok = tx && typeof tx.verifier === "string" && typeof tx.state === "string" && typeof tx.nonce === "string" && Number.isFinite(tx.at);
    return ok ? tx : null;
  }
  // Removes ?code=...&state=... from the address bar (and history entry), restoring the screen the user came from.
  function cleanAddress(route) {
    const loc = window.location;
    try { window.history.replaceState(null, "", (loc.pathname || "/") + (route || "")); } catch (e) { /* ignore */ }
  }
  async function exchangeCode(code, tx) {
    const c = cog();
    const body = new URLSearchParams({ grant_type: "authorization_code", client_id: c.clientId, code, redirect_uri: c.redirectUri, code_verifier: tx.verifier });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TOKEN_TIMEOUT_MS);
    try {
      const res = await fetch("https://" + domain() + "/oauth2/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: ctrl.signal,
        credentials: "omit", cache: "no-store"
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  // Checks the tokens the token endpoint returned. Returns the session to store, or null.
  function sessionFrom(tokens, tx) {
    if (!tokens || typeof tokens.access_token !== "string" || typeof tokens.id_token !== "string") return null;
    const a = decodeJwt(tokens.access_token), i = decodeJwt(tokens.id_token);
    if (!a || !i) return null;
    const c = cog(), iss = issuer(), now = Date.now();
    if (a.token_use !== "access" || a.client_id !== c.clientId || !hasApiScopes(a)) return null;
    if (i.token_use !== "id" || i.aud !== c.clientId || !sameText(String(i.nonce || ""), tx.nonce)) return null;
    if (iss && (a.iss !== iss || i.iss !== iss)) return null;
    if (typeof a.sub !== "string" || a.sub !== i.sub) return null;
    if (!Number.isFinite(a.exp) || !Number.isFinite(i.exp)) return null;
    const exp = Math.min(a.exp, i.exp) * 1000;
    if (exp - SKEW_MS <= now) return null;
    return { access: tokens.access_token, id: tokens.id_token, exp };
  }
  // Finishes a sign-in when the page was opened by Cognito's redirect. Resolves true when signed in.
  async function handleCallback() {
    const q = new URLSearchParams(window.location.search || "");
    const code = q.get("code"), state = q.get("state"), error = q.get("error");
    const tx = takeTx();
    cleanAddress("");
    const fail = () => { notice = MSG_FAILED; return false; };
    if (error) { notice = "Sign-in was cancelled or did not complete. Please try again."; return false; }
    if (!tx || Date.now() - tx.at > TX_MAX_AGE_MS || !state || !sameText(state, tx.state)) return fail();
    if (!code || !CODE_RE.test(code) || !isConfigured() || !domain()) return fail();
    const session = sessionFrom(await exchangeCode(code, tx), tx);
    if (!session) return fail();
    store().setItem(SESSION_KEY, JSON.stringify(session));
    notice = "";
    cleanAddress(ROUTE_RE.test(tx.route || "") ? tx.route : "");
    return true;
  }

  // ---------- sign out ----------
  // Cognito hosted-UI logout URL, or "" when logout settings are not configured (see config.js).
  function getLogoutUrl() {
    const co = cog();
    const back = String(co.logoutUri || "").trim();
    const okBack = /^https:\/\//i.test(back) || /^http:\/\/localhost(:\d+)?(\/|$)/i.test(back);
    if (!domain() || !co.clientId || !okBack) return "";
    return "https://" + domain() + "/logout?client_id=" + encodeURIComponent(co.clientId) + "&logout_uri=" + encodeURIComponent(back);
  }
  // Ends the local session: removes the tokens and any ClueNest session data kept for this tab
  // (selected appliance, problem and warranty context). Returns the Cognito logout URL to visit, or "".
  function signOut() {
    clearSession();
    notice = "";
    Object.keys(store()).filter(k => k.indexOf("cluenest_") === 0).forEach(k => store().removeItem(k));
    return getLogoutUrl();
  }

  return { isConfigured, getToken, isAuthenticated, getUserId, getFirstName, getProfile, getLogoutUrl, signOut,
    login, signUp, hasCallback, handleCallback, getNotice, onSignInNeeded, endSession, clearToken: clearSession };
})();
if (typeof module !== "undefined") module.exports = Auth;
