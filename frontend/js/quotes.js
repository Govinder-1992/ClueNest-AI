// Technician Quotes screen: list, add/edit form, filters and comparison.
// Quotes are stored by QuoteStore (prototype, browser-only). Appliances come from GET /appliances.
const TechnicianQuotes = (() => {
  const MAX = { name: 100, address: 200, availability: 100, text: 1000 };
  const COMPARE_NOTE = "The lowest quote may not always be the best choice. Consider experience, reviews, availability and the work included.";
  const STORAGE_NOTE = "Prototype storage: quotes are saved only in this browser on this device (not in the cloud) and can be lost if browser data is cleared.";

  // UI state kept while the user moves around the screen.
  const ui = { search: "", appliance: "", sort: "newest", selected: new Set(), flash: "" };

  // ---------- pure logic (also used by tests) ----------
  const FIELDS = ["businessName", "phone", "email", "website", "address", "applianceId", "problem",
    "repairCost", "inspectionFee", "additionalCharges", "availability", "quoteDate", "notes"];

  function normalizeWebsite(s) {
    const t = String(s || "").trim();
    if (!t) return "";
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : "https://" + t;
    const safe = FindTechnician.safeUrl(withScheme);
    if (!safe) return null;
    try { return new URL(safe).hostname.includes(".") ? safe : null; } catch (e) { return null; }
  }

  // Returns { errors, values } where values hold cleaned data and money in cents (null when not given).
  function validate(raw, today) {
    today = today || WarrantyChecker.todayString();
    const errors = {}, v = {};
    const t = k => String(raw[k] == null ? "" : raw[k]).trim();

    v.businessName = t("businessName");
    if (!v.businessName) errors.businessName = "Enter the technician or business name.";
    else if (v.businessName.length > MAX.name) errors.businessName = "Keep the name under " + MAX.name + " characters.";

    v.phone = t("phone");
    if (v.phone) {
      const digits = v.phone.replace(/\D/g, "").length;
      if (!/^[\d\s()+\-.]+$/.test(v.phone) || digits < 7 || digits > 15) errors.phone = "Enter a valid phone number.";
    }

    v.email = t("email");
    if (v.email && (v.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email))) errors.email = "Enter a valid email address.";

    const site = normalizeWebsite(raw.website);
    if (site === null) { errors.website = "Enter a valid website address, such as example.com."; v.website = ""; }
    else v.website = site;

    v.address = t("address");
    if (v.address.length > MAX.address) errors.address = "Keep the address under " + MAX.address + " characters.";

    v.applianceId = t("applianceId");
    if (!v.applianceId) errors.applianceId = "Select the appliance this quote is for.";

    v.problem = t("problem");
    if (v.problem.length > MAX.text) errors.problem = "Keep the description under " + MAX.text + " characters.";

    const money = (k, required) => {
      if (!required && t(k) === "") { v[k] = null; return; }
      const r = RepairVsReplace.parseMoney(t(k), required);
      if (r.error) errors[k] = r.error; else v[k] = r.cents;
    };
    money("repairCost", true);
    money("inspectionFee", false);
    money("additionalCharges", false);

    v.availability = t("availability");
    if (v.availability.length > MAX.availability) errors.availability = "Keep this under " + MAX.availability + " characters.";

    v.quoteDate = t("quoteDate");
    if (!v.quoteDate) errors.quoteDate = "Enter the quote date.";
    else if (!WarrantyChecker.dateOnly(v.quoteDate)) errors.quoteDate = "Enter a valid date.";
    else if (v.quoteDate > today) errors.quoteDate = "The quote date cannot be in the future.";

    v.notes = t("notes");
    if (v.notes.length > MAX.text) errors.notes = "Keep the notes under " + MAX.text + " characters.";

    return { errors, values: v };
  }

  function totalCents(v) {
    return (v.repairCost || 0) + (v.inspectionFee || 0) + (v.additionalCharges || 0);
  }

  // appliance: normalized appliance object (or a snapshot with name/brand/model/type); extra: optional Google fields.
  function buildQuote(v, appliance, userId, existing, extra, now) {
    now = now || new Date().toISOString();
    const q = {
      id: existing ? existing.id : QuoteStore.newId(),
      userId,
      applianceId: v.applianceId,
      applianceName: appliance.name || "", applianceBrand: appliance.brand || "",
      applianceModel: appliance.model || "", applianceType: appliance.type || "",
      businessName: v.businessName, phone: v.phone, email: v.email, website: v.website, address: v.address,
      problem: v.problem,
      repairCostCents: v.repairCost, inspectionFeeCents: v.inspectionFee, additionalChargesCents: v.additionalCharges,
      totalCents: totalCents(v),
      availability: v.availability, quoteDate: v.quoteDate, notes: v.notes,
      createdAt: existing ? existing.createdAt : now, updatedAt: now
    };
    // Rating data is only kept when it came from Google Places via Find Technician.
    const g = extra || (existing && { googleRating: existing.googleRating, googleReviewCount: existing.googleReviewCount, placeId: existing.placeId });
    if (g && typeof g.googleRating === "number") q.googleRating = g.googleRating;
    if (g && typeof g.googleReviewCount === "number") q.googleReviewCount = g.googleReviewCount;
    if (g && g.placeId) q.placeId = g.placeId;
    return q;
  }

  function summarize(quotes) {
    const withRepair = quotes.filter(q => typeof q.repairCostCents === "number");
    let lowest = null;
    withRepair.forEach(q => { if (!lowest || q.repairCostCents < lowest.repairCostCents) lowest = q; });
    return {
      count: quotes.length,
      applianceCount: new Set(quotes.map(q => q.applianceId)).size,
      lowest: lowest ? { cents: lowest.repairCostCents, business: lowest.businessName } : null
    };
  }

  const newer = (a, b) => (b.quoteDate || "").localeCompare(a.quoteDate || "") || (b.createdAt || "").localeCompare(a.createdAt || "");

  function filterSort(quotes, f) {
    const s = String(f.search || "").trim().toLowerCase();
    const out = quotes.filter(q =>
      (!s || String(q.businessName).toLowerCase().includes(s)) &&
      (!f.appliance || q.applianceId === f.appliance));
    out.sort(f.sort === "lowest" ? (a, b) => (a.totalCents - b.totalCents) || newer(a, b) : newer);
    return out;
  }

  // IDs of every quote sharing the lowest total (ties are all highlighted).
  function lowestTotalIds(quotes) {
    if (!quotes.length) return [];
    const min = Math.min(...quotes.map(q => q.totalCents));
    return quotes.filter(q => q.totalCents === min).map(q => q.id);
  }

  // ---------- UI helpers ----------
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cad = c => RepairVsReplace.cad(c);
  const money = c => (typeof c === "number" ? cad(c) : "Not provided");
  const fmtDate = ds => ds && WarrantyChecker.dateOnly(ds)
    ? new Date(ds + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Not provided";
  const row = (l, v, wide) => `<div${wide ? ' style="grid-column:1/-1"' : ""}><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`;
  const applianceLabel = a => [a.name || "Unnamed appliance", [a.brand, a.model].filter(Boolean).join(" ")].filter(Boolean).join(" - ");

  function shell(root, title, subtitle, body, back) {
    root.innerHTML = `
      ${back ? `<a class="back-link" href="${back.href}">${esc(back.label)}</a>` : ""}
      <div class="page-header"><div><h1>${esc(title)}</h1><p class="subtitle">${esc(subtitle)}</p></div>
        ${back ? "" : '<a class="btn btn-primary" href="#/technician-quotes?mode=add" id="addQuoteTop">+ Add Quote</a>'}
      </div>${body}`;
  }

  function notice(icon, title, text, extra) {
    return `<div class="state-box"><div class="state-icon">${icon}</div><h2>${esc(title)}</h2><p>${esc(text)}</p>${extra || ""}</div>`;
  }

  const SUB = "Keep track of repair estimates and compare technicians before making a decision.";

  // ---------- list screen ----------
  function contactHtml(q) {
    const tel = FindTechnician.telHref(q.phone);
    const web = FindTechnician.safeUrl(q.website);
    const mail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.email || "") ? q.email : "";
    const parts = [
      q.phone && (tel ? `<a href="${esc(tel)}">📞 ${esc(q.phone)}</a>` : `<span>📞 ${esc(q.phone)}</span>`),
      mail && `<a href="mailto:${esc(mail)}">✉️ ${esc(mail)}</a>`,
      web && `<a href="${esc(web)}" target="_blank" rel="noopener noreferrer">🌐 ${esc(web.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>`
    ].filter(Boolean);
    return parts.length ? `<div class="quote-contact">${parts.join("")}</div>` : "";
  }

  function quoteCard(q) {
    const sel = ui.selected.has(q.id);
    const bm = [q.applianceBrand, q.applianceModel].filter(Boolean).join(" ") || "Not provided";
    return `
      <article class="card quote-card" data-id="${esc(q.id)}">
        <div class="card-head">
          <div class="appliance-icon">🧾</div>
          <div class="card-title"><h3>${esc(q.businessName)}</h3><span class="muted">Quote date: ${esc(fmtDate(q.quoteDate))}</span></div>
          <label class="compare-check"><input type="checkbox" data-act="select" ${sel ? "checked" : ""} /> Compare</label>
        </div>
        <dl class="meta">
          ${row("Appliance", q.applianceName || "Not provided")}
          ${row("Brand and model", bm)}
          ${row("Problem", q.problem || "Not provided", true)}
          ${row("Estimated repair cost", money(q.repairCostCents))}
          ${row("Inspection fee", money(q.inspectionFeeCents))}
          ${row("Total estimated cost", cad(q.totalCents))}
          ${q.availability ? row("Availability", q.availability) : ""}
        </dl>
        ${contactHtml(q)}
        <div class="quote-details" hidden>
          <dl class="meta">
            ${row("Additional charges", money(q.additionalChargesCents))}
            ${row("Business address", q.address || "Not provided", true)}
            ${row("Notes", q.notes || "Not provided", true)}
            ${typeof q.googleRating === "number" ? row("Google rating", "★ " + q.googleRating.toFixed(1) +
              (typeof q.googleReviewCount === "number" ? " (" + q.googleReviewCount + " reviews)" : "")) : ""}
            ${row("Saved", new Date(q.createdAt).toLocaleString())}
            ${q.updatedAt && q.updatedAt !== q.createdAt ? row("Last edited", new Date(q.updatedAt).toLocaleString()) : ""}
          </dl>
        </div>
        <div class="biz-actions">
          <button class="btn" data-act="details" aria-expanded="false">View Details</button>
          <button class="btn" data-act="edit">Edit Quote</button>
          <button class="btn btn-warn" data-act="delete">Delete Quote</button>
        </div>
      </article>`;
  }

  function compareHtml(quotes) {
    const rows = quotes;
    const low = new Set(lowestTotalIds(rows));
    const anyRating = rows.some(q => typeof q.googleRating === "number");
    const sameAppliance = new Set(rows.map(q => q.applianceId)).size === 1;
    const cell = (q, html) => `<td class="${low.has(q.id) ? "lowest" : ""}">${html}</td>`;
    const line = (label, fn) => `<tr><th scope="row">${esc(label)}</th>${rows.map(q => cell(q, fn(q))).join("")}</tr>`;
    return `
      <section class="result-block compare-block" id="compareBlock">
        <div class="results-head" style="margin-top:0"><h2>Compare Quotes</h2>
          <button class="btn" id="closeCompare" type="button">Close comparison</button></div>
        ${sameAppliance ? "" : '<div class="alert alert-info">These quotes are for different appliances, so their costs may not be directly comparable.</div>'}
        <div class="table-wrap"><table class="compare-table">
          <thead><tr><th></th>${rows.map(q => `<th class="${low.has(q.id) ? "lowest" : ""}">${esc(q.businessName)}${low.has(q.id) ? '<span class="badge badge-active">Lowest total</span>' : ""}</th>`).join("")}</tr></thead>
          <tbody>
            ${line("Appliance", q => esc(q.applianceName || "Not provided"))}
            ${line("Repair cost", q => esc(money(q.repairCostCents)))}
            ${line("Inspection fee", q => esc(money(q.inspectionFeeCents)))}
            ${line("Additional charges", q => esc(money(q.additionalChargesCents)))}
            ${line("Total estimated cost", q => "<b>" + esc(cad(q.totalCents)) + "</b>")}
            ${line("Availability", q => esc(q.availability || "Not provided"))}
            ${anyRating ? line("Google rating", q => typeof q.googleRating === "number"
              ? "★ " + esc(q.googleRating.toFixed(1)) + (typeof q.googleReviewCount === "number" ? " (" + esc(q.googleReviewCount) + ")" : "") : "Not available") : ""}
          </tbody></table></div>
        <p class="disclaimer">${esc(COMPARE_NOTE)}</p>
      </section>`;
  }

  function renderList(root, userId) {
    let quotes;
    try { quotes = QuoteStore.list(userId); }
    catch (e) {
      shell(root, "Technician Quotes", SUB, notice("⚠️", "Couldn't load your quotes", e.message,
        '<button class="btn" id="retryList">Retry</button>'));
      root.querySelector("#retryList").addEventListener("click", () => renderList(root, userId));
      return;
    }
    // Forget selections for quotes that no longer exist.
    const ids = new Set(quotes.map(q => q.id));
    ui.selected.forEach(i => { if (!ids.has(i)) ui.selected.delete(i); });

    const sum = summarize(quotes);
    const apps = [...new Map(quotes.map(q => [q.applianceId, q.applianceName || "Unnamed appliance"])).entries()];
    if (ui.appliance && !apps.some(a => a[0] === ui.appliance)) ui.appliance = "";

    const flash = ui.flash ? `<div class="alert alert-success" role="status">${esc(ui.flash)}</div>` : "";
    ui.flash = "";

    const body = `
      ${flash}
      <div class="alert alert-info">${esc(STORAGE_NOTE)}</div>
      <div class="summary-grid">
        <div class="summary-card"><span class="muted">Total Quotes</span><strong id="sumCount">${sum.count}</strong></div>
        <div class="summary-card"><span class="muted">Appliances with Quotes</span><strong id="sumAppliances">${sum.applianceCount}</strong></div>
        <div class="summary-card"><span class="muted">Lowest Repair Estimate</span>
          <strong id="sumLowest">${sum.lowest ? esc(cad(sum.lowest.cents)) : "—"}</strong>
          ${sum.lowest ? `<small class="muted">${esc(sum.lowest.business)}</small>` : ""}</div>
      </div>
      ${quotes.length ? `
      <div class="filters">
        <input id="qSearch" type="search" placeholder="Search by technician or business name" aria-label="Search quotes" value="${esc(ui.search)}" />
        <select id="qAppliance" aria-label="Filter by appliance"><option value="">All appliances</option>
          ${apps.map(a => `<option value="${esc(a[0])}" ${a[0] === ui.appliance ? "selected" : ""}>${esc(a[1])}</option>`).join("")}</select>
        <select id="qSort" aria-label="Sort quotes">
          <option value="newest" ${ui.sort === "newest" ? "selected" : ""}>Newest quote</option>
          <option value="lowest" ${ui.sort === "lowest" ? "selected" : ""}>Lowest cost</option></select>
      </div>
      <div class="compare-bar"><span id="selCount"></span>
        <button class="btn btn-primary" id="compareBtn" disabled>Compare Quotes</button></div>
      <div id="compareArea"></div>
      <div id="quoteList"></div>` : notice("🧾", "No quotes yet",
        "When you contact a technician, add their estimate here to keep track of it and compare options.",
        '<a class="btn btn-primary" href="#/technician-quotes?mode=add">+ Add Quote</a>')}`;
    shell(root, "Technician Quotes", SUB, body);
    if (!quotes.length) return;

    const $ = s => root.querySelector(s);
    let comparing = false;

    function paintList() {
      const shown = filterSort(quotes, ui);
      $("#quoteList").innerHTML = shown.length
        ? `<div class="grid quote-grid">${shown.map(quoteCard).join("")}</div>`
        : notice("🔍", "No matching quotes", "No quotes match your search or filter.");
      const n = ui.selected.size;
      $("#selCount").textContent = n ? n + " selected for comparison" : "Tick two or more quotes to compare them.";
      $("#compareBtn").disabled = n < 2;
      if (comparing) paintCompare();
    }

    function paintCompare() {
      const chosen = quotes.filter(q => ui.selected.has(q.id));
      if (chosen.length < 2) { comparing = false; $("#compareArea").innerHTML = ""; return; }
      $("#compareArea").innerHTML = compareHtml(filterSort(chosen, { sort: ui.sort }));
      $("#closeCompare").addEventListener("click", () => { comparing = false; $("#compareArea").innerHTML = ""; });
    }

    $("#qSearch").addEventListener("input", e => { ui.search = e.target.value; paintList(); });
    $("#qAppliance").addEventListener("change", e => { ui.appliance = e.target.value; paintList(); });
    $("#qSort").addEventListener("change", e => { ui.sort = e.target.value; paintList(); });
    $("#compareBtn").addEventListener("click", () => {
      comparing = true; paintCompare();
      const b = $("#compareBlock"); if (b) b.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    // One delegated handler for all card actions.
    $("#quoteList").addEventListener("click", e => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const card = btn.closest(".quote-card");
      const q = quotes.find(x => x.id === card.dataset.id);
      if (!q) return;
      const act = btn.dataset.act;
      if (act === "select") return; // handled on change
      if (act === "details") {
        const p = card.querySelector(".quote-details");
        p.hidden = !p.hidden;
        btn.setAttribute("aria-expanded", String(!p.hidden));
        btn.textContent = p.hidden ? "View Details" : "Hide Details";
      } else if (act === "edit") {
        location.hash = "#/technician-quotes?mode=edit&quote=" + encodeURIComponent(q.id);
      } else if (act === "delete") {
        if (!window.confirm('Delete the quote from "' + q.businessName + '"? This cannot be undone. Your appliance records are not affected.')) return;
        try { QuoteStore.remove(userId, q.id); }
        catch (err) { ui.flash = ""; window.alert(err.message); return; }
        ui.selected.delete(q.id);
        ui.flash = "Quote from " + q.businessName + " was deleted.";
        renderList(root, userId);
      }
    });
    $("#quoteList").addEventListener("change", e => {
      if (e.target.dataset.act !== "select") return;
      const id = e.target.closest(".quote-card").dataset.id;
      if (e.target.checked) ui.selected.add(id); else ui.selected.delete(id);
      const n = ui.selected.size;
      $("#selCount").textContent = n ? n + " selected for comparison" : "Tick two or more quotes to compare them.";
      $("#compareBtn").disabled = n < 2;
      if (comparing) paintCompare();
    });
    paintList();
  }

  // ---------- add / edit form ----------
  const input = (id, label, attrs, required, hint) => `<div class="form-field">
    <label for="${id}">${esc(label)}${required ? ' <span class="req">*</span>' : ""}</label>
    <input id="${id}" ${attrs || ""} />${hint ? `<small class="muted">${esc(hint)}</small>` : ""}
    <div class="field-error" id="err-${id}" role="alert"></div></div>`;

  const moneyInput = (id, label, required) => `<div class="form-field">
    <label for="${id}">${esc(label)}${required ? ' <span class="req">*</span>' : " (optional)"}</label>
    <div class="money"><span class="money-prefix">CAD $</span>
      <input id="${id}" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" /></div>
    <div class="field-error" id="err-${id}" role="alert"></div></div>`;

  async function renderForm(root, params, userId) {
    const editId = params.get("mode") === "edit" ? params.get("quote") : null;
    const preId = params.get("id");
    const title = editId ? "Edit Quote" : "Add Quote";
    const back = { href: "#/technician-quotes", label: "← Back to Technician Quotes" };
    const myHash = location.hash;

    let existing = null;
    if (editId) {
      try { existing = QuoteStore.list(userId).find(q => q.id === editId) || null; }
      catch (e) { shell(root, title, SUB, notice("⚠️", "Couldn't load the quote", e.message), back); return; }
      if (!existing) { shell(root, title, SUB, notice("🔍", "Quote not found", "That quote no longer exists.",
        '<a class="btn" href="#/technician-quotes">Back to Technician Quotes</a>'), back); return; }
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
      shell(root, title, SUB, notice("📦", "No appliances yet", "Register an appliance first, then add a quote for it.",
        '<a class="btn btn-primary" href="#/add-appliance">+ Add Appliance</a>'), back);
      return;
    }

    // Prefill sources: the quote being edited, or the business chosen in Find Technician.
    const tech = !existing && preId ? Navigation.getTechnicianContext(preId) : null;
    const problemCtx = !existing && preId ? Navigation.getProblemContext(preId) : null;
    const biz = tech ? tech.business : null;
    const init = existing ? {
      businessName: existing.businessName, phone: existing.phone, email: existing.email, website: existing.website,
      address: existing.address, applianceId: existing.applianceId, problem: existing.problem,
      repairCost: existing.repairCostCents == null ? "" : (existing.repairCostCents / 100).toFixed(2),
      inspectionFee: existing.inspectionFeeCents == null ? "" : (existing.inspectionFeeCents / 100).toFixed(2),
      additionalCharges: existing.additionalChargesCents == null ? "" : (existing.additionalChargesCents / 100).toFixed(2),
      availability: existing.availability, quoteDate: existing.quoteDate, notes: existing.notes
    } : {
      businessName: biz ? biz.name : "", phone: biz ? biz.phone : "", email: "", website: biz ? biz.website : "",
      address: biz ? biz.address : "", applianceId: preId || "",
      problem: tech ? tech.problem && tech.problem !== "Not provided" ? tech.problem : "" :
        (problemCtx ? [problemCtx.category, problemCtx.description].filter(Boolean).join(" - ") : ""),
      repairCost: "", inspectionFee: "", additionalCharges: "", availability: "", quoteDate: WarrantyChecker.todayString(), notes: ""
    };
    const googleExtra = biz && (typeof biz.rating === "number" || biz.placeId)
      ? { googleRating: biz.rating, googleReviewCount: biz.reviewCount, placeId: biz.placeId } : null;

    // The appliance a quote was saved for may no longer be returned by the API; keep it selectable.
    const opts = appliances.map(a => ({ id: String(a.id), label: applianceLabel(a), a }));
    if (existing && !opts.some(o => o.id === String(existing.applianceId))) {
      opts.push({ id: String(existing.applianceId), label: applianceLabel({ name: existing.applianceName, brand: existing.applianceBrand, model: existing.applianceModel }) + " (no longer in your list)",
        a: { id: existing.applianceId, name: existing.applianceName, brand: existing.applianceBrand, model: existing.applianceModel, type: existing.applianceType } });
    }

    const body = `
      <div id="formMessage" role="status"></div>
      <form id="quoteForm" class="form-card" novalidate>
        <fieldset><legend>Technician Information</legend><div class="form-grid">
          ${input("businessName", "Technician or Business Name", 'maxlength="100" autocomplete="off"', true)}
          ${input("phone", "Phone Number (optional)", 'type="tel" maxlength="25" autocomplete="off"')}
          ${input("email", "Email Address (optional)", 'type="email" maxlength="254" autocomplete="off"')}
          ${input("website", "Website (optional)", 'maxlength="200" autocomplete="off" placeholder="example.com"')}
          <div style="grid-column:1/-1">${input("address", "Business Address (optional)", 'maxlength="200" autocomplete="off"')}</div>
        </div></fieldset>
        <fieldset><legend>Appliance Information</legend><div class="form-grid">
          <div class="form-field"><label for="applianceId">Select Appliance <span class="req">*</span></label>
            <select id="applianceId"><option value="">Select appliance</option>
              ${opts.map(o => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join("")}</select>
            <div class="field-error" id="err-applianceId" role="alert"></div></div>
          <div class="form-field"><label>Brand and model</label><div class="readonly-box" id="applianceInfo">Select an appliance</div></div>
          <div class="form-field" style="grid-column:1/-1"><label for="problem">Problem Description</label>
            <textarea id="problem" rows="3" maxlength="${MAX.text}"></textarea>
            <div class="field-error" id="err-problem" role="alert"></div></div>
        </div></fieldset>
        <fieldset><legend>Quote Information (CAD)</legend><div class="form-grid">
          ${moneyInput("repairCost", "Estimated Repair Cost", true)}
          ${moneyInput("inspectionFee", "Inspection or Diagnostic Fee", false)}
          ${moneyInput("additionalCharges", "Additional Charges", false)}
          <div class="form-field"><label>Estimated Total Cost</label><div class="readonly-box total-box" id="totalBox">—</div></div>
          ${input("availability", "Availability or Estimated Repair Date (optional)", 'maxlength="100" autocomplete="off" placeholder="e.g. Next Tuesday"')}
          ${input("quoteDate", "Quote Date", 'type="date" max="' + WarrantyChecker.todayString() + '"', true)}
          <div class="form-field" style="grid-column:1/-1"><label for="notes">Notes (optional)</label>
            <textarea id="notes" rows="3" maxlength="${MAX.text}"></textarea>
            <div class="field-error" id="err-notes" role="alert"></div></div>
        </div></fieldset>
        <div class="form-actions">
          <a class="btn" href="#/technician-quotes" id="cancelBtn">Cancel</a>
          <button type="submit" class="btn btn-primary" id="saveBtn">${editId ? "Save Changes" : "Save Quote"}</button>
        </div>
      </form>`;
    shell(root, title, SUB, body, back);

    const $ = s => root.querySelector(s);
    FIELDS.forEach(f => { $("#" + f).value = init[f] == null ? "" : init[f]; });
    if (!opts.some(o => o.id === String($("#applianceId").value))) $("#applianceId").value = "";

    const selected = () => opts.find(o => o.id === $("#applianceId").value);

    function refresh() {
      const o = selected();
      $("#applianceInfo").textContent = o ? ([o.a.brand, o.a.model].filter(Boolean).join(" · ") || "Brand and model not provided") : "Select an appliance";
      const rc = RepairVsReplace.parseMoney($("#repairCost").value, true);
      const fee = RepairVsReplace.parseMoney($("#inspectionFee").value, false);
      const add = RepairVsReplace.parseMoney($("#additionalCharges").value, false);
      $("#totalBox").textContent = rc.error || fee.error || add.error ? "—" : cad(rc.cents + fee.cents + add.cents);
    }
    ["applianceId", "repairCost", "inspectionFee", "additionalCharges"].forEach(i => {
      $("#" + i).addEventListener("input", refresh); $("#" + i).addEventListener("change", refresh);
    });
    refresh();

    let saving = false;
    $("#quoteForm").addEventListener("submit", e => {
      e.preventDefault();
      if (saving) return;
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
        const q = buildQuote(values, selected().a, userId, existing, googleExtra);
        if (existing) QuoteStore.update(userId, q); else QuoteStore.add(userId, q);
        ui.flash = existing ? "Quote from " + q.businessName + " was updated." : "Quote from " + q.businessName + " was saved.";
        Navigation.go("technician-quotes");
      } catch (err) {
        $("#formMessage").innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
        saving = false;
        $("#saveBtn").disabled = false; $("#saveBtn").textContent = editId ? "Save Changes" : "Save Quote";
      }
    });
  }

  // ---------- entry point ----------
  function render(root, params) {
    const userId = Auth.getUserId();
    if (!userId) {
      shell(root, "Technician Quotes", SUB, notice("🔒", "Sign-in required",
        "Quotes are saved per signed-in user. Login is not implemented yet, so no user could be identified and no quotes are shown or saved."));
      return;
    }
    const mode = params.get("mode");
    if (mode === "add" || mode === "edit" || params.get("id")) renderForm(root, params, userId);
    else renderList(root, userId);
  }

  return { render, validate, buildQuote, summarize, filterSort, lowestTotalIds, normalizeWebsite, totalCents, COMPARE_NOTE };
})();

if (typeof module !== "undefined") module.exports = TechnicianQuotes;
