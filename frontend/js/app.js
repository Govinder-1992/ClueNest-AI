// ClueNest AI main app: sidebar, routing and the My Appliances screen.
const contentEl = document.getElementById("content");
const navEl = document.getElementById("nav");

const state = { appliances: [], search: "", type: "", warranty: "" };
let loadId = 0;

// ---------- helpers ----------
function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// Accept several likely field names so the UI works with the existing API shape.
function normalize(a) {
  return {
    id: a.id ?? a.applianceId ?? a.appliance_id,
    name: a.name ?? a.applianceName ?? a.appliance_name ?? "",
    type: a.type ?? a.applianceType ?? a.category ?? "",
    brand: a.brand ?? "",
    model: a.model ?? a.modelNumber ?? a.model_number ?? "",
    purchaseDate: a.purchaseDate ?? a.purchase_date ?? "",
    warrantyExpiry: a.warrantyExpiry ?? a.warrantyExpiryDate ?? a.warranty_expiry ?? a.warranty_expiry_date ?? "",
    createdAt: a.createdAt ?? a.created_at ?? a.registeredAt ?? a.registered_at ?? "",
    warrantyYears: a.warrantyYears ?? a.warrantyDuration ?? a.warranty_years ?? a.warranty_duration ?? null,
    warrantyStart: a.warrantyStart ?? a.warrantyStartDate ?? a.warranty_start ?? a.warranty_start_date ?? "",
    warrantyProvider: a.warrantyProvider ?? a.warranty_provider ?? a.provider ?? "",
    serialNumber: a.serialNumber ?? a.serial_number ?? "",
    storeName: a.storeName ?? a.store_name ?? ""
  };
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function formatDate(s) {
  const d = parseDate(s);
  return d ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Not provided";
}

function warrantyStatus(a) {
  const d = parseDate(a.warrantyExpiry);
  if (!d) return "Unknown";
  const end = new Date(d); end.setHours(23, 59, 59, 999);
  return end >= new Date() ? "Active" : "Expired";
}

function iconFor(a) {
  const t = (a.type + " " + a.name).toLowerCase();
  const map = [
    [/fridge|refrigerat|freezer/, "🧊"], [/wash|laundry/, "🧺"], [/dryer/, "🌀"],
    [/dish/, "🍽️"], [/oven|cooker|stove|hob/, "🍳"], [/microwave/, "📟"],
    [/air.?con|a\/c|heater|heat pump|hvac|fan/, "❄️"], [/tv|television/, "📺"],
    [/vacuum/, "🧹"], [/kettle|toaster|coffee/, "☕"], [/water|boiler/, "🚿"]
  ];
  for (const [re, icon] of map) if (re.test(t)) return icon;
  return "🔌";
}

// ---------- sidebar ----------
function renderNav(active) {
  navEl.innerHTML = Navigation.MENU.map(m =>
    `<a href="#/${m.route}" class="nav-item ${m.route === active ? "active" : ""}">
       <span class="nav-icon">${m.icon}</span>${esc(m.label)}</a>`).join("");
}

function closeMenu() { document.body.classList.remove("menu-open"); }
document.getElementById("menuBtn").addEventListener("click", () => document.body.classList.toggle("menu-open"));
document.getElementById("overlay").addEventListener("click", closeMenu);

// ---------- screens ----------
function renderPlaceholder(title, message, backRoute) {
  contentEl.innerHTML = `
    <div class="page-header"><div><h1>${esc(title)}</h1></div></div>
    <div class="state-box"><div class="state-icon">🚧</div>
      <h2>Coming soon</h2><p>${message}</p>
      ${backRoute ? `<a class="btn" href="#/${backRoute}">Back to My Appliances</a>` : ""}
    </div>`;
}

function renderActionPlaceholder(action, params) {
  const id = params.get("id");
  const a = id ? Navigation.getSelectedAppliance(id) : null;
  const details = a
    ? `<ul class="detail-list">
         <li><b>Appliance ID:</b> ${esc(a.id)}</li>
         <li><b>Name:</b> ${esc(a.name || "Not provided")}</li>
         <li><b>Brand:</b> ${esc(a.brand || "Not provided")}</li>
         <li><b>Model:</b> ${esc(a.model || "Not provided")}</li>
         <li><b>Purchase date:</b> ${esc(formatDate(a.purchaseDate))}</li>
         <li><b>Warranty expiry:</b> ${esc(formatDate(a.warrantyExpiry))}</li>
       </ul>`
    : `<p class="muted">${id ? "Appliance ID: " + esc(id) : "No appliance selected."}</p>`;
  const wc = id ? Navigation.getWarrantyContext(id) : null;
  const warrantyDecision = wc
    ? `<h2>Warranty</h2><ul class="detail-list">
         <li><b>Warranty status:</b> ${esc(wc.status)}</li>
         <li><b>Warranty decision:</b> ${esc(wc.decision)}</li>
         ${wc.response ? `<li><b>Warranty response:</b> ${esc(wc.response)}</li>` : ""}</ul>`
    : "";
  const tc = id ? Navigation.getTechnicianContext(id) : null;
  const technicianInfo = tc
    ? `<h2>Selected technician</h2><ul class="detail-list">
         <li><b>Business:</b> ${esc(tc.business.name)}</li>
         ${tc.business.address ? `<li><b>Address:</b> ${esc(tc.business.address)}</li>` : ""}
         ${tc.business.phone ? `<li><b>Phone:</b> ${esc(tc.business.phone)}</li>` : ""}
         ${tc.business.website ? `<li><b>Website:</b> ${esc(tc.business.website)}</li>` : ""}
         ${tc.business.rating != null ? `<li><b>Google rating:</b> ${esc(tc.business.rating)}${tc.business.reviewCount != null ? " (" + esc(tc.business.reviewCount) + " reviews)" : ""}</li>` : ""}
         <li><b>Problem:</b> ${esc(tc.problem)}</li></ul>`
    : "";
  const rc = id ? Navigation.getRepairContext(id) : null;
  const money = n => Number(n).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
  const repairInfo = rc
    ? `<h2>Repair vs Replace</h2><ul class="detail-list">
         <li><b>Decision:</b> ${esc(rc.decision)}</li>
         <li><b>Estimated repair cost:</b> ${esc(money(rc.estimatedRepairCost))}</li>
         <li><b>Estimated replacement cost:</b> ${esc(money(rc.estimatedReplacementCost))}</li>
         <li><b>Result:</b> ${esc(rc.recommendation)}</li></ul>`
    : "";
  const pc = id ? Navigation.getProblemContext(id) : null;
  const problem = pc
    ? `<h2>Reported problem</h2><ul class="detail-list">
         <li><b>Category:</b> ${esc(pc.category)}</li>
         ${pc.errorCode ? `<li><b>Error code:</b> ${esc(pc.errorCode)}</li>` : ""}
         ${pc.description ? `<li><b>Description:</b> ${esc(pc.description)}</li>` : ""}</ul>`
    : "";
  contentEl.innerHTML = `
    <div class="page-header"><div><h1>${esc(action.label)}</h1>
      <p class="subtitle">This screen has not been built yet.</p></div></div>
    <div class="state-box left"><h2>Selected appliance</h2>${details}${problem}${warrantyDecision}${repairInfo}${technicianInfo}
      <a class="btn" href="#/appliances">Back to My Appliances</a></div>`;
}

function renderAppliancesShell() {
  contentEl.innerHTML = `
    <div class="page-header">
      <div><h1>My Appliances</h1>
        <p class="subtitle">Manage all your registered home appliances.</p></div>
      <a class="btn btn-primary" href="#/add-appliance">+ Add Appliance</a>
    </div>
    <div class="filters">
      <input id="search" type="search" placeholder="Search by name, brand or model" aria-label="Search appliances" value="${esc(state.search)}" />
      <select id="typeFilter" aria-label="Filter by appliance type"></select>
      <select id="warrantyFilter" aria-label="Filter by warranty status">
        <option value="">All warranty statuses</option>
        <option>Active</option><option>Expired</option><option>Unknown</option>
      </select>
    </div>
    <div id="list"></div>`;
  document.getElementById("warrantyFilter").value = state.warranty;
  document.getElementById("search").addEventListener("input", e => { state.search = e.target.value; renderList(); });
  document.getElementById("typeFilter").addEventListener("change", e => { state.type = e.target.value; renderList(); });
  document.getElementById("warrantyFilter").addEventListener("change", e => { state.warranty = e.target.value; renderList(); });
}

function setList(html) {
  const el = document.getElementById("list");
  if (el) el.innerHTML = html;
}

function stateBox(icon, title, text, extra) {
  return `<div class="state-box"><div class="state-icon">${icon}</div><h2>${esc(title)}</h2>
          <p>${text}</p>${extra || ""}</div>`;
}

function fillTypeFilter() {
  const types = [...new Set(state.appliances.map(a => a.type).filter(Boolean))].sort();
  if (state.type && !types.includes(state.type)) state.type = "";
  const sel = document.getElementById("typeFilter");
  sel.innerHTML = `<option value="">All types</option>` +
    types.map(t => `<option value="${esc(t)}" ${t === state.type ? "selected" : ""}>${esc(t)}</option>`).join("");
}

// The six action buttons on each appliance card. Every button opens an existing screen for that appliance.
// "tone" only selects a colour (see .action-* in css/theme.css).
const CARD_ACTIONS = [
  { route: "report-problem", label: "Report a Problem", icon: "⚠️", tone: "blue" },
  { route: "warranty-checker", label: "Warranty Checker", icon: "🛡️", tone: "cyan" },
  { route: "repair-vs-replace", label: "Repair vs Replace", icon: "⚖️", tone: "purple" },
  { route: "maintenance-reminder", label: "Maintenance Reminder", icon: "⏰", tone: "green" },
  { route: "find-technician", label: "Find Technician", icon: "👨‍🔧", tone: "orange" },
  { route: "repair-history", label: "Repair History", icon: "🔧", tone: "indigo" }
];
function cardHtml(a) {
  const status = warrantyStatus(a);
  const actions = CARD_ACTIONS.map(act =>
    `<button class="action action-${act.tone}" data-route="${act.route}" data-id="${esc(a.id)}">
       <span class="action-icon" aria-hidden="true">${act.icon}</span>
       <span class="action-label">${esc(act.label)}</span>
       <span class="action-arrow" aria-hidden="true">→</span></button>`).join("");
  return `
    <article class="card">
      <div class="card-head">
        <div class="appliance-icon">${iconFor(a)}</div>
        <div class="card-title"><h3>${esc(a.name || "Unnamed appliance")}</h3>
          ${a.type ? `<span class="muted">${esc(a.type)}</span>` : ""}</div>
        <span class="badge badge-${status.toLowerCase()}">${status}</span>
      </div>
      <dl class="meta">
        <div><dt>Brand</dt><dd>${esc(a.brand || "Not provided")}</dd></div>
        <div><dt>Model</dt><dd>${esc(a.model || "Not provided")}</dd></div>
        <div><dt>Purchased</dt><dd>${esc(formatDate(a.purchaseDate))}</dd></div>
        <div><dt>Warranty expires</dt><dd>${esc(formatDate(a.warrantyExpiry))}</dd></div>
      </dl>
      <div class="actions">${actions}</div>
    </article>`;
}

function renderList() {
  const q = state.search.trim().toLowerCase();
  const filtered = state.appliances.filter(a =>
    (!q || [a.name, a.brand, a.model].some(v => String(v).toLowerCase().includes(q))) &&
    (!state.type || a.type === state.type) &&
    (!state.warranty || warrantyStatus(a) === state.warranty));

  if (!state.appliances.length) {
    setList(stateBox("📦", "No appliances yet", "You haven't registered any appliances.",
      `<a class="btn btn-primary" href="#/add-appliance">+ Add Appliance</a>`));
    return;
  }
  if (!filtered.length) {
    setList(stateBox("🔍", "No matches", "No appliances match your search or filters."));
    return;
  }
  setList(`<div class="grid">${filtered.map(cardHtml).join("")}</div>`);
  document.querySelectorAll(".action").forEach(btn => btn.addEventListener("click", () => {
    const a = state.appliances.find(x => String(x.id) === btn.dataset.id);
    if (a) Navigation.selectAppliance(a);
    Navigation.go(btn.dataset.route, btn.dataset.id);
  }));
}

async function showAppliances() {
  renderAppliancesShell();
  fillTypeFilter();
  const me = ++loadId;

  if (!Auth.isConfigured()) {
    setList(stateBox("🔧", "API not connected",
      "The API URL and Cognito settings are not configured yet. Edit <code>frontend/js/config.js</code> and implement login in <code>frontend/js/auth.js</code>. No data is shown until then."));
    return;
  }
  if (!Auth.isAuthenticated()) {
    setList(stateBox("🔒", "Sign-in required",
      "Login is not implemented yet. An authentication token is needed to load your appliances."));
    return;
  }

  setList(`<div class="state-box"><div class="spinner"></div><p>Loading your appliances…</p></div>`);
  try {
    const data = await Api.getAppliances();
    if (me !== loadId) return;
    state.appliances = data.map(normalize);
    fillTypeFilter();
    renderList();
  } catch (e) {
    if (me !== loadId) return;
    setList(stateBox("⚠️", "Couldn't load appliances", esc(e.message),
      `<button class="btn" id="retry">Try again</button>`));
    document.getElementById("retry").addEventListener("click", showAppliances);
  }
}

// ---------- sign-in screen ----------
// Shown instead of every other screen while the app is configured and nobody is signed in.
function renderSignIn() {
  Landing.render(contentEl, { notice: Auth.getNotice() });
  const go = (fn) => async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try { await fn(); } catch (e) {
      btn.disabled = false;
      document.getElementById("signInError").textContent = "Sign-in could not be started. Please try again.";
    }
  };
  contentEl.querySelectorAll(".js-signin").forEach(b => b.addEventListener("click", go(() => Auth.login())));
  contentEl.querySelectorAll(".js-signup").forEach(b => b.addEventListener("click", go(() => Auth.signUp())));
}
// ---------- router ----------
function route() {
  const { route: r, params } = Navigation.parse();
  closeMenu();
  const signedOut = Auth.isConfigured() && !Auth.isAuthenticated();
  document.body.classList.toggle("landing", signedOut); // the public landing page has its own header
  if (signedOut) { renderSignIn(); return; }
  const action = Navigation.ACTIONS.find(a => a.route === r);
  const menu = Navigation.MENU.find(m => m.route === r);
  renderNav(action || r === "add-appliance" || r === "register-replacement" ? "appliances" : r);
  window.scrollTo(0, 0);

  if (r === "dashboard") Dashboard.render(contentEl);
  else if (r === "appliances") showAppliances();
  else if (r === "add-appliance") AddAppliance.render(contentEl);
  else if (r === "report-problem") Troubleshoot.render(contentEl, params);
  else if (r === "warranty-checker") WarrantyChecker.render(contentEl, params);
  else if (r === "repair-vs-replace") RepairVsReplace.render(contentEl, params);
  else if (r === "find-technician") FindTechnician.render(contentEl, params);
  else if (r === "maintenance") MaintenanceScreen.render(contentEl, params);
  else if (r === "repair-history") RepairHistory.render(contentEl, params);
  else if (r === "settings") SettingsScreen.render(contentEl);
  else if (r === "help") HelpScreen.render(contentEl);
  else if (r === "maintenance-reminder") MaintenanceScreen.render(contentEl, params, true);
  else if (r === "technician-quotes") TechnicianQuotes.render(contentEl, params);
  else if (r === "register-replacement") renderActionPlaceholder({ label: "Register Replacement Appliance" }, params);
  else if (action) renderActionPlaceholder(action, params);
  else if (menu) renderPlaceholder(menu.label, "This screen will be built in a later step.");
  else { location.hash = "#/dashboard"; }
}

window.addEventListener("hashchange", route);
Auth.onSignInNeeded(route);
if (Auth.hasCallback()) {
  // Back from Cognito: finish the sign-in, then show the screen the user came from.
  contentEl.innerHTML = `<div class="state-box"><div class="spinner"></div><p>Signing you in\u2026</p></div>`;
  Auth.handleCallback().then(route, route);
} else {
  route();
}
