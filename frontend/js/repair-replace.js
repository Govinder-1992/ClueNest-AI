// Repair vs Replace screen. A transparent, rule-based cost comparison. No AI, no backend calls of its own.
const RepairVsReplace = (() => {
  const MAX_CENTS = 1000000000; // CAD 10,000,000
  const DISCLAIMER = "This is a cost-based estimate, not a guarantee. The final decision is yours.";
  const REC = {
    repair: "Repair may be the better financial option.",
    replace: "Replacement may be the better financial option.",
    close: "Costs are close; consider appliance condition and expected lifespan."
  };

  // ---------- pure logic (also used by tests) ----------
  const cad = cents => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);

  // Converts user text to whole cents. Returns { cents } or { error }.
  function parseMoney(text, required) {
    const s = String(text == null ? "" : text).trim();
    if (s === "") return required ? { error: "Enter an amount." } : { cents: 0 };
    if (/^-/.test(s)) return { error: "Cost cannot be negative." };
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: "Enter a valid amount in CAD, with at most 2 decimal places." };
    const cents = Math.round(Number(s) * 100);
    if (cents > MAX_CENTS) return { error: "That amount is too large." };
    return { cents };
  }

  const FIELDS = [
    { id: "repairCost", required: true, label: "Estimated repair cost" },
    { id: "inspectionFee", required: false, label: "Technician inspection fee" },
    { id: "additionalExpenses", required: false, label: "Additional repair expenses" },
    { id: "previousRepairs", required: false, label: "Previous repair costs" },
    { id: "replacementPrice", required: true, label: "Estimated price of a replacement appliance" },
    { id: "deliveryInstall", required: false, label: "Estimated delivery and installation cost" },
    { id: "disposal", required: false, label: "Estimated removal/disposal cost" }
  ];

  // Returns { errors, values } where values are cents keyed by field id.
  function validate(raw) {
    const errors = {}, values = {};
    FIELDS.forEach(f => {
      const r = parseMoney(raw[f.id], f.required);
      if (r.error) errors[f.id] = r.error; else values[f.id] = r.cents;
    });
    if (!errors.replacementPrice && values.replacementPrice === 0) {
      errors.replacementPrice = "The replacement price must be more than $0.";
    }
    return { errors, values };
  }

  // Age as { years, months, days, decimalYears } or null when the purchase date is missing, invalid or in the future.
  function applianceAge(purchaseDate, today) {
    const p = WarrantyChecker.dateOnly(purchaseDate);
    today = today || WarrantyChecker.todayString();
    if (!p || p > today) return null;
    const d = WarrantyChecker.diffYMD(p, today);
    return Object.assign(d, { decimalYears: d.years + d.months / 12 + d.days / 365 });
  }

  function ageText(age) {
    if (!age) return "Unknown";
    if (!age.years && !age.months) return age.days === 1 ? "1 day" : age.days + " days";
    const parts = [];
    if (age.years) parts.push(age.years + (age.years === 1 ? " year" : " years"));
    if (age.months) parts.push(age.months + (age.months === 1 ? " month" : " months"));
    return parts.join(", ");
  }

  // Share of the replacement cost at which repair stops being clearly worthwhile, by appliance age.
  function limitPercent(age) {
    if (!age) return 50;
    if (age.decimalYears < 5) return 50;
    if (age.decimalYears < 10) return 40;
    return 30;
  }

  // v: cents by field id. age: result of applianceAge. All arithmetic is in whole cents.
  function compare(v, age) {
    const repairTotal = v.repairCost + v.inspectionFee + v.additionalExpenses;
    const replaceTotal = v.replacementPrice + v.deliveryInstall + v.disposal;
    const cumulative = repairTotal + v.previousRepairs;
    const limit = limitPercent(age);
    const lower = limit - 10, upper = limit + 10;
    let kind;
    if (cumulative * 100 < lower * replaceTotal) kind = "repair";
    else if (cumulative * 100 > upper * replaceTotal) kind = "replace";
    else kind = "close";
    const sharePct = Math.round((cumulative / replaceTotal) * 1000) / 10;
    return { repairTotal, replaceTotal, cumulative, difference: replaceTotal - repairTotal,
      limit, lower, upper, sharePct, kind, recommendation: REC[kind] };
  }

  // ---------- UI ----------
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const fmtDate = ds => ds ? new Date(ds + "T00:00:00").toLocaleDateString(undefined,
    { year: "numeric", month: "short", day: "numeric" }) : "Not provided";

  function money(id, label, required, hint) {
    return `<div class="form-field">
      <label for="${id}">${esc(label)}${required ? ' <span class="req">*</span>' : " (optional)"}</label>
      <div class="money"><span class="money-prefix">CAD $</span>
        <input id="${id}" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" /></div>
      ${hint ? `<small class="muted">${esc(hint)}</small>` : ""}
      <div class="field-error" id="err-${id}" role="alert"></div></div>`;
  }

  function shell(root, id, body) {
    root.innerHTML = `
      <div class="back-links">
        ${id ? `<a class="back-link" href="#/warranty-checker?id=${encodeURIComponent(id)}">← Back to Warranty Checker</a>` : ""}
        <a class="back-link" href="#/appliances">← Back to My Appliances</a>
      </div>
      <div class="page-header"><div>
        <h1>Repair vs Replace</h1>
        <p class="subtitle">Make a smarter decision before spending money on your appliance.</p>
      </div></div>${body}`;
  }

  function notice(icon, title, text, extra) {
    return `<div class="state-box"><div class="state-icon">${icon}</div><h2>${esc(title)}</h2>
      <p>${esc(text)}</p>${extra || ""}</div>`;
  }

  function row(label, value, wide) {
    return `<div${wide ? ' style="grid-column:1/-1"' : ""}><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  }

  function resultHtml(c, v, age) {
    const prevShown = v.previousRepairs > 0 ? cad(v.previousRepairs) : "None entered (Repair History is not connected yet)";
    const diffText = c.difference === 0 ? "The two totals are the same."
      : c.difference > 0 ? "Repairing costs " + cad(c.difference) + " less than replacing."
      : "Replacing costs " + cad(-c.difference) + " less than repairing.";
    const reasons = [
      `Repair spending of ${cad(c.cumulative)} (this repair${v.previousRepairs ? " plus previous repairs" : ""}) is ${c.sharePct}% of the replacement cost of ${cad(c.replaceTotal)}.`,
      age
        ? `Appliance age is ${ageText(age)}. For this age, repair is treated as clearly worthwhile below ${c.lower}% of the replacement cost, and replacement as clearly worthwhile above ${c.upper}%. In between, the costs are considered close.`
        : `The appliance age is unknown, so the standard thresholds were used: repair below ${c.lower}%, replacement above ${c.upper}%, close in between.`,
      "Expected remaining lifespan and energy efficiency were not used, because no reliable information is available for them."
    ];
    return `
      <section class="result-block"><h2>Your Cost Comparison</h2>
        <dl class="meta">
          ${row("Total estimated repair cost", cad(c.repairTotal))}
          ${row("Total estimated replacement cost", cad(c.replaceTotal))}
          ${row("Difference", diffText, true)}
          ${row("Appliance age", ageText(age))}
          ${row("Previous repair expenses", prevShown)}
        </dl>
        <p class="muted">Repair: ${cad(v.repairCost)} repair + ${cad(v.inspectionFee)} inspection + ${cad(v.additionalExpenses)} additional.
          Replacement: ${cad(v.replacementPrice)} appliance + ${cad(v.deliveryInstall)} delivery/installation + ${cad(v.disposal)} removal/disposal.</p>
      </section>
      <section class="result-block reco reco-${c.kind}"><h2>${esc(c.recommendation)}</h2>
        <p>Why:</p><ul class="result-list">${reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul>
      </section>
      <p class="disclaimer">${esc(DISCLAIMER)}</p>
      <div class="decision"><h2>What would you like to do next?</h2>
        <div class="decision-buttons">
          <button class="btn btn-primary" id="techBtn">👷 Find Technician</button>
          <button class="btn" id="replaceBtn">🛒 Register Replacement</button>
        </div></div>`;
  }

  async function render(root, params) {
    const id = params.get("id");
    if (!id) {
      shell(root, null, notice("📦", "No appliance selected",
        "Open this screen from the Warranty Checker or from an appliance card.",
        '<a class="btn btn-primary" href="#/appliances">Go to My Appliances</a>'));
      return;
    }

    const myHash = location.hash;
    shell(root, id, `<div class="state-box"><div class="spinner"></div><p>Loading appliance details…</p></div>`);
    let appliance;
    try { appliance = await WarrantyChecker.loadAppliance(id); }
    catch (e) {
      if (location.hash !== myHash) return;
      shell(root, id, notice("⚠️", "Couldn't load the appliance", e.message,
        '<button class="btn" id="retryBtn">Retry</button>'));
      root.querySelector("#retryBtn").addEventListener("click", () => render(root, params));
      return;
    }
    if (location.hash !== myHash) return;
    if (!appliance) {
      shell(root, id, notice("🔒", "Appliance details unavailable",
        "The API is not connected or you are not signed in, so the appliance could not be loaded.",
        '<a class="btn" href="#/appliances">Back to My Appliances</a>'));
      return;
    }

    const age = applianceAge(appliance.purchaseDate);
    const w = WarrantyChecker.computeWarranty(appliance);
    const problem = Navigation.getProblemContext(id);
    const wc = Navigation.getWarrantyContext(id);
    const problemText = problem
      ? [problem.category, problem.errorCode ? "Error code " + problem.errorCode : "", problem.description].filter(Boolean).join(" - ")
      : "Not provided";

    shell(root, id, `
      <div class="card selected-card">
        <div class="card-head">
          <div class="appliance-icon">${iconFor(appliance)}</div>
          <div class="card-title"><h3>${esc(appliance.name || "Unnamed appliance")}</h3></div>
          <span class="badge badge-${w.status.toLowerCase().replace(/\s+/g, "-")}">${esc(w.status)}</span>
        </div>
        <dl class="meta">
          ${row("Brand", appliance.brand || "Not provided")}
          ${row("Model", appliance.model || "Not provided")}
          ${row("Purchased", fmtDate(w.purchase))}
          ${row("Appliance age", ageText(age))}
          ${row("Warranty status", w.status + (wc ? " (decision: " + wc.decision + ")" : ""))}
          ${row("Problem", problemText, true)}
        </dl>
      </div>
      <form id="rrForm" novalidate>
        <div class="compare-grid">
          <section class="form-card option-card"><h2>Option A: Repair Your Appliance</h2>
            ${money("repairCost", "Estimated repair cost", true)}
            ${money("inspectionFee", "Technician inspection fee", false)}
            ${money("additionalExpenses", "Additional repair expenses", false)}
            ${money("previousRepairs", "Previous repair costs", false,
              "Repair History is not available yet. Enter the total if you know it.")}
          </section>
          <section class="form-card option-card"><h2>Option B: Replace Your Appliance</h2>
            ${money("replacementPrice", "Estimated price of a replacement appliance", true)}
            ${money("deliveryInstall", "Estimated delivery and installation cost", false)}
            ${money("disposal", "Estimated removal/disposal cost", false)}
          </section>
        </div>
        <p class="muted">All amounts are in Canadian dollars (CAD).</p>
        <div class="form-actions" style="max-width:900px;margin-top:12px">
          <button type="submit" class="btn btn-primary btn-lg" id="compareBtn">Compare Repair vs Replace</button>
        </div>
      </form>
      <div id="results"></div>`);

    const $ = s => root.querySelector(s);
    const ids = FIELDS.map(f => f.id);

    // Changing an estimate hides the old result so a stale comparison is never passed on.
    ids.forEach(i => $("#" + i).addEventListener("input", () => { $("#results").innerHTML = ""; }));

    $("#rrForm").addEventListener("submit", e => {
      e.preventDefault();
      const raw = Object.fromEntries(ids.map(i => [i, $("#" + i).value]));
      const { errors, values } = validate(raw);
      ids.forEach(i => {
        $("#err-" + i).textContent = errors[i] || "";
        $("#" + i).classList.toggle("invalid", Boolean(errors[i]));
      });
      const first = ids.find(i => errors[i]);
      if (first) { $("#results").innerHTML = ""; $("#" + first).focus(); return; }

      const c = compare(values, age);
      $("#results").innerHTML = resultHtml(c, values, age);

      const base = { applianceId: appliance.id, estimatedRepairCost: c.repairTotal / 100,
        estimatedReplacementCost: c.replaceTotal / 100, previousRepairCost: values.previousRepairs / 100,
        recommendation: c.recommendation, currency: "CAD" };
      $("#techBtn").addEventListener("click", () => {
        Navigation.setRepairContext(Object.assign({ decision: "Repair" }, base));
        Navigation.selectAppliance(appliance);
        Navigation.go("find-technician", appliance.id);
      });
      $("#replaceBtn").addEventListener("click", () => {
        Navigation.setRepairContext(Object.assign({ decision: "Replace" }, base));
        Navigation.selectAppliance(appliance);
        Navigation.go("register-replacement", appliance.id);
      });
      $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return { render, parseMoney, validate, applianceAge, ageText, compare, cad, limitPercent, REC, DISCLAIMER };
})();

if (typeof module !== "undefined") module.exports = RepairVsReplace;
