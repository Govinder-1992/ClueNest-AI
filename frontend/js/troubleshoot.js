// AI Troubleshooting screen. Results come only from POST /troubleshoot.
const Troubleshoot = (() => {
  const CATEGORIES = ["Not Turning On", "Making Unusual Noise", "Not Cooling or Heating",
    "Leaking Water", "Not Draining", "Not Working Properly", "Error Code", "Other"];
  const MAX_DESC = 2000;
  const DEMO_LABEL = "Demo Mode \u2014 Not AI-generated";
  const DISCLAIMER = "These suggestions are for general guidance only. Disconnect power or stop using the appliance when it is unsafe to continue. Contact a qualified technician when necessary.";

  let running = false;
  let session = 0; // incremented on each render so stale async results are ignored

  // ---------- pure logic (also used by tests) ----------
  function validate(v, appliance) {
    const errors = {};
    if (!appliance || !appliance.id) errors.appliance = "No appliance is selected.";
    if (!v.category) errors.category = "Select a problem category.";
    else if (!CATEGORIES.includes(v.category)) errors.category = "Select a category from the list.";
    const desc = v.description.trim();
    if (desc.length > MAX_DESC) errors.description = "Keep the description under " + MAX_DESC + " characters.";
    else if (v.category === "Other" && !desc) errors.description = "Describe the problem when you choose Other.";
    if (v.category === "Error Code" && !v.errorCode.trim()) errors.errorCode = "Enter the error code shown on the appliance.";
    return errors;
  }

  function buildPayload(v, appliance) {
    const p = { applianceId: appliance.id, category: v.category, description: v.description.trim() };
    if (v.errorCode.trim()) p.errorCode = v.errorCode.trim();
    return p;
  }

  function toText(item) {
    if (item == null) return "";
    if (typeof item === "string") return item.trim();
    if (typeof item === "object") {
      const t = item.description ?? item.text ?? item.step ?? item.cause ?? item.title ?? item.message ?? "";
      return String(t).trim();
    }
    return String(item).trim();
  }

  function toList(v) {
    if (Array.isArray(v)) return v.map(toText).filter(Boolean);
    if (typeof v === "string" && v.trim()) return [v.trim()];
    return [];
  }

  // Turns whatever the backend returns into one predictable shape.
  function parseResult(raw) {
    let d = raw;
    if (d && typeof d.body === "string") { try { d = JSON.parse(d.body); } catch (e) { /* keep raw */ } }
    if (!d || typeof d !== "object") d = {};
    if (d.result && typeof d.result === "object") d = Object.assign({}, d, d.result);

    const modeText = String(d.mode ?? d.source ?? d.provider ?? "");
    const flag = d.hazardDetected ?? d.hazard ?? d.isHazard ?? d.unsafe ?? d.safetyHazard;
    const hazard = flag === true || /^(true|yes)$/i.test(String(flag));
    const safetyMessage = toText(d.safetyResponse ?? d.safetyMessage ?? "");
    const warnings = toList(d.safetyWarnings ?? d.warnings ?? d.safety);
    if (safetyMessage && !warnings.includes(safetyMessage)) warnings.unshift(safetyMessage);

    const res = {
      mock: d.mock === true || /mock/i.test(modeText),
      bedrockConfirmed: !/mock/i.test(modeText) && d.mock !== true && /bedrock/i.test(modeText),
      mode: modeText,
      hazard,
      warnings,
      causes: toList(d.possibleCauses ?? d.causes),
      steps: toList(d.recommendedSolutions ?? d.solutions ?? d.steps ?? d.recommendedSteps),
      // Optional extras. Only the demo (mock) answers send them today.
      summary: toText(d.summary),
      repairVsReplace: toText(d.repairVsReplace)
    };
    res.empty = !res.hazard && !res.warnings.length && !res.causes.length && !res.steps.length;
    return res;
  }

  // ---------- UI ----------
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function list(items, ordered) {
    const tag = ordered ? "ol" : "ul";
    return `<${tag} class="result-list">${items.map(i => `<li>${esc(i)}</li>`).join("")}</${tag}>`;
  }

  function resultHtml(r) {
    let html = "";
    if (r.mock) {
      html += `<div class="alert alert-info"><b>${esc(DEMO_LABEL)}.</b> These are ready-made examples for this type of appliance and problem. They were not written by an AI model or for your exact appliance, and no AI service was used.</div>`;
    } else if (!r.bedrockConfirmed) {
      html += `<div class="alert alert-info">The backend did not confirm which AI model produced this answer.</div>`;
    }

    if (r.hazard) {
      html += `<section class="result-block safety-block"><h2>⚠️ Safety Response</h2>
        ${r.warnings.length ? list(r.warnings, false) : "<p>A possible safety hazard was detected.</p>"}
        <p><b>Do not attempt a DIY repair.</b> Stop using the appliance and contact a qualified technician.</p></section>`;
    } else {
      if (r.summary) {
        html += `<p class="result-summary"><b>${esc(r.summary)}</b></p>`;
      }
      if (r.warnings.length) {
        html += `<section class="result-block safety-block"><h2>⚠️ Safety Warnings</h2>${list(r.warnings, false)}</section>`;
      }
      if (r.causes.length) {
        html += `<section class="result-block"><h2>Possible Causes</h2>${list(r.causes, false)}</section>`;
      }
      if (r.steps.length) {
        html += `<section class="result-block"><h2>Recommended Solutions</h2>${list(r.steps, true)}</section>`;
      }
      if (r.repairVsReplace) {
        html += `<section class="result-block"><h2>Repair or Replace?</h2><p>${esc(r.repairVsReplace)}</p></section>`;
      }
      if (r.empty) {
        html += `<div class="alert alert-error">The service returned no guidance for this problem. Please try again or contact a technician.</div>`;
      }
    }
    html += `<p class="disclaimer">${esc(DISCLAIMER)}</p>`;

    if (!r.empty || r.hazard) {
      html += `<div class="decision">
        <h2>Did this solve the problem?</h2>
        <div class="decision-buttons">
          ${r.hazard ? "" : '<button class="btn btn-success" id="fixedBtn">✔ Problem Fixed</button>'}
          <button class="btn btn-warn" id="stillBtn">✖ Still Problem</button>
          <button class="btn" id="warrantyBtn">🛡️ Check Warranty</button>
        </div>
        <div id="decisionMsg" role="status"></div></div>`;
    }
    return html;
  }

  function applianceCard(a) {
    const status = warrantyStatus(a);
    return `<div class="card selected-card">
      <div class="card-head">
        <div class="appliance-icon">${iconFor(a)}</div>
        <div class="card-title"><h3>${esc(a.name || "Unnamed appliance")}</h3></div>
        <span class="badge badge-${status.toLowerCase()}">${status}</span>
      </div>
      <dl class="meta">
        <div><dt>Brand</dt><dd>${esc(a.brand || "Not provided")}</dd></div>
        <div><dt>Model</dt><dd>${esc(a.model || "Not provided")}</dd></div>
        <div><dt>Purchased</dt><dd>${esc(formatDate(a.purchaseDate))}</dd></div>
        <div><dt>Warranty status</dt><dd>${status}</dd></div>
      </dl></div>`;
  }

  async function loadAppliance(id) {
    const stored = Navigation.getSelectedAppliance(id);
    if (stored) return stored;
    // Opened directly (e.g. page refresh): fetch from the API by ID.
    const all = await Api.getAppliances();
    const found = all.map(normalize).find(a => String(a.id) === String(id));
    if (!found) throw new ApiError("http", "That appliance was not found in your account.");
    Navigation.selectAppliance(found);
    return found;
  }

  function shell(root, body) {
    root.innerHTML = `
      <a class="back-link" href="#/appliances">← Back to My Appliances</a>
      <div class="page-header"><div>
        <h1>AI Appliance Troubleshooting</h1>
        <p class="subtitle">Let's understand what's wrong with your appliance and find a safe solution.</p>
      </div></div>${body}`;
  }

  async function render(root, params) {
    running = false;
    const me = ++session;
    const id = params.get("id");

    if (!id) {
      shell(root, `<div class="state-box"><div class="state-icon">📦</div><h2>No appliance selected</h2>
        <p>Open this screen from the Report a Problem button on an appliance card.</p>
        <a class="btn btn-primary" href="#/appliances">Go to My Appliances</a></div>`);
      return;
    }

    shell(root, `<div class="state-box"><div class="spinner"></div><p>Loading appliance…</p></div>`);
    let appliance = Navigation.getSelectedAppliance(id);
    if (!appliance) {
      if (!Auth.isConfigured() || !Auth.isAuthenticated()) {
        shell(root, `<div class="state-box"><div class="state-icon">🔒</div><h2>Appliance details unavailable</h2>
          <p>The API is not connected or you are not signed in, so the appliance could not be loaded.</p>
          <a class="btn" href="#/appliances">Back to My Appliances</a></div>`);
        return;
      }
      try { appliance = await loadAppliance(id); }
      catch (e) {
        if (me !== session) return;
        shell(root, `<div class="state-box"><div class="state-icon">⚠️</div><h2>Couldn't load the appliance</h2>
          <p>${esc(e.message)}</p><button class="btn" id="reloadBtn">Try again</button></div>`);
        root.querySelector("#reloadBtn").addEventListener("click", () => render(root, params));
        return;
      }
      if (me !== session) return;
    }

    const catOpts = '<option value="">Select category</option>' +
      CATEGORIES.map(c => `<option>${esc(c)}</option>`).join("");
    shell(root, `
      ${applianceCard(appliance)}
      <form id="tsForm" class="form-card" novalidate>
        <fieldset><legend>Describe Your Problem</legend>
          <div class="form-grid">
            <div class="form-field"><label for="category">Select Problem Category <span class="req">*</span></label>
              <select id="category">${catOpts}</select><div class="field-error" id="err-category" role="alert"></div></div>
            <div class="form-field"><label for="errorCode">Error Code (optional)</label>
              <input id="errorCode" maxlength="50" autocomplete="off" /><div class="field-error" id="err-errorCode" role="alert"></div></div>
          </div>
          <div class="form-field" style="margin-top:16px"><label for="description">Describe the Problem</label>
            <textarea id="description" rows="5" maxlength="${MAX_DESC}" placeholder="Describe what is happening with your appliance. Include any unusual sounds, error messages or symptoms."></textarea>
            <div class="field-error" id="err-description" role="alert"></div></div>
        </fieldset>
        <div class="form-actions"><button type="submit" class="btn btn-primary" id="startBtn">Start AI Troubleshooting</button></div>
      </form>
      <div id="results"><div class="state-box"><div class="state-icon">🩺</div><h2>Ready when you are</h2>
        <p>Choose a category and describe the problem to get guidance.</p></div></div>`);

    const $ = sel => root.querySelector(sel);
    const values = () => ({ category: $("#category").value, description: $("#description").value, errorCode: $("#errorCode").value });

    function showErrors(errors) {
      ["category", "errorCode", "description"].forEach(k => {
        $("#err-" + k).textContent = errors[k] || "";
        $("#" + k).classList.toggle("invalid", Boolean(errors[k]));
      });
    }

    async function run(payload) {
      if (running) return;
      running = true;
      const mySession = session;
      $("#startBtn").disabled = true;
      $("#startBtn").textContent = "Analysing…";
      $("#results").innerHTML = `<div class="state-box"><div class="spinner"></div><p>Analysing the problem…</p></div>`;
      try {
        const raw = await Api.troubleshoot(payload);
        if (mySession !== session) return;
        const result = parseResult(raw);
        $("#results").innerHTML = resultHtml(result);
        wireDecisions(payload);
      } catch (e) {
        if (mySession !== session) return;
        $("#results").innerHTML = `<div class="state-box"><div class="state-icon">⚠️</div>
          <h2>Troubleshooting failed</h2><p>${esc(e.message)}</p>
          <button class="btn" id="retryBtn">Retry</button></div>`;
        $("#retryBtn").addEventListener("click", () => run(payload));
      } finally {
        if (mySession === session) {
          running = false;
          $("#startBtn").disabled = false;
          $("#startBtn").textContent = "Start AI Troubleshooting";
        }
      }
    }

    function wireDecisions(p) {
      const goWarranty = () => {
        Navigation.setProblemContext({ applianceId: appliance.id, category: p.category,
          description: p.description, errorCode: p.errorCode || "" });
        Navigation.selectAppliance(appliance);
        Navigation.go("warranty-checker", appliance.id);
      };
      const fixed = $("#fixedBtn");
      if (fixed) fixed.addEventListener("click", () => {
        // No repair-history API exists yet, so the outcome is not saved anywhere.
        $("#decisionMsg").innerHTML = `<div class="alert alert-success">Great, glad it's fixed! This outcome was not saved because repair history is not available yet.</div>`;
        fixed.disabled = true;
        $("#stillBtn").disabled = true;
      });
      $("#stillBtn").addEventListener("click", goWarranty);
      $("#warrantyBtn").addEventListener("click", goWarranty);
    }

    $("#tsForm").addEventListener("submit", e => {
      e.preventDefault();
      if (running) return;
      const v = values();
      const errors = validate(v, appliance);
      showErrors(errors);
      const first = ["category", "errorCode", "description"].find(k => errors[k]);
      if (first) { $("#" + first).focus(); return; }
      if (!Auth.isConfigured()) {
        $("#results").innerHTML = `<div class="state-box"><div class="state-icon">🔧</div><h2>API not connected</h2>
          <p>The API is not configured yet. See <code>frontend/js/config.js</code>.</p></div>`;
        return;
      }
      run(buildPayload(v, appliance));
    });
  }

  return { render, validate, buildPayload, parseResult, resultHtml, DEMO_LABEL, DISCLAIMER };
})();

if (typeof module !== "undefined") module.exports = Troubleshoot;
