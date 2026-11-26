// Add Appliance screen. Records are saved only through POST /appliances.
const AddAppliance = (() => {
  const TYPES = ["Refrigerator", "Washing Machine", "Dryer", "Dishwasher", "Oven",
    "Microwave", "Air Conditioner", "Other"];
  const DURATIONS = [
    { value: "none", label: "No Warranty" }, { value: "1", label: "1 Year" },
    { value: "2", label: "2 Years" }, { value: "3", label: "3 Years" },
    { value: "5", label: "5 Years" }, { value: "custom", label: "Custom Duration" }
  ];
  const MAX_CUSTOM_YEARS = 50;

  let saving = false;

  // ---------- pure logic (also used by tests) ----------
  function pad(n) { return String(n).padStart(2, "0"); }

  function todayString() {
    const d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function isValidDateString(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return false;
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  }

  // Purchase date + whole years. 29 Feb in a non-leap target year becomes 28 Feb.
  function calcExpiry(purchaseDate, years) {
    if (!isValidDateString(purchaseDate) || !Number.isInteger(years) || years < 1) return null;
    const [y, m, d] = purchaseDate.split("-").map(Number);
    const ty = y + years;
    const lastDay = new Date(Date.UTC(ty, m, 0)).getUTCDate();
    return ty + "-" + pad(m) + "-" + pad(Math.min(d, lastDay));
  }

  // Returns whole years, 0 for no warranty, or null when invalid/missing.
  function parseYears(duration, customValue) {
    if (duration === "none") return 0;
    if (duration === "custom") {
      const s = String(customValue || "").trim();
      if (!/^\d+$/.test(s)) return null;
      const n = Number(s);
      return n >= 1 && n <= MAX_CUSTOM_YEARS ? n : null;
    }
    return DURATIONS.some(d => d.value === duration) ? Number(duration) : null;
  }

  function warrantyStatusFor(expiry, years) {
    if (years === 0) return "No Warranty";
    if (!expiry) return "";
    return expiry >= todayString() ? "Active" : "Expired";
  }

  function validate(v) {
    const errors = {};
    if (!v.name.trim()) errors.name = "Enter the appliance name.";
    if (!v.type) errors.type = "Select the appliance type.";
    else if (!TYPES.includes(v.type)) errors.type = "Select a type from the list.";
    if (!v.brand.trim()) errors.brand = "Enter the brand.";

    if (!v.purchaseDate) errors.purchaseDate = "Enter the purchase date.";
    else if (!isValidDateString(v.purchaseDate)) errors.purchaseDate = "Enter a valid date.";
    else if (v.purchaseDate > todayString()) errors.purchaseDate = "Purchase date cannot be in the future.";

    const price = String(v.purchasePrice).trim();
    if (price !== "") {
      const n = Number(price);
      if (!Number.isFinite(n)) errors.purchasePrice = "Enter a valid price.";
      else if (n < 0) errors.purchasePrice = "Purchase price cannot be negative.";
    }

    if (!v.warrantyDuration) errors.warrantyDuration = "Select the warranty duration.";
    else if (v.warrantyDuration === "custom" && parseYears("custom", v.customYears) === null) {
      errors.customYears = "Enter a whole number of years between 1 and " + MAX_CUSTOM_YEARS + ".";
    }
    return errors;
  }

  function buildPayload(v) {
    const years = parseYears(v.warrantyDuration, v.customYears);
    const p = {
      name: v.name.trim(),
      type: v.type,
      brand: v.brand.trim(),
      purchaseDate: v.purchaseDate,
      warrantyYears: years
    };
    if (v.model.trim()) p.model = v.model.trim();
    if (v.serialNumber.trim()) p.serialNumber = v.serialNumber.trim();
    if (String(v.purchasePrice).trim() !== "") p.purchasePrice = Number(v.purchasePrice);
    if (v.storeName.trim()) p.storeName = v.storeName.trim();
    if (years > 0) p.warrantyExpiry = calcExpiry(v.purchaseDate, years);
    return p;
  }

  // ---------- UI ----------
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function field(id, label, control, required, hint) {
    return `<div class="form-field">
      <label for="${id}">${label}${required ? ' <span class="req">*</span>' : ""}</label>
      ${control}
      ${hint ? `<small class="muted">${hint}</small>` : ""}
      <div class="field-error" id="err-${id}" role="alert"></div></div>`;
  }

  function render(root) {
    saving = false;
    const typeOpts = '<option value="">Select type</option>' +
      TYPES.map(t => `<option>${esc(t)}</option>`).join("");
    const durOpts = '<option value="">Select duration</option>' +
      DURATIONS.map(d => `<option value="${d.value}">${d.label}</option>`).join("");

    root.innerHTML = `
      <a class="back-link" href="#/appliances">← Back to My Appliances</a>
      <div class="page-header"><div>
        <h1>Add New Appliance</h1>
        <p class="subtitle">Register your home appliance to manage its warranty, maintenance and repair history.</p>
      </div></div>
      <div id="formMessage" role="status"></div>
      <form id="addForm" class="form-card" novalidate>
        <fieldset><legend>Appliance Information</legend><div class="form-grid">
          ${field("name", "Appliance Name", '<input id="name" maxlength="100" autocomplete="off" />', true)}
          ${field("type", "Appliance Type", `<select id="type">${typeOpts}</select>`, true)}
          ${field("brand", "Brand", '<input id="brand" maxlength="100" autocomplete="off" />', true)}
          ${field("model", "Model Number", '<input id="model" maxlength="100" autocomplete="off" />')}
          ${field("serialNumber", "Serial Number", '<input id="serialNumber" maxlength="100" autocomplete="off" />')}
        </div></fieldset>

        <fieldset><legend>Purchase Information</legend><div class="form-grid">
          ${field("purchaseDate", "Purchase Date", `<input id="purchaseDate" type="date" max="${todayString()}" />`, true)}
          ${field("purchasePrice", "Purchase Price", '<input id="purchasePrice" type="number" min="0" step="0.01" inputmode="decimal" />')}
          ${field("storeName", "Store Name", '<input id="storeName" maxlength="100" autocomplete="off" />')}
        </div></fieldset>

        <fieldset><legend>Warranty Information</legend><div class="form-grid">
          ${field("warrantyDuration", "Warranty Duration", `<select id="warrantyDuration">${durOpts}</select>`, true)}
          <div id="customWrap" hidden>
            ${field("customYears", "Number of Years", `<input id="customYears" type="number" min="1" max="${MAX_CUSTOM_YEARS}" step="1" inputmode="numeric" />`, true)}
          </div>
          <div class="form-field">
            <label>Warranty Expiry Date</label>
            <div class="readonly-box" id="expiryDisplay">Select purchase date and warranty duration</div>
          </div>
        </div></fieldset>

        <div class="form-actions">
          <a class="btn" href="#/appliances" id="cancelBtn">Cancel</a>
          <button type="submit" class="btn btn-primary" id="saveBtn">Save Appliance</button>
        </div>
      </form>`;

    const $ = id => root.querySelector("#" + id);
    const ids = ["name", "type", "brand", "model", "serialNumber", "purchaseDate",
      "purchasePrice", "storeName", "warrantyDuration", "customYears"];
    const values = () => Object.fromEntries(ids.map(i => [i, $(i).value]));
    const get = () => { const v = values(); return Object.assign(v, { customYears: v.customYears }); };

    function showErrors(errors) {
      ids.forEach(i => {
        $("err-" + i).textContent = errors[i] || "";
        $(i).classList.toggle("invalid", Boolean(errors[i]));
      });
    }

    function message(kind, text) {
      $("formMessage").innerHTML = text ? `<div class="alert alert-${kind}">${esc(text)}</div>` : "";
    }

    function updateExpiry() {
      const v = get();
      $("customWrap").hidden = v.warrantyDuration !== "custom";
      const years = parseYears(v.warrantyDuration, v.customYears);
      const box = $("expiryDisplay");
      if (years === 0) { box.textContent = "No Warranty"; return; }
      const expiry = years ? calcExpiry(v.purchaseDate, years) : null;
      if (!expiry) { box.textContent = "Select purchase date and warranty duration"; return; }
      box.textContent = expiry + " (" + warrantyStatusFor(expiry, years) + ")";
    }

    ["purchaseDate", "warrantyDuration", "customYears"].forEach(i => {
      $(i).addEventListener("input", updateExpiry);
      $(i).addEventListener("change", updateExpiry);
    });

    $("addForm").addEventListener("submit", async e => {
      e.preventDefault();
      if (saving) return;
      message("", "");
      const v = get();
      const errors = validate(v);
      showErrors(errors);
      const first = Object.keys(errors)[0];
      if (first) { $(first).focus(); return; }

      if (!Auth.isConfigured()) {
        message("error", "The API is not configured yet, so the appliance cannot be saved. See frontend/js/config.js.");
        return;
      }

      saving = true;
      $("saveBtn").disabled = true;
      $("saveBtn").textContent = "Saving…";
      $("cancelBtn").classList.add("disabled");
      try {
        await Api.createAppliance(buildPayload(v));
        // The list is always re-fetched from GET /appliances; nothing is cached locally.
        Navigation.go("appliances");
      } catch (err) {
        message("error", err.message || "Could not save the appliance. Please try again.");
        saving = false;
        $("saveBtn").disabled = false;
        $("saveBtn").textContent = "Save Appliance";
        $("cancelBtn").classList.remove("disabled");
      }
    });
  }

  return { render, validate, calcExpiry, parseYears, buildPayload, warrantyStatusFor, todayString };
})();

if (typeof module !== "undefined") module.exports = AddAppliance;
