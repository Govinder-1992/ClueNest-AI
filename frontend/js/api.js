// API client for the existing ClueNest AI backend.
class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // "not_configured" | "unauthenticated" | "http" | "network"
  }
}

const Api = (() => {
  async function request(path, options = {}) {
    const base = (window.CLUENEST_CONFIG || {}).apiBaseUrl;
    if (!base) throw new ApiError("not_configured", "API base URL is not configured.");
    // The Cognito ACCESS token, as "Bearer <token>". The API's JWT authorizer also accepts it.
    const token = Auth.getToken();
    if (!token) {
      if (Auth.isConfigured()) Auth.endSession();   // shows the sign-in screen shortly after
      throw new ApiError("unauthenticated", Auth.getNotice() || "You are not signed in.");
    }

    let res;
    try {
      res = await fetch(base.replace(/\/+$/, "") + path, {
        method: options.method || "GET",
        headers: Object.assign({ Authorization: "Bearer " + token, Accept: "application/json" },
          options.body ? { "Content-Type": "application/json" } : {}),
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch (e) {
      throw new ApiError("network", "Could not reach the server.");
    }
    if (res.status === 401) {
      Auth.endSession();                             // the token is no longer valid
      throw new ApiError("unauthenticated", "Your session has expired. Please sign in again.");
    }
    if (res.status === 403) {
      // The token is valid but lacks the scope the route requires (for example a session that started
      // before the API required scopes, or an ID token). Signing in again gets a token with the scopes.
      Auth.endSession("Your session is not authorised. Please sign in again.");
      throw new ApiError("unauthenticated", "Your session is not authorised. Please sign in again.");
    }
    if (!res.ok) {
      let detail = "";
      try {
        const b = await res.json(); detail = b.message || b.error || "";
        // Field-level messages from the backend validators (for example "The repair date cannot be in the future.").
        if (b.fields && typeof b.fields === "object") {
          const f = Object.values(b.fields).filter(x => typeof x === "string" && x);
          if (f.length) detail += (detail ? " " : "") + f.join(" ");
        }
      } catch (e) { /* no body */ }
      throw new ApiError("http", "Request failed (" + res.status + ")" + (detail ? ": " + detail : "."));
    }
    try { return await res.json(); } catch (e) { return null; }
  }

  // GET /appliances. Accepts a bare array or an object wrapping one.
  async function getAppliances() {
    const data = await request("/appliances");
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.appliances)) return data.appliances;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  }

  // POST /appliances. The user is identified by the token on the server; no user ID is sent.
  async function createAppliance(payload) {
    return request("/appliances", { method: "POST", body: payload });
  }

  // POST /troubleshoot. The user is identified by the token on the server.
  async function troubleshoot(payload) {
    return request("/troubleshoot", { method: "POST", body: payload });
  }

  // GET <technicianSearchPath>?location=...&radiusKm=...&applianceType=...
  // The backend performs the Google Places search; no Google key is used here.
  async function searchTechnicians(query) {
    const path = (window.CLUENEST_CONFIG || {}).technicianSearchPath;
    if (!path) throw new ApiError("not_configured", "The technician-search endpoint is not configured.");
    const qs = new URLSearchParams();
    Object.keys(query).forEach(k => { if (query[k] !== "" && query[k] != null) qs.set(k, query[k]); });
    return request(path + "?" + qs.toString());
  }

  // GET and PUT /notifications/preferences: the maintenance reminder e-mail setting, kept in the backend.
  // status: "off", "pending" (waiting for the user to confirm the e-mail from Amazon SNS), "active",
  // or "needs_attention" (switched on, but the confirmation expired or the user unsubscribed from the e-mail).
  const STATUSES = ["off", "pending", "active", "needs_attention"];
  function normalizePrefs(data) {
    const m = (data && data.maintenanceEmail) || {};
    return { enabled: m.enabled === true, status: STATUSES.includes(m.status) ? m.status : "off" };
  }
  async function getNotificationPreferences() {
    return normalizePrefs(await request("/notifications/preferences"));
  }
  async function setMaintenanceEmail(enabled) {
    if (typeof enabled !== "boolean") throw new ApiError("invalid", "Choose on or off.");
    return normalizePrefs(await request("/notifications/preferences", { method: "PUT", body: { maintenanceEmail: enabled } }));
  }
  // Repair history: GET/POST /repair-history and PUT/DELETE /repair-history/{id}. The user comes from the token.
  const idPath = (base, id) => {
    if (id == null || id === "") throw new ApiError("invalid", "A record ID is required.");
    return base + "/" + encodeURIComponent(id);
  };
  const listOf = (data, key) => (data && Array.isArray(data[key]) ? data[key] : []);
  const itemOf = (data, key) => (data && data[key] && typeof data[key] === "object" ? data[key] : null);
  async function getRepairRecords() { return listOf(await request("/repair-history"), "records"); }
  async function createRepairRecord(payload) { return itemOf(await request("/repair-history", { method: "POST", body: payload }), "record"); }
  async function updateRepairRecord(id, payload) { return itemOf(await request(idPath("/repair-history", id), { method: "PUT", body: payload }), "record"); }
  async function deleteRepairRecord(id) { await request(idPath("/repair-history", id), { method: "DELETE" }); }
  // Maintenance reminders: GET/POST /maintenance, PUT/DELETE /maintenance/{id}, POST /maintenance/{id}/complete.
  async function getMaintenanceReminders() { return listOf(await request("/maintenance"), "reminders"); }
  async function createMaintenanceReminder(payload) { return itemOf(await request("/maintenance", { method: "POST", body: payload }), "reminder"); }
  async function updateMaintenanceReminder(id, payload) { return itemOf(await request(idPath("/maintenance", id), { method: "PUT", body: payload }), "reminder"); }
  async function deleteMaintenanceReminder(id) { await request(idPath("/maintenance", id), { method: "DELETE" }); }
  // Returns { completed, next }. "next" is the new occurrence of a repeating reminder, or null.
  async function completeMaintenanceReminder(id, completedDate) {
    const data = await request(idPath("/maintenance", id) + "/complete", { method: "POST", body: { completedDate } });
    return { completed: itemOf(data, "completed"), next: itemOf(data, "next") };
  }
  return { getAppliances, createAppliance, troubleshoot, searchTechnicians, getNotificationPreferences, setMaintenanceEmail,
    getRepairRecords, createRepairRecord, updateRepairRecord, deleteRepairRecord,
    getMaintenanceReminders, createMaintenanceReminder, updateMaintenanceReminder, deleteMaintenanceReminder, completeMaintenanceReminder };
})();
if (typeof module !== "undefined") module.exports = { Api, ApiError };
