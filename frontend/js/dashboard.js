// Dashboard screen. It only reads data that other screens already create:
//   appliances      -> GET /appliances (existing authenticated API, via Api.getAppliances)
//   maintenance     -> GET /maintenance    (existing authenticated API, via Api.getMaintenanceReminders)
//   repair records  -> GET /repair-history (existing authenticated API, via Api.getRepairRecords)
//   technician quotes -> QuoteStore       (prototype, browser-local, per user)
// It never writes data and never invents numbers.
const Dashboard = (() => {
  // A warranty that ends within this many days (and is still active) is shown as "Expiring Soon".
  const EXPIRING_DAYS = 30;
  const ALERT_LIMIT = 6, WARRANTY_LIMIT = 6, ACTIVITY_LIMIT = 6;
  const WARRANTY_NOTE = "An active warranty does not guarantee that a particular repair is covered. \"Expiring Soon\" means the warranty ends within " + EXPIRING_DAYS + " days.";

  // ---------- pure logic (also used by tests) ----------
  function daysBetween(a, b) { // whole days from a to b (YYYY-MM-DD)
    const t = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    return Math.round((t(b) - t(a)) / 86400000);
  }

  // Status for one appliance: Active, Expiring Soon, Expired, Unknown or No Warranty.
  function warrantyBucket(appliance, today) {
    const w = WarrantyChecker.computeWarranty(appliance, today);
    let status = w.status;
    if (status === "Active" && daysBetween(today, w.expiry) <= EXPIRING_DAYS) status = "Expiring Soon";
    return { status, expiry: w.expiry || "" };
  }

  function warrantyCounts(appliances, today) {
    const c = { active: 0, expiringSoon: 0 };
    appliances.forEach(a => {
      const s = warrantyBucket(a, today).status;
      if (s === "Active" || s === "Expiring Soon") c.active++;
      if (s === "Expiring Soon") c.expiringSoon++;
    });
    return c;
  }

  const RANK = { "Expiring Soon": 0, "Active": 1, "Expired": 2, "Unknown": 3, "No Warranty": 4 };
  function warrantyRows(appliances, today, limit) {
    return appliances.map(a => Object.assign({ appliance: a }, warrantyBucket(a, today)))
      .sort((x, y) => (RANK[x.status] - RANK[y.status]) || (x.expiry || "9999").localeCompare(y.expiry || "9999"))
      .slice(0, limit);
  }

  // Overdue first (most overdue first), then upcoming (soonest first). Completed tasks are excluded.
  function maintenanceAlerts(tasks, today, limit) {
    const pending = tasks.filter(t => t.status !== "completed");
    const byDue = (a, b) => a.dueDate.localeCompare(b.dueDate);
    const overdue = pending.filter(t => t.dueDate < today).sort(byDue);
    const upcoming = pending.filter(t => t.dueDate >= today).sort(byDue);
    return overdue.concat(upcoming).slice(0, limit);
  }

  const short = (s, n) => (s.length > n ? s.slice(0, n).trimEnd() + "…" : s);

  // Latest events from real records only. Troubleshooting sessions are not stored anywhere yet, so none appear.
  function buildActivity(d, limit) {
    const ev = [];
    const add = (key, text, appliance) => { const ms = Date.parse(key); if (!Number.isNaN(ms)) ev.push({ ms, text, appliance: appliance || "" }); };
    (d.appliances || []).forEach(a => { if (a.createdAt) add(a.createdAt, "Appliance registered", a.name); });
    (d.repairs || []).forEach(r => add(r.createdAt, "Repair record added: " + short(r.problem || "", 60), r.applianceName));
    (d.quotes || []).forEach(q => add(q.createdAt, "Technician quote added from " + q.businessName, q.applianceName));
    (d.tasks || []).filter(t => t.status === "completed")
      .forEach(t => add(t.updatedAt || (t.completedDate + "T12:00:00"), "Maintenance task completed: " + t.taskName, t.applianceName));
    return ev.sort((a, b) => b.ms - a.ms).slice(0, limit);
  }

  // ---------- UI helpers ----------
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cad = c => RepairVsReplace.cad(c);
  const fmtDay = ds => ds && WarrantyChecker.dateOnly(ds)
    ? new Date(ds + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
  const fmtMs = ms => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const badgeClass = s => ({ "Active": "active", "Expiring Soon": "soon", "Expired": "expired", "Unknown": "unknown", "No Warranty": "no-warranty" }[s] || "unknown");

  const panel = (title, icon, viewAll, body, id) => `
    <section class="dash-panel" id="${id}">
      <div class="panel-head"><h2>${icon} ${esc(title)}</h2>${viewAll ? `<a class="btn btn-sm" href="${viewAll.href}">${esc(viewAll.label)}</a>` : ""}</div>
      ${body}
    </section>`;
  const empty = (text, extra) => `<div class="panel-empty"><p>${text}</p>${extra || ""}</div>`;
  const loadingBox = text => `<div class="panel-empty"><div class="spinner"></div><p>${esc(text)}</p></div>`;

  // Quotes are still browser-local. Reminders and repair records come from the API and are loaded by loadRemote.
  function loadLocal(userId) {
    const out = { tasks: null, repairs: null, quotes: null, errors: {}, loading: { tasks: true, repairs: true } };
    try { out.quotes = QuoteStore.list(userId); } catch (e) { out.errors.quotes = e.message; }
    return out;
  }

  async function loadRemote(root, s) {
    const L = s.local;
    const load = async (key, fn) => {
      try { L[key] = await fn(); L.errors[key] = undefined; } catch (e) { L[key] = null; L.errors[key] = e.message || "Request failed."; }
      L.loading[key] = false;
    };
    await Promise.all([load("tasks", Api.getMaintenanceReminders), load("repairs", Api.getRepairRecords)]);
    if (Navigation.parse().route !== "dashboard" || !root.querySelector("#dashBody")) return; // user moved on
    paint(root, s);
  }

  function paint(root, s) {
    const today = s.today;
    const apps = Array.isArray(s.appliances) ? s.appliances : null;
    const appLoading = s.appliances === undefined;
    const L = s.local;

    // --- overview numbers (each is "—" until it can be calculated from real data) ---
    const wc = apps ? warrantyCounts(apps, today) : null;
    const ms = L.tasks ? MaintenanceScreen.summarize(L.tasks, today) : null;
    const val = (v, loading) => (v !== null && v !== undefined ? v : (loading ? "…" : "—"));
    const cards = [
      { href: "#/appliances", icon: "🔌", label: "Total Appliances", id: "cardTotal", value: val(apps && apps.length, appLoading), sub: "" },
      { href: "#/appliances", icon: "🛡️", label: "Active Warranties", id: "cardActive", value: val(wc && wc.active, appLoading),
        sub: wc && wc.expiringSoon ? wc.expiringSoon + " expiring soon" : "" },
      { href: "#/maintenance?status=Upcoming", icon: "🛠️", label: "Upcoming Maintenance", id: "cardUpcoming", value: val(ms && ms.upcoming, L.loading.tasks), sub: "" },
      { href: "#/maintenance?status=Overdue", icon: "⏰", label: "Overdue Maintenance", id: "cardOverdue", value: val(ms && ms.overdue, L.loading.tasks), sub: "", cls: ms && ms.overdue ? "dash-card-alert" : "" }
    ];
    const cardsHtml = cards.map(c => `
      <a class="dash-card ${c.cls || ""}" href="${c.href}" id="${c.id}">
        <span class="dash-card-icon">${c.icon}</span>
        <span class="dash-card-body"><span class="muted">${esc(c.label)}</span><strong>${esc(c.value)}</strong>
          ${c.sub ? `<small class="muted">${esc(c.sub)}</small>` : ""}</span></a>`).join("");

    // --- appliance status banner ---
    let banner = "";
    if (s.appError) {
      banner = s.appError.code === "not_configured"
        ? `<div class="alert alert-info">The API is not connected yet, so appliance and warranty information can't be shown. See <code>frontend/js/config.js</code>.</div>`
        : `<div class="alert alert-error">Couldn't load your appliances: ${esc(s.appError.message)} <button class="btn btn-sm" id="retryApps">Retry</button></div>`;
    }

    // --- maintenance alerts ---
    let alertsBody;
    if (L.loading.tasks) alertsBody = loadingBox("Loading your maintenance reminders…");
    else if (!L.tasks) alertsBody = empty(`Couldn't load maintenance reminders: ${esc(L.errors.tasks || "unknown error")}`);
    else {
      const items = maintenanceAlerts(L.tasks, today, ALERT_LIMIT);
      alertsBody = items.length ? `<ul class="dash-list">${items.map(t => {
        const overdue = t.dueDate < today;
        const n = daysBetween(today, t.dueDate);
        return `<li class="${overdue ? "row-overdue" : ""}"><div><strong>${esc(t.taskName)}</strong>
          <span class="muted">${esc(t.applianceName || "Unnamed appliance")} · due ${esc(fmtDay(t.dueDate))}</span></div>
          <span class="badge badge-${overdue ? "expired" : "upcoming"}">${overdue ? (-n) + (n === -1 ? " day" : " days") + " overdue" : n === 0 ? "Due today" : "Due in " + n + (n === 1 ? " day" : " days")}</span></li>`;
      }).join("")}</ul>` : empty("You're all caught up! No maintenance reminders right now.");
    }

    // --- warranty overview ---
    let warrantyBody;
    if (appLoading) warrantyBody = loadingBox("Loading your appliances…");
    else if (!apps) warrantyBody = empty("Warranty information isn't available until your appliances can be loaded.");
    else if (!apps.length) warrantyBody = empty("You haven't registered any appliances yet.", '<a class="btn btn-primary btn-sm" href="#/add-appliance">+ Add Appliance</a>');
    else {
      const rows = warrantyRows(apps, today, WARRANTY_LIMIT);
      warrantyBody = `<ul class="dash-list">${rows.map(r => `<li><div><strong>${esc(r.appliance.name || "Unnamed appliance")}</strong>
        <span class="muted">${esc(r.appliance.brand || "Brand not provided")} · ${r.expiry ? "expires " + esc(fmtDay(r.expiry)) : "expiry date not provided"}</span></div>
        <span class="badge badge-${badgeClass(r.status)}">${esc(r.status)}</span></li>`).join("")}</ul>
        <p class="muted panel-note">${esc(WARRANTY_NOTE)}</p>`;
    }

    // --- recent activity ---
    const events = buildActivity({ appliances: apps, repairs: L.repairs, quotes: L.quotes, tasks: L.tasks }, ACTIVITY_LIMIT);
    const activityBody = (events.length
      ? `<ul class="dash-list">${events.map(e => `<li><div><strong>${esc(e.text)}</strong>
          <span class="muted">${e.appliance ? esc(e.appliance) : "No appliance"}</span></div><span class="muted nowrap">${esc(fmtMs(e.ms))}</span></li>`).join("")}</ul>`
      : empty("No activity yet. When you add an appliance, repair record, quote or complete a maintenance task, it will show up here."))
      + `<p class="muted panel-note">Troubleshooting sessions are not saved yet, so they don't appear here.${appLoading ? " Appliance registrations will appear once your appliances load." : ""}</p>`;

    // --- repair spending ---
    let spendBody;
    if (L.loading.repairs) spendBody = loadingBox("Loading your repair records…");
    else if (!L.repairs) spendBody = empty(`Couldn't load repair records: ${esc(L.errors.repairs || "unknown error")}`);
    else if (!L.repairs.length) spendBody = empty("No repair records yet, so there are no expenses to total.", '<a class="btn btn-sm" href="#/repair-history?mode=add">+ Add Repair Record</a>');
    else {
      const sm = RepairHistory.summarize(L.repairs);
      spendBody = `<div class="spend-grid">
        <div><span class="muted">Total recorded repair expenses</span><strong id="spendTotal">${esc(cad(sm.totalCents))}</strong></div>
        <div><span class="muted">Repair records</span><strong id="spendCount">${sm.count}</strong></div></div>
        <p class="muted panel-note">Based on costs entered in Repair History (${sm.withCostCount} of ${sm.count} ${sm.count === 1 ? "record has" : "records have"} a cost). Missing costs are not estimated, and technician quotes are not counted.</p>`;
    }

    root.querySelector("#dashBody").innerHTML = `
      ${banner}
      <div class="dash-cards">${cardsHtml}</div>
      <section class="dash-section"><h2 class="section-title">Quick Actions</h2>
        <div class="quick-actions">
          <a class="quick-btn" href="#/add-appliance" id="qaAdd"><span>➕</span><strong>Add Appliance</strong><small>Register a new appliance</small></a>
          <a class="quick-btn" href="#/appliances" id="qaProblem"><span>⚠️</span><strong>Report a Problem</strong><small>Choose an appliance, then Report a Problem</small></a>
          <a class="quick-btn" href="#/appliances" id="qaWarranty"><span>🛡️</span><strong>Check Warranty</strong><small>Choose an appliance, then Warranty Checker</small></a>
          <a class="quick-btn" href="#/maintenance?mode=add" id="qaMaint"><span>⏰</span><strong>Add Maintenance Reminder</strong><small>Schedule a maintenance task</small></a>
        </div></section>
      <div class="dash-grid">
        ${panel("Maintenance Alerts", "🔔", { href: "#/maintenance", label: "View All" }, alertsBody, "panelAlerts")}
        ${panel("Warranty Overview", "🛡️", { href: "#/appliances", label: "View All" }, warrantyBody, "panelWarranty")}
        ${panel("Recent Activity", "🕘", { href: "#/repair-history", label: "View Repair History" }, activityBody, "panelActivity")}
        ${panel("Repair Spending", "💳", null, spendBody, "panelSpending")}
      </div>`;

    const retry = root.querySelector("#retryApps");
    if (retry) retry.addEventListener("click", () => loadAppliances(root, s));
  }

  async function loadAppliances(root, s) {
    s.appliances = undefined; s.appError = null;
    if (!Auth.isConfigured()) {
      s.appliances = null; s.appError = { code: "not_configured", message: "The API is not configured." };
      paint(root, s); return;
    }
    paint(root, s);
    try {
      s.appliances = (await Api.getAppliances()).map(normalize);
    } catch (e) {
      s.appliances = null; s.appError = { code: e.code || "error", message: e.message || "Request failed." };
    }
    if (Navigation.parse().route !== "dashboard" || !root.querySelector("#dashBody")) return; // user moved on
    paint(root, s);
  }

  // ---------- entry point ----------
  function render(root) {
    const name = Auth.getFirstName();
    const hero = `
      <section class="dash-hero">
        <h1>Welcome back${name ? ", " + esc(name) : ""}!</h1>
        <p class="hero-title">Your Home, Under Control.</p>
        <p class="hero-sub">Keep track of your appliances, maintenance and repairs in one place.</p>
        <p class="hero-tag">Smart Home. Smarter Care.</p>
      </section>`;
    const userId = Auth.getUserId();
    if (!userId) {
      root.innerHTML = hero + `<div class="state-box"><div class="state-icon">🔒</div><h2>Sign-in required</h2>
        <p>Your dashboard is built from your own appliances and records. Login is not implemented yet, so no user could be identified and nothing is shown.</p></div>`;
      return;
    }
    root.innerHTML = hero + '<div id="dashBody"></div>';
    const s = { userId, today: WarrantyChecker.todayString(), local: loadLocal(userId), appliances: undefined, appError: null };
    loadAppliances(root, s);
    loadRemote(root, s);
  }

  return { render, daysBetween, warrantyBucket, warrantyCounts, warrantyRows, maintenanceAlerts, buildActivity, EXPIRING_DAYS };
})();

if (typeof module !== "undefined") module.exports = Dashboard;
