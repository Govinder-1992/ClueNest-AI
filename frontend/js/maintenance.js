// Maintenance screen: reminders, completion with repeats, history, filters.
// Reminders are saved through the ClueNest API (GET/POST /maintenance, PUT/DELETE /maintenance/{id},
// POST /maintenance/{id}/complete), so they reach DynamoDB and the e-mail reminder job. Appliances come from GET /appliances.
const MaintenanceScreen = (() => {
  const REPEATS = [
    { value: "once", label: "One Time", months: 0 },
    { value: "monthly", label: "Monthly", months: 1 },
    { value: "quarterly", label: "Every 3 Months", months: 3 },
    { value: "semiannual", label: "Every 6 Months", months: 6 },
    { value: "yearly", label: "Yearly", months: 12 }
  ];
  // Suggestions only. They are offered as autocomplete and never assigned automatically.
  const SUGGESTIONS = ["Clean refrigerator coils", "Clean washing machine filter", "Inspect dishwasher filter",
    "Clean dryer lint filter", "Replace HVAC filter"];
  const MAX = { task: 100, description: 500, text: 1000 };
  const SUB = "Keep your appliances running smoothly with timely maintenance.";

  const ui = { search: "", appliance: "", status: "", sort: "asc", flash: "" };

  // ---------- pure logic (also used by tests) ----------
  const pad = n => String(n).padStart(2, "0");
  const repeatInfo = v => REPEATS.find(r => r.value === v);

  function classify(task, today) {
    if (task.status === "completed") return "Completed";
    return task.dueDate < today ? "Overdue" : "Upcoming";
  }

  function daysBetween(a, b) { // whole days from a to b (YYYY-MM-DD)
    const t = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    return Math.round((t(b) - t(a)) / 86400000);
  }

  function dueText(task, today) {
    const n = daysBetween(today, task.dueDate);
    if (n === 0) return "Due today";
    if (n > 0) return "Due in " + n + (n === 1 ? " day" : " days");
    return -n + (n === -1 ? " day" : " days") + " overdue";
  }

  function validate(raw, today) {
    today = today || WarrantyChecker.todayString();
    const errors = {}, v = {};
    const t = k => String(raw[k] == null ? "" : raw[k]).trim();

    v.applianceId = t("applianceId");
    if (!v.applianceId) errors.applianceId = "Select an appliance.";

    v.taskName = t("taskName");
    if (!v.taskName) errors.taskName = "Enter the maintenance task.";
    else if (v.taskName.length > MAX.task) errors.taskName = "Keep the task name under " + MAX.task + " characters.";

    v.description = t("description");
    if (v.description.length > MAX.description) errors.description = "Keep the description under " + MAX.description + " characters.";

    v.dueDate = t("dueDate");
    if (!v.dueDate) errors.dueDate = "Enter the due date.";
    else if (!WarrantyChecker.dateOnly(v.dueDate) || v.dueDate.length !== 10) errors.dueDate = "Enter a valid date.";
    else {
      const year = Number(today.slice(0, 4));
      if (v.dueDate < (year - 10) + today.slice(4)) errors.dueDate = "The due date is too far in the past (more than 10 years).";
      else if (v.dueDate > (year + 30) + today.slice(4)) errors.dueDate = "The due date is too far ahead (more than 30 years).";
    }

    v.repeat = t("repeat") || "once";
    if (!repeatInfo(v.repeat)) errors.repeat = "Choose a repeat frequency from the list.";

    v.notes = t("notes");
    if (v.notes.length > MAX.text) errors.notes = "Keep the notes under " + MAX.text + " characters.";
    return { errors, values: v };
  }

  // The request body for POST/PUT /maintenance. The server adds the ID, the appliance snapshot and the timestamps.
  function buildPayload(v) {
    return { applianceId: v.applianceId, taskName: v.taskName, description: v.description,
      dueDate: v.dueDate, repeat: v.repeat, notes: v.notes };
  }

  // ---------- recommendations after a problem was fixed ----------
  // Only safe routine tasks a homeowner can do without opening the appliance. They are suggestions: choosing one
  // fills in the form, and nothing is saved until the user saves the reminder.
  const MONTHS_TO_REPEAT = { 1: "monthly", 3: "quarterly", 6: "semiannual", 12: "yearly" };
  const TYPE_TASKS = {
    "refrigerator": [
      { name: "Clean refrigerator condenser coils", months: 6, description: "Unplug the fridge and vacuum dust from the coils you can reach safely." },
      { name: "Check and wipe the door seals", months: 3, description: "Look for gaps or cracks so the cold air stays in." },
      { name: "Replace the water filter", months: 6, description: "If your model has one, replace it as the manual describes." }],
    "washing machine": [
      { name: "Clean the drain pump filter", months: 3, description: "Place towels and a tray under the small filter door, then clear lint, coins and debris." },
      { name: "Run a tub clean cycle", months: 1, description: "Run an empty hot cycle with a washing machine cleaner." },
      { name: "Inspect hoses for kinks or leaks", months: 6, description: "Check the fill and drain hoses where you can see them." }],
    "dryer": [
      { name: "Deep clean the lint trap and housing", months: 3, description: "Wash the lint filter and vacuum the slot it sits in." },
      { name: "Inspect the vent hose and outside vent", months: 6, description: "Make sure air flows freely and nothing blocks the outside vent." }],
    "dishwasher": [
      { name: "Clean the dishwasher filter", months: 1, description: "Remove the filter, rinse off food and grease, and put it back." },
      { name: "Run a dishwasher cleaning cycle", months: 3, description: "Run an empty cycle with a dishwasher cleaner." },
      { name: "Check the spray arms for clogs", months: 6, description: "Clear any blocked holes with a toothpick." }],
    "oven": [
      { name: "Deep clean the oven", months: 6, description: "Follow the manual's cleaning instructions and wipe the door seal." },
      { name: "Check the oven door seal", months: 6, description: "Look for tears or gaps." }],
    "microwave": [
      { name: "Clean the microwave interior and door seal", months: 1, description: "Wipe the inside and the edge of the door." },
      { name: "Check the turntable and vents", months: 6, description: "Make sure the turntable turns freely and the vents are clear." }],
    "air conditioner": [
      { name: "Clean or replace the air filter", months: 1, description: "A dirty filter reduces cooling and can cause problems." },
      { name: "Clean the outdoor unit", months: 6, description: "Clear leaves and debris from around the unit." },
      { name: "Book a yearly service check", months: 12, description: "Have a qualified technician check the system once a year." }]
  };
  const DEFAULT_TASKS = [
    { name: "Clean accessible filters and vents", months: 3, description: "Use the manual to find the filters and vents you can clean safely." },
    { name: "Inspect the power cord, hoses and seals", months: 6, description: "Look for wear or damage and stop using the appliance if you see any." }];
  const ISSUE_TASKS = {
    "Not Draining": { name: "Check the drain hose and filter", months: 3, description: "Look for kinks or blockages that stop water from draining." },
    "Leaking Water": { name: "Check hoses and seals for leaks", months: 1, description: "Look for drips or damp patches around hoses, seals and the door." },
    "Not Cooling or Heating": { name: "Clean vents, coils and filters", months: 3, description: "Dust and blocked airflow are common reasons for poor cooling or heating." },
    "Making Unusual Noise": { name: "Check that the appliance is level and nothing is loose", months: 6, description: "An uneven floor or loose items can cause noise and vibration." },
    "Not Turning On": { name: "Check the power cord, plug and outlet", months: 6, description: "Make sure the plug is firm and the cord is not damaged." },
    "Error Code": { name: "Review the manual and note any repeating error code", months: 3, description: "If the same code returns, contact a qualified technician." },
    "Not Working Properly": { name: "Run a quick performance check", months: 3, description: "Run a normal cycle and note anything unusual." }
  };

  // Up to 5 suggestions: the one for the problem that was just fixed first, then routine tasks for the appliance type.
  function recommend(applianceType, category) {
    const type = String(applianceType || "").trim().toLowerCase();
    const list = [];
    if (ISSUE_TASKS[category]) list.push(ISSUE_TASKS[category]);
    list.push(...(TYPE_TASKS[type] || DEFAULT_TASKS));
    const seen = new Set();
    return list.filter(r => { const k = r.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 5).map(r => Object.assign({}, r, { repeat: MONTHS_TO_REPEAT[r.months] || "once" }));
  }

  // YYYY-MM-DD plus whole months, with the day kept inside the target month.
  function addMonthsToDate(dateStr, n) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const idx = y * 12 + (m - 1) + n;
    const ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
    return ny + "-" + pad(nm) + "-" + pad(Math.min(d, new Date(Date.UTC(ny, nm, 0)).getUTCDate()));
  }
  function summarize(tasks, today) {
    const s = { upcoming: 0, overdue: 0, completed: 0 };
    tasks.forEach(t => {
      const c = classify(t, today);
      if (c === "Upcoming") s.upcoming++; else if (c === "Overdue") s.overdue++; else s.completed++;
    });
    return s;
  }

  function filterSort(tasks, f, today) {
    const q = String(f.search || "").trim().toLowerCase();
    const out = tasks.filter(t =>
      (!q || String(t.taskName).toLowerCase().includes(q) || String(t.applianceName).toLowerCase().includes(q)) &&
      (!f.appliance || t.applianceId === f.appliance) &&
      (!f.status || classify(t, today) === f.status));
    const dir = f.sort === "desc" ? -1 : 1;
    out.sort((a, b) => dir * (a.dueDate.localeCompare(b.dueDate)) || a.taskName.localeCompare(b.taskName));
    return out;
  }

  // ---------- UI helpers ----------
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = ds => ds && WarrantyChecker.dateOnly(ds)
    ? new Date(ds + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Not provided";
  const row = (l, v, wide) => `<div${wide ? ' style="grid-column:1/-1"' : ""}><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`;
  const repeatLabel = v => (repeatInfo(v) || REPEATS[0]).label;
  const bm = t => [t.applianceBrand, t.applianceModel].filter(Boolean).join(" ") || "Not provided";
  const applianceLabel = a => [a.name || "Unnamed appliance", [a.brand, a.model].filter(Boolean).join(" ")].filter(Boolean).join(" - ");

  function shell(root, title, subtitle, body, back, showAdd) {
    root.innerHTML = `
      ${back ? `<a class="back-link" href="${back.href}">${esc(back.label)}</a>` : ""}
      <div class="page-header"><div><h1>${esc(title)}</h1><p class="subtitle">${esc(subtitle)}</p></div>
        ${showAdd ? '<a class="btn btn-primary" href="#/maintenance?mode=add" id="addTop">+ Add Reminder</a>' : ""}
      </div>${body}`;
  }

  function notice(icon, title, text, extra) {
    return `<div class="state-box"><div class="state-icon">${icon}</div><h2>${esc(title)}</h2><p>${esc(text)}</p>${extra || ""}</div>`;
  }

  function taskCard(t, today) {
    const status = classify(t, today);
    const done = status === "Completed";
    const cls = status.toLowerCase();
    return `
      <article class="card task-card task-${cls}" data-id="${esc(t.id)}">
        <div class="card-head">
          <div class="appliance-icon">${done ? "✅" : status === "Overdue" ? "⏰" : "🛠️"}</div>
          <div class="card-title"><h3>${esc(t.taskName)}</h3><span class="muted">${esc(t.applianceName || "Unnamed appliance")}</span></div>
          <span class="badge badge-${done ? "active" : status === "Overdue" ? "expired" : "upcoming"}">${status}</span>
        </div>
        <dl class="meta">
          ${done ? row("Completed on", fmtDate(t.completedDate)) : row("Due date", fmtDate(t.dueDate))}
          ${done ? row("Originally due", fmtDate(t.dueDate)) : row(status === "Overdue" ? "Overdue" : "Timing", dueText(t, today))}
          ${row("Repeat", repeatLabel(t.repeat))}
        </dl>
        <div class="task-details" hidden>
          <dl class="meta">
            ${row("Brand and model", bm(t))}
            ${row("Description", t.description || "Not provided", true)}
            ${row("Notes", t.notes || "Not provided", true)}
          </dl>
        </div>
        <div class="biz-actions">
          <button class="btn" data-act="details" aria-expanded="false">View Details</button>
          ${done ? "" : `<button class="btn btn-success" data-act="complete">Mark as Complete</button>
          <button class="btn" data-act="edit">Edit</button>
          <button class="btn btn-warn" data-act="delete">Delete</button>`}
        </div>
      </article>`;
  }
  function section(title, id, tasks, today, emptyText) {
    return `<section class="task-section" id="${id}"><h2>${esc(title)} <span class="count-pill">${tasks.length}</span></h2>
      ${tasks.length ? `<div class="grid task-grid">${tasks.map(t => taskCard(t, today)).join("")}</div>` : `<p class="muted">${esc(emptyText)}</p>`}</section>`;
  }

  // ---------- list screen ----------
  const loadingBox = text => `<div class="state-box"><div class="spinner"></div><p>${esc(text)}</p></div>`;

  async function renderList(root, userId) {
    const today = WarrantyChecker.todayString();
    const myHash = location.hash;
    shell(root, "Maintenance Reminders", SUB, loadingBox("Loading your maintenance reminders…"), null, false);
    let tasks;
    try { tasks = await Api.getMaintenanceReminders(); }
    catch (e) {
      if (location.hash !== myHash) return;
      shell(root, "Maintenance Reminders", SUB, notice("⚠️", "Couldn't load maintenance reminders", e.message,
        '<button class="btn" id="retryList">Retry</button>'), null, false);
      root.querySelector("#retryList").addEventListener("click", () => renderList(root, userId));
      return;
    }
    if (location.hash !== myHash) return;
    const sum = summarize(tasks, today);
    const apps = [...new Map(tasks.map(t => [t.applianceId, t.applianceName || "Unnamed appliance"])).entries()];
    if (ui.appliance && !apps.some(a => a[0] === ui.appliance)) ui.appliance = "";
    const flash = ui.flash ? `<div class="alert alert-success" role="status">${esc(ui.flash)}</div>` : "";
    ui.flash = "";

    const body = `
      ${flash}
      <div class="summary-grid">
        <div class="summary-card"><span class="muted">Upcoming Reminders</span><strong id="sumUpcoming">${sum.upcoming}</strong></div>
        <div class="summary-card summary-overdue"><span class="muted">Overdue Reminders</span><strong id="sumOverdue">${sum.overdue}</strong></div>
        <div class="summary-card"><span class="muted">Completed Tasks</span><strong id="sumCompleted">${sum.completed}</strong></div>
      </div>
      ${tasks.length ? `
      <div class="filters">
        <input id="mSearch" type="search" placeholder="Search by appliance or task name" aria-label="Search maintenance" value="${esc(ui.search)}" />
        <select id="mAppliance" aria-label="Filter by appliance"><option value="">All appliances</option>
          ${apps.map(a => `<option value="${esc(a[0])}" ${a[0] === ui.appliance ? "selected" : ""}>${esc(a[1])}</option>`).join("")}</select>
        <select id="mStatus" aria-label="Filter by status"><option value="">All statuses</option>
          ${["Upcoming", "Overdue", "Completed"].map(s => `<option ${s === ui.status ? "selected" : ""}>${s}</option>`).join("")}</select>
        <select id="mSort" aria-label="Sort by due date">
          <option value="asc" ${ui.sort === "asc" ? "selected" : ""}>Due date: earliest first</option>
          <option value="desc" ${ui.sort === "desc" ? "selected" : ""}>Due date: latest first</option></select>
      </div>
      <div id="taskList"></div>` : notice("🛠️", "No maintenance reminders yet",
        "Add a reminder for a routine task, such as cleaning a filter, to keep track of when it is due.",
        '<a class="btn btn-primary" href="#/maintenance?mode=add">+ Add Reminder</a>')}`;
    shell(root, "Maintenance Reminders", SUB, body, null, true);
    if (!tasks.length) return;

    const $ = s => root.querySelector(s);
    function paint() {
      const shown = filterSort(tasks, ui, today);
      if (!shown.length) { $("#taskList").innerHTML = notice("🔍", "No matching reminders", "No reminders match your search or filters."); return; }
      const by = c => shown.filter(t => classify(t, today) === c);
      const show = c => !ui.status || ui.status === c;
      $("#taskList").innerHTML =
        (show("Upcoming") ? section("Upcoming", "secUpcoming", by("Upcoming"), today, "No upcoming maintenance.") : "") +
        (show("Overdue") ? section("Overdue", "secOverdue", by("Overdue"), today, "Nothing is overdue.") : "") +
        (show("Completed") ? section("Completed", "secCompleted", by("Completed"), today, "No completed maintenance yet.") : "");
    }
    $("#mSearch").addEventListener("input", e => { ui.search = e.target.value; paint(); });
    $("#mAppliance").addEventListener("change", e => { ui.appliance = e.target.value; paint(); });
    $("#mStatus").addEventListener("change", e => { ui.status = e.target.value; paint(); });
    $("#mSort").addEventListener("change", e => { ui.sort = e.target.value; paint(); });

    $("#taskList").addEventListener("click", e => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const t = tasks.find(x => x.id === btn.closest(".task-card").dataset.id);
      if (!t) return;
      if (btn.dataset.act === "details") {
        const panel = btn.closest(".task-card").querySelector(".task-details");
        panel.hidden = !panel.hidden;
        btn.setAttribute("aria-expanded", String(!panel.hidden));
        btn.textContent = panel.hidden ? "View Details" : "Hide Details";
      } else if (btn.dataset.act === "edit") {
        location.hash = "#/maintenance?mode=edit&task=" + encodeURIComponent(t.id);
      } else if (btn.dataset.act === "complete") {
        btn.disabled = true;
        Api.completeMaintenanceReminder(t.id, WarrantyChecker.todayString()).then(r => {
          ui.flash = '"' + t.taskName + '" was marked complete.' +
            (r.next ? " The next reminder is due " + fmtDate(r.next.dueDate) + "." : "");
          renderList(root, userId);
        }).catch(err => { window.alert(err.message); renderList(root, userId); });
      } else if (btn.dataset.act === "delete") {
        const repeats = t.repeat !== "once";
        if (!window.confirm('Delete the reminder "' + t.taskName + '"? This cannot be undone.' +
          (repeats ? " This repeating reminder will stop, and no future reminders will be created." : "") +
          " Completed history and your appliance records are not affected.")) return;
        btn.disabled = true;
        Api.deleteMaintenanceReminder(t.id).then(() => {
          ui.flash = 'The reminder "' + t.taskName + '" was deleted.';
          renderList(root, userId);
        }).catch(err => { window.alert(err.message); renderList(root, userId); });
      }
    });
    paint();
  }

  // ---------- add / edit form ----------
  const FIELDS = ["applianceId", "taskName", "description", "dueDate", "repeat", "notes"];

  async function renderForm(root, params, userId) {
    const editId = params.get("mode") === "edit" ? params.get("task") : null;
    const preId = params.get("id");
    const title = editId ? "Edit Maintenance Reminder" : "Add Maintenance Reminder";
    const back = { href: "#/maintenance", label: "← Back to Maintenance Reminders" };
    const myHash = location.hash;

    let existing = null;
    if (editId) {
      shell(root, title, SUB, loadingBox("Loading the reminder…"), back);
      try { existing = (await Api.getMaintenanceReminders()).find(r => r.id === editId) || null; }
      catch (e) {
        if (location.hash !== myHash) return;
        shell(root, title, SUB, notice("⚠️", "Couldn't load the reminder", e.message,
          '<button class="btn" id="retryRem">Retry</button>'), back);
        root.querySelector("#retryRem").addEventListener("click", () => renderForm(root, params, userId));
        return;
      }
      if (location.hash !== myHash) return;
      if (!existing) { shell(root, title, SUB, notice("🔍", "Reminder not found", "That reminder no longer exists.",
        '<a class="btn" href="#/maintenance">Back to Maintenance Reminders</a>'), back); return; }
      if (existing.status === "completed") { shell(root, title, SUB, notice("✅", "Completed reminders can't be edited",
        "Completed maintenance is kept as history.", '<a class="btn" href="#/maintenance">Back to Maintenance Reminders</a>'), back); return; }
    }

    shell(root, title, SUB, `<div class="state-box"><div class="spinner"></div><p>Loading your appliances…</p></div>`, back);
    let appliances;
    try { appliances = (await Api.getAppliances()).map(normalize); }
    catch (e) {
      if (location.hash !== myHash) return;
      shell(root, title, SUB, notice("⚠️", "Couldn't load your appliances", e.message,
        '<button class="btn" id="retryApps">Retry</button>'), back);
      root.querySelector("#retryApps").addEventListener("click", () => renderForm(root, params, userId));
      return;
    }
    if (location.hash !== myHash) return;
    if (!appliances.length) {
      shell(root, title, SUB, notice("📦", "No appliances yet", "Register an appliance first, then add maintenance reminders for it.",
        '<a class="btn btn-primary" href="#/add-appliance">+ Add Appliance</a>'), back);
      return;
    }

    const opts = appliances.map(a => ({ id: String(a.id), label: applianceLabel(a), a }));
    if (existing && !opts.some(o => o.id === String(existing.applianceId))) {
      const snap = { id: existing.applianceId, name: existing.applianceName, brand: existing.applianceBrand, model: existing.applianceModel, type: existing.applianceType };
      opts.push({ id: String(existing.applianceId), label: applianceLabel(snap) + " (no longer in your list)", a: snap });
    }
    // Opened automatically after a completed repair was saved (Step 9 of the workflow).
    const fromRepair = !existing && Boolean(preId) && params.get("from") === "repair";
    const rc = fromRepair ? Navigation.getRepairCompletedContext(preId) : null;
    const repairNote = rc && rc.repairDate
      ? "Follow-up to the repair completed on " + rc.repairDate + (rc.company ? " by " + rc.company : "") + "." : "";
    // Opened automatically after "Problem Fixed" in AI Troubleshooting (the result was already saved).
    const fixedCtx = !existing && Boolean(preId) && params.get("from") === "troubleshoot" ? Navigation.getTroubleshootFixedContext(preId) : null;
    const init = existing ? existing : { applianceId: preId || "", taskName: "", description: "", dueDate: "", repeat: "once", notes: repairNote };

    const field = (id, label, control, required, hint) => `<div class="form-field">
      <label for="${id}">${esc(label)}${required ? ' <span class="req">*</span>' : ""}</label>${control}
      ${hint ? `<small class="muted">${esc(hint)}</small>` : ""}<div class="field-error" id="err-${id}" role="alert"></div></div>`;

    const preOpt = opts.find(o => o.id === String(preId));
    const recs = fixedCtx ? recommend(preOpt ? preOpt.a.type : "", fixedCtx.category) : [];
    const recHtml = fixedCtx ? `
      <div class="alert alert-success" id="fixedBanner" role="status">Great, glad it's fixed! Your troubleshooting result${preOpt ? " for " + esc(preOpt.a.name || "your appliance") : ""} was saved.
        Schedule some maintenance to help keep it running well.</div>
      <section class="rec-box" id="recBox"><h2>Recommended maintenance</h2>
        <p class="muted">Based on ${preOpt && preOpt.a.type ? "your " + esc(preOpt.a.type.toLowerCase()) : "your appliance"} and the problem you just fixed (${esc(fixedCtx.category)}). Choose one to fill in the form, or enter your own.</p>
        <div class="rec-grid">${recs.map((r, i) => `<button type="button" class="rec-item" data-i="${i}" aria-pressed="false">
          <strong>${esc(r.name)}</strong><span>${esc(repeatLabel(r.repeat))}</span></button>`).join("")}</div>
      </section>` : "";
    const flowBanner = recHtml + (fromRepair ? `<div class="alert alert-success" id="flowBanner" role="status">The repair was saved${rc && rc.applianceName ? " for " + esc(rc.applianceName) : ""}.
      You can now schedule the next maintenance for this appliance.</div>` : "");
    shell(root, title, SUB, `
      ${flowBanner}
      <div id="formMessage" role="status"></div>
      <form id="mForm" class="form-card" novalidate>
        <fieldset><legend>Appliance</legend><div class="form-grid">
          ${field("applianceId", "Select Appliance", `<select id="applianceId"><option value="">Select appliance</option>
            ${opts.map(o => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join("")}</select>`, true)}
          <div class="form-field"><label>Brand and model</label><div class="readonly-box" id="applianceInfo">Select an appliance</div></div>
        </div></fieldset>
        <fieldset><legend>Maintenance Details</legend><div class="form-grid">
          ${field("taskName", "Task Name", `<input id="taskName" list="taskSuggestions" maxlength="${MAX.task}" autocomplete="off" />
            <datalist id="taskSuggestions">${SUGGESTIONS.map(s => `<option value="${esc(s)}"></option>`).join("")}</datalist>`, true,
            "Suggestions appear as you type. Nothing is filled in for you.")}
          ${field("dueDate", "Due Date", '<input id="dueDate" type="date" />', true, "A past date will be shown as overdue.")}
          ${field("repeat", "Repeat Frequency", `<select id="repeat">${REPEATS.map(r => `<option value="${r.value}">${esc(r.label)}</option>`).join("")}</select>`, true)}
          <div></div>
          <div class="form-field" style="grid-column:1/-1"><label for="description">Description (optional)</label>
            <textarea id="description" rows="3" maxlength="${MAX.description}"></textarea><div class="field-error" id="err-description" role="alert"></div></div>
          <div class="form-field" style="grid-column:1/-1"><label for="notes">Notes (optional)</label>
            <textarea id="notes" rows="3" maxlength="${MAX.text}"></textarea><div class="field-error" id="err-notes" role="alert"></div></div>
        </div></fieldset>
        <div class="form-actions"><a class="btn" href="#/maintenance" id="cancelBtn">Cancel</a>
          <button type="submit" class="btn btn-primary" id="saveBtn">${editId ? "Save Changes" : "Save Reminder"}</button></div>
      </form>`, back);

    const $ = s => root.querySelector(s);
    FIELDS.forEach(f => { $("#" + f).value = init[f] == null ? "" : init[f]; });
    if (!opts.some(o => o.id === $("#applianceId").value)) $("#applianceId").value = "";
    const selected = () => opts.find(o => o.id === $("#applianceId").value);
    const refresh = () => {
      const o = selected();
      $("#applianceInfo").textContent = o ? ([o.a.brand, o.a.model].filter(Boolean).join(" · ") || "Brand and model not provided") : "Select an appliance";
    };
    $("#applianceId").addEventListener("change", refresh);
    refresh();

    // Choosing a recommendation fills in the form. Nothing is saved until the user saves the reminder.
    root.querySelectorAll(".rec-item").forEach(btn => btn.addEventListener("click", () => {
      const r = recs[Number(btn.dataset.i)];
      if (!r) return;
      $("#taskName").value = r.name;
      $("#description").value = r.description;
      $("#repeat").value = r.repeat;
      $("#dueDate").value = addMonthsToDate(WarrantyChecker.todayString(), r.months);
      root.querySelectorAll(".rec-item").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
      $("#taskName").focus();
    }));

    let saving = false;
    let saved = false; // set once the server has accepted the reminder, so it can never be created twice
    $("#mForm").addEventListener("submit", async e => {
      e.preventDefault();
      if (saving || saved) return;
      $("#formMessage").innerHTML = "";
      const raw = Object.fromEntries(FIELDS.map(f => [f, $("#" + f).value]));
      const { errors, values } = validate(raw);
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
        if (existing) await Api.updateMaintenanceReminder(existing.id, payload);
        else await Api.createMaintenanceReminder(payload);
        saved = true;
        if (fromRepair) Navigation.clearRepairCompletedContext();
        if (fixedCtx) Navigation.clearTroubleshootFixedContext();
        ui.flash = existing ? 'The reminder "' + values.taskName + '" was updated.' : 'The reminder "' + values.taskName + '" was saved.';
        Navigation.go("maintenance");
      } catch (err) {
        // Nothing is cleared: the form keeps what the user entered, so they can fix the problem and try again.
        $("#formMessage").innerHTML = `<div class="alert alert-error">The reminder was not saved. ${esc(err.message)} Your entries are still in the form.</div>`;
        saving = false;
        $("#saveBtn").disabled = false; $("#saveBtn").textContent = editId ? "Save Changes" : "Save Reminder";
      }
    });
  }

  // ---------- entry point ----------
  // forceAdd is used by the appliance card's "Maintenance Reminder" action (opens the form with that appliance).
  function render(root, params, forceAdd) {
    const userId = Auth.getUserId();
    if (!userId) {
      shell(root, "Maintenance Reminders", SUB, notice("🔒", "Sign-in required",
        "Maintenance reminders are saved per signed-in user. Login is not implemented yet, so no user could be identified and no reminders are shown or saved."), null, false);
      return;
    }
    const mode = params.get("mode");
    const st = params.get("status");
    if (["Upcoming", "Overdue", "Completed"].includes(st)) ui.status = st;
    if (forceAdd || mode === "add" || mode === "edit") renderForm(root, params, userId);
    else renderList(root, userId);
  }

  return { render, validate, buildPayload, classify, summarize, filterSort, dueText, recommend, addMonthsToDate, REPEATS };
})();

if (typeof module !== "undefined") module.exports = MaintenanceScreen;
