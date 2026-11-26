// Repair History screen: list, details, add/edit form, filters.
// Records are saved through the ClueNest API (GET/POST /repair-history, PUT/DELETE /repair-history/{id}); appliances come from GET /appliances.
const RepairHistory = (() => {
  const STATUSES = [
    { value: "completed", label: "Completed", badge: "active", outcome: "The repair was completed." },
    { value: "in_progress", label: "In Progress", badge: "upcoming", outcome: "The repair is still in progress." },
    { value: "not_repaired", label: "Not Repaired", badge: "expired", outcome: "The appliance was not repaired." },
    { value: "cancelled", label: "Cancelled", badge: "unknown", outcome: "The repair was cancelled." }
  ];
  const MAX = { text: 1000, company: 100 };
  const SUB = "Track past appliance problems, repairs and expenses in one place.";
  const NOTE_SNIPPET = 120;

  const ui = { search: "", appliance: "", status: "", sort: "newest", from: "", to: "", flash: "" };

  // ---------- pure logic (also used by tests) ----------
  const statusInfo = v => STATUSES.find(s => s.value === v);

  function validate(raw, today, purchaseDate) {
    today = today || WarrantyChecker.todayString();
    const errors = {}, v = {};
    const t = k => String(raw[k] == null ? "" : raw[k]).trim();

    v.applianceId = t("applianceId");
    if (!v.applianceId) errors.applianceId = "Select an appliance.";

    v.problem = t("problem");
    if (!v.problem) errors.problem = "Describe the problem that was reported.";
    else if (v.problem.length > MAX.text) errors.problem = "Keep the description under " + MAX.text + " characters.";

    v.repairDate = t("repairDate");
    if (!v.repairDate) errors.repairDate = "Enter the repair date.";
    else if (!WarrantyChecker.dateOnly(v.repairDate) || v.repairDate.length !== 10) errors.repairDate = "Enter a valid date.";
    else if (v.repairDate > today) errors.repairDate = "The repair date cannot be in the future.";
    else if (v.repairDate < (Number(today.slice(0, 4)) - 50) + today.slice(4)) errors.repairDate = "The repair date is too far in the past.";
    else {
      const p = WarrantyChecker.dateOnly(purchaseDate || "");
      if (p && v.repairDate < p) errors.repairDate = "The repair date is before the appliance's purchase date.";
    }

    v.status = t("status");
    if (!v.status) errors.status = "Select the repair status.";
    else if (!statusInfo(v.status)) errors.status = "Choose a status from the list.";

    v.company = t("company");
    if (v.company.length > MAX.company) errors.company = "Keep the name under " + MAX.company + " characters.";

    ["cost", "additional"].forEach(k => {
      if (t(k) === "") { v[k] = null; return; }
      const r = RepairVsReplace.parseMoney(t(k), false);
      if (r.error) errors[k] = r.error; else v[k] = r.cents;
    });

    v.notes = t("notes");
    if (v.notes.length > MAX.text) errors.notes = "Keep the notes under " + MAX.text + " characters.";
    return { errors, values: v };
  }

  // The request body for POST/PUT /repair-history. The server adds the ID, the appliance snapshot and the timestamps.
  function buildPayload(v) {
    return {
      applianceId: v.applianceId, problem: v.problem, repairDate: v.repairDate, status: v.status,
      company: v.company, costCents: v.cost, additionalCents: v.additional, notes: v.notes
    };
  }

  const totalCost = r => (typeof r.costCents === "number" || typeof r.additionalCents === "number")
    ? (r.costCents || 0) + (r.additionalCents || 0) : null;

  // Appliances Repaired = distinct appliances that have at least one Completed record.
  function summarize(records) {
    let total = 0, withCost = 0;
    records.forEach(r => { const c = totalCost(r); if (c !== null) { total += c; withCost++; } });
    return {
      count: records.length, totalCents: total, withCostCount: withCost,
      appliancesRepaired: new Set(records.filter(r => r.status === "completed").map(r => r.applianceId)).size
    };
  }

  function dateRangeError(from, to) {
    return from && to && from > to ? "The start date must be on or before the end date." : "";
  }

  function filterSort(records, f) {
    const q = String(f.search || "").trim().toLowerCase();
    const rangeOk = !dateRangeError(f.from, f.to);
    const out = records.filter(r =>
      (!q || String(r.applianceName).toLowerCase().includes(q) || String(r.problem).toLowerCase().includes(q)) &&
      (!f.appliance || r.applianceId === f.appliance) &&
      (!f.status || r.status === f.status) &&
      (!rangeOk || ((!f.from || r.repairDate >= f.from) && (!f.to || r.repairDate <= f.to))));
    const dir = f.sort === "oldest" ? 1 : -1;
    out.sort((a, b) => dir * (a.repairDate.localeCompare(b.repairDate) || (a.createdAt || "").localeCompare(b.createdAt || "")));
    return out;
  }

  // ---------- UI helpers ----------
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cad = c => RepairVsReplace.cad(c);
  const fmtDate = ds => ds && WarrantyChecker.dateOnly(ds)
    ? new Date(ds + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
  const row = (l, v, wide) => `<div${wide ? ' style="grid-column:1/-1"' : ""}><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`;
  const bm = r => [r.applianceBrand, r.applianceModel].filter(Boolean).join(" ");
  const applianceLabel = a => [a.name || "Unnamed appliance", [a.brand, a.model].filter(Boolean).join(" ")].filter(Boolean).join(" - ");
  const badge = s => { const i = statusInfo(s); return `<span class="badge badge-${i ? i.badge : "unknown"}">${esc(i ? i.label : "Unknown")}</span>`; };
  const snippet = s => (s.length > NOTE_SNIPPET ? s.slice(0, NOTE_SNIPPET).trimEnd() + "…" : s);

  function shell(root, title, subtitle, body, back, showAdd) {
    root.innerHTML = `
      ${back ? `<a class="back-link" href="${back.href}">${esc(back.label)}</a>` : ""}
      <div class="page-header"><div><h1>${esc(title)}</h1><p class="subtitle">${esc(subtitle)}</p></div>
        ${showAdd ? '<a class="btn btn-primary" href="#/repair-history?mode=add" id="addTop">+ Add Repair Record</a>' : ""}
      </div>${body}`;
  }

  function notice(icon, title, text, extra) {
    return `<div class="state-box"><div class="state-icon">${icon}</div><h2>${esc(title)}</h2><p>${esc(text)}</p>${extra || ""}</div>`;
  }

  const LIST_BACK = { href: "#/repair-history", label: "← Back to Repair History" };

  const loadingBox = text => `<div class="state-box"><div class="spinner"></div><p>${esc(text)}</p></div>`;

  // Deleting removes only the repair record. Appliances and other data are never touched.
  async function deleteRecord(r) {
    if (!window.confirm('Delete this repair record for "' + (r.applianceName || "this appliance") + '"? This cannot be undone. The appliance itself is not deleted.')) return false;
    await Api.deleteRepairRecord(r.id);
    return true;
  }

  // ---------- list ----------
  function recordCard(r) {
    const total = totalCost(r);
    return `
      <article class="card repair-card" data-id="${esc(r.id)}">
        <div class="card-head">
          <div class="appliance-icon">🧰</div>
          <div class="card-title"><h3>${esc(r.applianceName || "Unnamed appliance")}</h3>
            ${bm(r) ? `<span class="muted">${esc(bm(r))}</span>` : ""}</div>
          ${badge(r.status)}
        </div>
        <dl class="meta">
          ${row("Problem reported", r.problem, true)}
          ${row("Repair date", fmtDate(r.repairDate))}
          ${r.company ? row("Technician / company", r.company) : ""}
          ${total !== null ? row("Total cost", cad(total)) : ""}
          ${r.notes ? row("Notes", snippet(r.notes), true) : ""}
        </dl>
        <div class="biz-actions">
          <button class="btn" data-act="view">View Details</button>
          <button class="btn" data-act="edit">Edit</button>
          <button class="btn btn-warn" data-act="delete">Delete</button>
        </div>
      </article>`;
  }

  async function renderList(root, userId) {
    const myHash = location.hash;
    shell(root, "Repair History", SUB, loadingBox("Loading your repair history…"), null, false);
    let records;
    try { records = await Api.getRepairRecords(); }
    catch (e) {
      if (location.hash !== myHash) return;
      shell(root, "Repair History", SUB, notice("⚠️", "Couldn't load repair history", e.message,
        '<button class="btn" id="retryList">Retry</button>'), null, false);
      root.querySelector("#retryList").addEventListener("click", () => renderList(root, userId));
      return;
    }
    if (location.hash !== myHash) return;
    const sum = summarize(records);
    const apps = [...new Map(records.map(r => [r.applianceId, r.applianceName || "Unnamed appliance"])).entries()];
    if (ui.appliance && !apps.some(a => a[0] === ui.appliance)) ui.appliance = "";
    const flash = ui.flash ? `<div class="alert alert-success" role="status">${esc(ui.flash)}</div>` : "";
    ui.flash = "";

    const costNote = records.length && sum.withCostCount < records.length
      ? `<small class="muted">${sum.withCostCount} of ${records.length} ${records.length === 1 ? "record has" : "records have"} a cost recorded</small>` : "";

    const body = `
      ${flash}
      <div class="summary-grid">
        <div class="summary-card"><span class="muted">Total Repair Records</span><strong id="sumCount">${sum.count}</strong></div>
        <div class="summary-card"><span class="muted">Total Repair Expenses</span><strong id="sumExpenses">${esc(cad(sum.totalCents))}</strong>${costNote}</div>
        <div class="summary-card"><span class="muted">Appliances Repaired</span><strong id="sumAppliances">${sum.appliancesRepaired}</strong>
          <small class="muted">with a completed repair</small></div>
      </div>
      ${records.length ? `
      <div class="filters">
        <input id="hSearch" type="search" placeholder="Search by appliance or problem" aria-label="Search repair history" value="${esc(ui.search)}" />
        <select id="hAppliance" aria-label="Filter by appliance"><option value="">All appliances</option>
          ${apps.map(a => `<option value="${esc(a[0])}" ${a[0] === ui.appliance ? "selected" : ""}>${esc(a[1])}</option>`).join("")}</select>
        <select id="hStatus" aria-label="Filter by status"><option value="">All statuses</option>
          ${STATUSES.map(s => `<option value="${s.value}" ${s.value === ui.status ? "selected" : ""}>${s.label}</option>`).join("")}</select>
        <select id="hSort" aria-label="Sort records">
          <option value="newest" ${ui.sort === "newest" ? "selected" : ""}>Newest first</option>
          <option value="oldest" ${ui.sort === "oldest" ? "selected" : ""}>Oldest first</option></select>
      </div>
      <div class="filters date-range">
        <label>From <input id="hFrom" type="date" value="${esc(ui.from)}" /></label>
        <label>To <input id="hTo" type="date" value="${esc(ui.to)}" /></label>
        <button class="btn" id="hClear" type="button">Clear filters</button>
      </div>
      <div class="field-error" id="rangeError" role="alert"></div>
      <div id="recordList"></div>` : notice("🧰", "No repair history yet",
        "When an appliance is repaired, add a record here to keep track of the problem, the repair and what it cost.",
        '<a class="btn btn-primary" href="#/repair-history?mode=add">+ Add Repair Record</a>')}`;
    shell(root, "Repair History", SUB, body, null, true);
    if (!records.length) return;

    const $ = s => root.querySelector(s);
    function paint() {
      const err = dateRangeError(ui.from, ui.to);
      $("#rangeError").textContent = err;
      const shown = filterSort(records, ui);
      $("#recordList").innerHTML = shown.length
        ? `<div class="grid repair-grid">${shown.map(recordCard).join("")}</div>`
        : notice("🔍", "No matching records", "No repair records match your search or filters.");
    }
    const bind = (id, ev, key) => $(id).addEventListener(ev, e => { ui[key] = e.target.value; paint(); });
    bind("#hSearch", "input", "search"); bind("#hAppliance", "change", "appliance"); bind("#hStatus", "change", "status");
    bind("#hSort", "change", "sort"); bind("#hFrom", "change", "from"); bind("#hTo", "change", "to");
    $("#hClear").addEventListener("click", () => {
      Object.assign(ui, { search: "", appliance: "", status: "", sort: "newest", from: "", to: "" });
      renderList(root, userId);
    });

    $("#recordList").addEventListener("click", e => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const r = records.find(x => x.id === btn.closest(".repair-card").dataset.id);
      if (!r) return;
      if (btn.dataset.act === "view") location.hash = "#/repair-history?view=" + encodeURIComponent(r.id);
      else if (btn.dataset.act === "edit") location.hash = "#/repair-history?mode=edit&record=" + encodeURIComponent(r.id);
      else if (btn.dataset.act === "delete") {
        deleteRecord(r).then(done => {
          if (!done) return;
          ui.flash = "The repair record was deleted.";
          renderList(root, userId);
        }).catch(err => window.alert(err.message));
      }
    });
    paint();
  }

  // ---------- details ----------
  async function renderDetail(root, userId, id) {
    const myHash = location.hash;
    shell(root, "Repair Details", SUB, loadingBox("Loading the repair record…"), LIST_BACK);
    let r;
    try { r = (await Api.getRepairRecords()).find(x => x.id === id) || null; }
    catch (e) {
      if (location.hash !== myHash) return;
      shell(root, "Repair Details", SUB, notice("⚠️", "Couldn't load the record", e.message,
        '<button class="btn" id="retryD">Retry</button>'), LIST_BACK);
      root.querySelector("#retryD").addEventListener("click", () => renderDetail(root, userId, id));
      return;
    }
    if (location.hash !== myHash) return;
    if (!r) { shell(root, "Repair Details", SUB, notice("🔍", "Record not found", "That repair record no longer exists.",
      '<a class="btn" href="#/repair-history">Back to Repair History</a>'), LIST_BACK); return; }

    const total = totalCost(r);
    const info = statusInfo(r.status);
    const section = (title, rows) => rows.length ? `<section class="result-block"><h2>${esc(title)}</h2><dl class="meta">${rows.join("")}</dl></section>` : "";
    const body = `
      ${section("Appliance Information", [row("Appliance", r.applianceName || "Unnamed appliance"),
        r.applianceBrand ? row("Brand", r.applianceBrand) : "", r.applianceModel ? row("Model", r.applianceModel) : "",
        r.applianceType ? row("Type", r.applianceType) : ""].filter(Boolean))}
      ${section("Original Reported Problem", [row("Problem", r.problem, true)])}
      ${r.troubleshootingOutcome ? section("AI Troubleshooting Outcome", [row("Outcome", r.troubleshootingOutcome, true)]) : ""}
      ${r.company ? section("Technician Information", [row("Technician / company", r.company)]) : ""}
      ${section("Repair Details", [row("Repair date", fmtDate(r.repairDate)), row("Status", info ? info.label : "Unknown"),
        typeof r.costCents === "number" ? row("Repair cost", cad(r.costCents)) : "",
        typeof r.additionalCents === "number" ? row("Additional expenses", cad(r.additionalCents)) : "",
        total !== null ? row("Total cost", cad(total)) : ""].filter(Boolean))}
      ${r.notes ? section("Repair Notes", [row("Notes", r.notes, true)]) : ""}
      ${section("Final Outcome", [row("Outcome", info ? info.outcome : "Not recorded", true)])}
      <p class="muted">Saved ${esc(new Date(r.createdAt).toLocaleString())}${r.updatedAt && r.updatedAt !== r.createdAt ? ". Last edited " + esc(new Date(r.updatedAt).toLocaleString()) : ""}</p>
      <div class="biz-actions detail-actions">
        <a class="btn" href="#/repair-history" id="backBtn">Back to Repair History</a>
        <button class="btn" id="editBtn">Edit</button>
        <button class="btn btn-warn" id="deleteBtn">Delete</button>
      </div>`;
    shell(root, "Repair Details", SUB, body, LIST_BACK);
    root.querySelector("#editBtn").addEventListener("click", () => { location.hash = "#/repair-history?mode=edit&record=" + encodeURIComponent(r.id); });
    root.querySelector("#deleteBtn").addEventListener("click", () => {
      deleteRecord(r).then(done => {
        if (!done) return;
        ui.flash = "The repair record was deleted.";
        Navigation.go("repair-history");
      }).catch(err => window.alert(err.message));
    });
  }

  // ---------- add / edit form ----------
  const FIELDS = ["applianceId", "problem", "repairDate", "status", "company", "cost", "additional", "notes"];

  async function renderForm(root, params, userId) {
    const editId = params.get("mode") === "edit" ? params.get("record") : null;
    const preId = params.get("id");
    // Opened from a technician card in Find Technician: this records a completed repair for that appliance.
    const fromTech = !editId && Boolean(preId) && params.get("from") === "technician";
    const title = editId ? "Edit Repair Record" : fromTech ? "Record Completed Repair" : "Add Repair Record";
    const saveLabel = editId ? "Save Changes" : fromTech ? "Save Repair" : "Save Record";
    const myHash = location.hash;

    let existing = null;
    if (editId) {
      shell(root, title, SUB, loadingBox("Loading the repair record…"), LIST_BACK);
      try { existing = (await Api.getRepairRecords()).find(r => r.id === editId) || null; }
      catch (e) {
        if (location.hash !== myHash) return;
        shell(root, title, SUB, notice("⚠️", "Couldn't load the record", e.message,
          '<button class="btn" id="retryRec">Retry</button>'), LIST_BACK);
        root.querySelector("#retryRec").addEventListener("click", () => renderForm(root, params, userId));
        return;
      }
      if (location.hash !== myHash) return;
      if (!existing) { shell(root, title, SUB, notice("🔍", "Record not found", "That repair record no longer exists.",
        '<a class="btn" href="#/repair-history">Back to Repair History</a>'), LIST_BACK); return; }
    }

    shell(root, title, SUB, `<div class="state-box"><div class="spinner"></div><p>Loading your appliances…</p></div>`, LIST_BACK);
    let appliances;
    try { appliances = (await Api.getAppliances()).map(normalize); }
    catch (e) {
      if (location.hash !== myHash) return;
      shell(root, title, SUB, notice("⚠️", "Couldn't load your appliances", e.message,
        '<button class="btn" id="retryApps">Retry</button>'), LIST_BACK);
      root.querySelector("#retryApps").addEventListener("click", () => renderForm(root, params, userId));
      return;
    }
    if (location.hash !== myHash) return;
    if (!appliances.length) {
      shell(root, title, SUB, notice("📦", "No appliances yet", "Register an appliance first, then add repair records for it.",
        '<a class="btn btn-primary" href="#/add-appliance">+ Add Appliance</a>'), LIST_BACK);
      return;
    }

    const opts = appliances.map(a => ({ id: String(a.id), label: applianceLabel(a), a }));
    if (existing && !opts.some(o => o.id === String(existing.applianceId))) {
      const snap = { id: existing.applianceId, name: existing.applianceName, brand: existing.applianceBrand, model: existing.applianceModel, type: existing.applianceType };
      opts.push({ id: String(existing.applianceId), label: applianceLabel(snap) + " (no longer in your list)", a: snap });
    }

    // For a new record opened for a specific appliance, reuse the problem the user already described
    // during troubleshooting (their own words; no AI output is copied).
    const pc = !existing && preId ? Navigation.getProblemContext(preId) : null;
    const prefillProblem = pc ? [pc.category, pc.errorCode ? "Error code " + pc.errorCode : "", pc.description].filter(Boolean).join(" - ") : "";
    const cents = c => (typeof c === "number" ? (c / 100).toFixed(2) : "");
    const tc = fromTech ? Navigation.getTechnicianContext(preId) : null;
    const techName = tc && tc.business && tc.business.name ? String(tc.business.name).slice(0, MAX.company) : "";
    const init = existing ? { applianceId: existing.applianceId, problem: existing.problem, repairDate: existing.repairDate, status: existing.status,
        company: existing.company, cost: cents(existing.costCents), additional: cents(existing.additionalCents), notes: existing.notes }
      : fromTech ? { applianceId: preId, problem: prefillProblem, repairDate: WarrantyChecker.todayString(), status: "completed",
        company: techName, cost: "", additional: "", notes: "" }
      : { applianceId: preId || "", problem: prefillProblem, repairDate: "", status: "", company: "", cost: "", additional: "", notes: "" };

    const field = (id, label, control, required, hint) => `<div class="form-field">
      <label for="${id}">${esc(label)}${required ? ' <span class="req">*</span>' : " (optional)"}</label>${control}
      ${hint ? `<small class="muted">${esc(hint)}</small>` : ""}<div class="field-error" id="err-${id}" role="alert"></div></div>`;
    const moneyField = (id, label) => field(id, label, `<div class="money"><span class="money-prefix">CAD $</span>
      <input id="${id}" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" /></div>`, false);

    const flowBanner = fromTech ? `<div class="alert alert-info" id="flowBanner">Recording a completed repair${techName ? " by " + esc(techName) : ""}.
      Check the details below and enter the repair date, cost and notes. After you save, you can schedule the next maintenance.</div>` : "";
    shell(root, title, SUB, `
      ${flowBanner}
      <div id="formMessage" role="status"></div>
      <form id="rForm" class="form-card" novalidate>
        <fieldset><legend>Appliance and Problem</legend><div class="form-grid">
          ${field("applianceId", "Select Appliance", `<select id="applianceId"><option value="">Select appliance</option>
            ${opts.map(o => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join("")}</select>`, true)}
          <div class="form-field"><label>Brand and model</label><div class="readonly-box" id="applianceInfo">Select an appliance</div></div>
          <div class="form-field" style="grid-column:1/-1"><label for="problem">Problem Description <span class="req">*</span></label>
            <textarea id="problem" rows="3" maxlength="${MAX.text}"></textarea><div class="field-error" id="err-problem" role="alert"></div></div>
        </div></fieldset>
        <fieldset><legend>Repair</legend><div class="form-grid">
          ${field("repairDate", "Repair Date", `<input id="repairDate" type="date" max="${WarrantyChecker.todayString()}" />`, true)}
          ${field("status", "Repair Status", `<select id="status"><option value="">Select status</option>
            ${STATUSES.map(s => `<option value="${s.value}">${s.label}</option>`).join("")}</select>`, true,
            fromTech ? "This repair is recorded as completed." : "")}
          ${field("company", "Technician or Company Name", `<input id="company" maxlength="${MAX.company}" autocomplete="off" />`, false)}
          <div></div>
          ${moneyField("cost", "Repair Cost")}
          ${moneyField("additional", "Additional Expenses")}
          <div class="form-field" style="grid-column:1/-1"><label for="notes">Repair Notes (optional)</label>
            <textarea id="notes" rows="3" maxlength="${MAX.text}"></textarea><div class="field-error" id="err-notes" role="alert"></div></div>
        </div></fieldset>
        <div class="form-actions"><a class="btn" href="#/repair-history" id="cancelBtn">Cancel</a>
          <button type="submit" class="btn btn-primary" id="saveBtn">${saveLabel}</button></div>
      </form>`, LIST_BACK);

    const $ = s => root.querySelector(s);
    FIELDS.forEach(f => { $("#" + f).value = init[f] == null ? "" : init[f]; });
    if (!opts.some(o => o.id === $("#applianceId").value)) $("#applianceId").value = "";
    if (fromTech) $("#status").disabled = true; // a recorded completed repair always has the Completed status
    const selected = () => opts.find(o => o.id === $("#applianceId").value);
    const refresh = () => {
      const o = selected();
      $("#applianceInfo").textContent = o ? ([o.a.brand, o.a.model].filter(Boolean).join(" · ") || "Brand and model not provided") : "Select an appliance";
    };
    $("#applianceId").addEventListener("change", refresh);
    refresh();

    let saving = false;
    let savedId = null; // set once the server has accepted the new record, so it can never be created twice
    $("#rForm").addEventListener("submit", async e => {
      e.preventDefault();
      if (saving || savedId) return;
      $("#formMessage").innerHTML = "";
      const raw = Object.fromEntries(FIELDS.map(f => [f, $("#" + f).value]));
      const sel = selected();
      const { errors, values } = validate(raw, null, sel && sel.a.purchaseDate);
      FIELDS.forEach(f => {
        const el = $("#err-" + f); if (el) el.textContent = errors[f] || "";
        $("#" + f).classList.toggle("invalid", Boolean(errors[f]));
      });
      const first = FIELDS.find(f => errors[f]);
      if (first) { $("#" + first).focus(); return; }

      saving = true;
      $("#saveBtn").disabled = true; $("#saveBtn").textContent = "Saving…";
      try {
        const payload = buildPayload(values);
        const rec = existing ? await Api.updateRepairRecord(existing.id, payload) : await Api.createRepairRecord(payload);
        savedId = (rec && rec.id) || existing && existing.id || "saved";
        if (fromTech && values.status === "completed") {
          // Only a repair recorded from Find Technician continues to Maintenance & Reminders for the same appliance.
          try {
            Navigation.setRepairCompletedContext({ applianceId: values.applianceId, repairId: rec && rec.id || "",
              repairDate: values.repairDate, company: values.company, applianceName: sel.a.name || "" });
          } catch (ignore) { /* the message on the next screen is a convenience; the repair is already saved */ }
          Navigation.go("maintenance-reminder", values.applianceId, { from: "repair" });
        } else {
          ui.flash = existing ? "The repair record was updated." : "The repair record was saved.";
          Navigation.go("repair-history");
        }
      } catch (err) {
        // Nothing is cleared: the form keeps what the user entered, so they can fix the problem and try again.
        $("#formMessage").innerHTML = `<div class="alert alert-error">The repair was not saved. ${esc(err.message)} Your entries are still in the form.</div>`;
        saving = false;
        $("#saveBtn").disabled = false; $("#saveBtn").textContent = saveLabel;
      }
    });
  }

  // ---------- entry point ----------
  function render(root, params) {
    const userId = Auth.getUserId();
    if (!userId) {
      shell(root, "Repair History", SUB, notice("🔒", "Sign-in required",
        "Repair records are saved per signed-in user. Login is not implemented yet, so no user could be identified and no records are shown or saved."), null, false);
      return;
    }
    const mode = params.get("mode");
    if (params.get("view")) renderDetail(root, userId, params.get("view"));
    else if (mode === "add" || mode === "edit") renderForm(root, params, userId);
    else renderList(root, userId);
  }

  return { render, validate, buildPayload, summarize, filterSort, dateRangeError, totalCost, STATUSES };
})();

if (typeof module !== "undefined") module.exports = RepairHistory;
