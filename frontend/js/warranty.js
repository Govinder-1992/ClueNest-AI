// Warranty Checker screen. Uses only the appliance data returned by the API.
const WarrantyChecker = (() => {
  const MAX_RESPONSE = 1000;
  const INFO = "Warranty coverage depends on the manufacturer's terms, appliance condition and type of fault. Please confirm coverage with the manufacturer or retailer.";
  const COVERED_MSG = "Your manufacturer or warranty provider has indicated that this issue is covered.";

  // ---------- pure logic (also used by tests) ----------
  function pad(n) { return String(n).padStart(2, "0"); }

  function todayString() {
    const d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  // Accepts "YYYY-MM-DD" or an ISO timestamp. Returns "YYYY-MM-DD" or null.
  function dateOnly(s) {
    if (typeof s !== "string") return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(s.trim());
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    const ok = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
    return ok ? m[1] + "-" + m[2] + "-" + m[3] : null;
  }

  // Whole years, 0 for "no warranty", or null when missing/unrecognised.
  function parseYears(v) {
    if (typeof v === "number") return Number.isInteger(v) && v >= 0 ? v : null;
    if (typeof v !== "string") return null;
    const s = v.trim();
    if (/^\d+$/.test(s)) return Number(s);
    if (/^(no warranty|none)$/i.test(s)) return 0;
    const m = /^(\d+)\s*(years?|yrs?)$/i.exec(s);
    return m ? Number(m[1]) : null;
  }

  // Calendar difference from -> to (both YYYY-MM-DD, to >= from): whole months first, then leftover days.
  function diffYMD(from, to) {
    const [fy, fm, fd] = from.split("-").map(Number);
    const [ty, tm, td] = to.split("-").map(Number);
    const dayNum = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000;
    // from + n months, clamped to the end of that month (31 Jan + 1 month = 28/29 Feb)
    const addMonths = n => {
      const idx = fy * 12 + (fm - 1) + n;
      const y = Math.floor(idx / 12), m = (idx % 12) + 1;
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return [y, m, Math.min(fd, last)];
    };
    let n = (ty - fy) * 12 + (tm - fm);
    let c = addMonths(n);
    if (dayNum(...c) > dayNum(ty, tm, td)) { n -= 1; c = addMonths(n); }
    return { years: Math.floor(n / 12), months: n % 12, days: dayNum(ty, tm, td) - dayNum(...c) };
  }
  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

  function remainingText(today, expiry) {
    if (expiry === today) return "Expires today";
    const r = diffYMD(today, expiry);
    const parts = [];
    if (r.years) parts.push(plural(r.years, "year"));
    if (r.months) parts.push(plural(r.months, "month"));
    if (r.days || !parts.length) parts.push(plural(r.days, "day"));
    return parts.join(", ");
  }

  function durationText(years) {
    if (years === null) return "Not provided";
    if (years === 0) return "No warranty";
    return plural(years, "year");
  }

  // Works out the warranty facts and date-based status for an appliance.
  function computeWarranty(a, today) {
    today = today || todayString();
    const purchase = dateOnly(a.purchaseDate);
    const start = dateOnly(a.warrantyStart);
    const hasExpiry = typeof a.warrantyExpiry === "string" && a.warrantyExpiry.trim() !== "";
    let expiry = dateOnly(a.warrantyExpiry);
    let years = parseYears(a.warrantyYears);
    let derived = false;
    const out = { purchase, start, provider: a.warrantyProvider || "", expiry: null, expiryDerived: false,
      years, status: "Unknown", remaining: "", problem: "" };

    if (hasExpiry && !expiry) { out.problem = "The warranty expiry date is not a valid date."; return out; }

    if (years === 0) {
      if (hasExpiry) { out.problem = "The warranty details conflict (no warranty, but an expiry date exists)."; return out; }
      out.status = "No Warranty";
      return out;
    }

    if (!expiry) {
      if (purchase && years > 0) {
        expiry = AddAppliance.calcExpiry(purchase, years);
        derived = Boolean(expiry);
      }
      if (!expiry) { out.problem = "Warranty information is missing."; return out; }
    }

    if (purchase && expiry < purchase) { out.problem = "The warranty expiry date is before the purchase date."; return out; }

    // Show a duration when the API did not give one but the dates make it exact.
    if (years === null && purchase) {
      for (let y = 1; y <= 50; y++) {
        if (AddAppliance.calcExpiry(purchase, y) === expiry) { years = y; break; }
      }
    }

    out.years = years;
    out.expiry = expiry;
    out.expiryDerived = derived;
    out.status = expiry >= today ? "Active" : "Expired";
    if (out.status === "Active") out.remaining = remainingText(today, expiry);
    return out;
  }

  // ---------- UI ----------
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const fmt = ds => ds ? new Date(ds + "T00:00:00").toLocaleDateString(undefined,
    { year: "numeric", month: "short", day: "numeric" }) : "Not provided";

  function badge(status) {
    return `<span class="badge badge-${status.toLowerCase().replace(/\s+/g, "-")}">${esc(status)}</span>`;
  }

  function row(label, value) {
    return `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  }

  function shell(root, id, body) {
    root.innerHTML = `
      <div class="back-links">
        <a class="back-link" href="#/appliances">← Back to My Appliances</a>
        ${id ? `<a class="back-link" href="#/report-problem?id=${encodeURIComponent(id)}">← Back to AI Troubleshooting</a>` : ""}
      </div>
      <div class="page-header"><div>
        <h1>Warranty Checker</h1>
        <p class="subtitle">Check your appliance warranty details and understand your next steps.</p>
      </div></div>${body}`;
  }

  function notice(icon, title, text, extra) {
    return `<div class="state-box"><div class="state-icon">${icon}</div><h2>${esc(title)}</h2>
      <p>${esc(text)}</p>${extra || ""}</div>`;
  }

  // Fresh data from the API when signed in; otherwise the copy saved when the user chose the appliance.
  async function loadAppliance(id) {
    if (Auth.isConfigured() && Auth.isAuthenticated()) {
      const all = await Api.getAppliances();
      const found = all.map(normalize).find(a => String(a.id) === String(id));
      if (!found) throw new ApiError("http", "That appliance was not found in your account.");
      Navigation.selectAppliance(found);
      return found;
    }
    return Navigation.getSelectedAppliance(id);
  }

  async function render(root, params) {
    const id = params.get("id");
    if (!id) {
      shell(root, null, notice("📦", "No appliance selected",
        "Open this screen from an appliance card or from AI Troubleshooting.",
        '<a class="btn btn-primary" href="#/appliances">Go to My Appliances</a>'));
      return;
    }

    const myHash = location.hash;
    shell(root, id, `<div class="state-box"><div class="spinner"></div><p>Loading appliance details…</p></div>`);
    let appliance;
    try { appliance = await loadAppliance(id); }
    catch (e) {
      if (location.hash !== myHash) return;
      shell(root, id, notice("⚠️", "Couldn't load the appliance", e.message,
        '<button class="btn" id="retryBtn">Retry</button>'));
      root.querySelector("#retryBtn").addEventListener("click", () => render(root, params));
      return;
    }
    if (location.hash !== myHash) return; // user navigated away while loading
    if (!appliance) {
      shell(root, id, notice("🔒", "Appliance details unavailable",
        "The API is not connected or you are not signed in, so the appliance could not be loaded.",
        '<a class="btn" href="#/appliances">Back to My Appliances</a>'));
      return;
    }

    const w = computeWarranty(appliance);
    const problem = Navigation.getProblemContext(id);

    const expiryNote = w.expiryDerived ? " (calculated from purchase date and duration)" : "";
    const missing = w.status === "Unknown"
      ? `<div class="alert alert-info">${esc(w.problem || "Warranty information is missing.")} The status is shown as Unknown. Check your receipt or contact the retailer.</div>` : "";

    const problemHtml = problem ? `<section class="result-block"><h2>Reported problem</h2>
      <ul class="result-list">
        <li><b>Category:</b> ${esc(problem.category)}</li>
        ${problem.errorCode ? `<li><b>Error code:</b> ${esc(problem.errorCode)}</li>` : ""}
        ${problem.description ? `<li><b>Description:</b> ${esc(problem.description)}</li>` : ""}
      </ul></section>` : "";

    shell(root, id, `
      <div class="card selected-card">
        <div class="card-head">
          <div class="appliance-icon">${iconFor(appliance)}</div>
          <div class="card-title"><h3>${esc(appliance.name || "Unnamed appliance")}</h3></div>
          ${badge(w.status)}
        </div>
        <dl class="meta">
          ${row("Brand", appliance.brand || "Not provided")}
          ${row("Model", appliance.model || "Not provided")}
          ${row("Purchased", fmt(w.purchase))}
          ${row("Warranty duration", durationText(w.years))}
          ${row("Warranty expiry", fmt(w.expiry) + expiryNote)}
        </dl>
      </div>
      ${missing}
      <section class="result-block"><h2>Warranty Overview</h2>
        <dl class="meta">
          ${row("Status", w.status)}
          ${row("Purchase date", fmt(w.purchase))}
          ${row("Warranty start date", fmt(w.start))}
          ${row("Warranty expiry date", fmt(w.expiry) + expiryNote)}
          ${row("Remaining warranty", w.status === "Active" ? w.remaining : "Not applicable")}
          ${row("Warranty provider", w.provider || "Not provided")}
        </dl>
        <div class="alert alert-info" style="margin:0">An active warranty date does not guarantee that a particular fault is covered. ${esc(INFO)}</div>
      </section>
      ${problemHtml}
      <section class="result-block"><h2>Warranty response</h2>
        <div class="form-field"><label for="wResponse">Describe the warranty response (optional)</label>
          <textarea id="wResponse" rows="4" maxlength="${MAX_RESPONSE}" placeholder="Enter any information received from the manufacturer or retailer."></textarea></div>
      </section>
      <div class="decision"><h2>What did the manufacturer or retailer say?</h2>
        <div class="decision-buttons">
          <button class="btn btn-success" id="coveredBtn">Covered</button>
          <button class="btn btn-warn" id="notCoveredBtn">Not Covered</button>
        </div>
        <div id="decisionMsg" role="status"></div>
      </div>`);

    const $ = s => root.querySelector(s);
    const responseText = () => $("#wResponse").value.trim();

    $("#coveredBtn").addEventListener("click", () => {
      Navigation.setWarrantyContext({ applianceId: appliance.id, status: w.status, decision: "Covered", response: responseText() });
      // No repair-history API exists yet, so nothing is saved to the backend.
      $("#decisionMsg").innerHTML = `<div class="alert alert-success">${esc(COVERED_MSG)}
        <br><small>No manufacturer claim has been submitted, and this decision was not saved because repair history is not available yet.</small>
        <br><a class="btn" style="margin-top:10px" href="#/appliances">Back to My Appliances</a></div>`;
    });

    $("#notCoveredBtn").addEventListener("click", () => {
      Navigation.setWarrantyContext({ applianceId: appliance.id, status: w.status, decision: "Not Covered", response: responseText() });
      Navigation.selectAppliance(appliance);
      Navigation.go("repair-vs-replace", appliance.id);
    });
  }

  return { render, loadAppliance, todayString, computeWarranty, dateOnly, parseYears, diffYMD, remainingText, COVERED_MSG, INFO };
})();

if (typeof module !== "undefined") module.exports = WarrantyChecker;
