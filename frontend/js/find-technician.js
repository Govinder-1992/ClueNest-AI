// Find Technician screen. Business results come only from the backend technician-search API,
// which is responsible for calling Google Places. No Google key exists in the frontend.
const FindTechnician = (() => {
  const RADII = [5, 10, 25, 50]; // kilometres
  const MAX_LOCATION = 100;
  const NOTICE = "Business information comes from Google Places. A listing does not mean the business specialises in your appliance, offers this repair, has availability or will charge a particular price. Please contact the business to confirm.";

  let running = false;
  let session = 0;

  // ---------- pure logic (also used by tests) ----------
  function validate(location, radius) {
    const errors = {};
    const loc = String(location || "").trim();
    if (!loc) errors.location = "Enter a city or postal code.";
    else if (loc.length < 2) errors.location = "Enter at least 2 characters.";
    else if (loc.length > MAX_LOCATION) errors.location = "Keep the location under " + MAX_LOCATION + " characters.";
    else if (/[<>\u0000-\u001f]/.test(loc)) errors.location = "The location contains characters that are not allowed.";
    if (radius !== "" && radius != null && !RADII.includes(Number(radius))) errors.radius = "Choose a radius from the list.";
    return errors;
  }

  const str = v => (typeof v === "string" ? v.trim() : "");
  const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);

  // Only http(s) links are used for websites.
  function safeUrl(u) {
    const s = str(u);
    try {
      const p = new URL(s);
      return p.protocol === "https:" || p.protocol === "http:" ? p.href : "";
    } catch (e) { return ""; }
  }

  // Keeps digits and a leading + for tel: links. Returns "" when too short to be a phone number.
  function telHref(phone) {
    const s = str(phone);
    const cleaned = (s.startsWith("+") ? "+" : "") + s.replace(/\D/g, "");
    return cleaned.replace(/\D/g, "").length >= 7 ? "tel:" + cleaned : "";
  }

  // Maps one backend/Google result to a fixed shape. Missing information stays empty.
  function normalizeBusiness(r) {
    if (!r || typeof r !== "object") return null;
    const hours = r.opening_hours || r.currentOpeningHours || r.regularOpeningHours || {};
    let open = r.openNow ?? r.open_now ?? hours.open_now ?? hours.openNow;
    open = typeof open === "boolean" ? open : null;
    const nameVal = r.name ?? r.businessName ?? (r.displayName && r.displayName.text) ?? r.displayName;
    const placeId = str(r.placeId ?? r.place_id ?? r.id);
    let distanceKm = num(r.distanceKm);
    if (distanceKm === null && num(r.distanceMeters) !== null) distanceKm = r.distanceMeters / 1000;
    const mapsUrl = safeUrl(r.googleMapsUri ?? r.mapsUrl ?? r.url) ||
      (placeId ? "https://www.google.com/maps/place/?q=place_id:" + encodeURIComponent(placeId) : "");
    return {
      placeId,
      name: str(typeof nameVal === "string" ? nameVal : ""),
      address: str(r.address ?? r.formattedAddress ?? r.formatted_address ?? r.vicinity),
      phone: str(r.phone ?? r.formattedPhoneNumber ?? r.formatted_phone_number ?? r.nationalPhoneNumber ?? r.internationalPhoneNumber),
      website: safeUrl(r.website ?? r.websiteUri),
      rating: num(r.rating),
      reviewCount: num(r.reviewCount ?? r.userRatingCount ?? r.user_ratings_total),
      distanceKm,
      distanceText: str(r.distanceText),
      openNow: open,
      mapsUrl
    };
  }

  // Accepts a bare array or an object wrapping one. Drops unnamed and duplicate businesses.
  function parseResults(data) {
    let d = data;
    if (d && typeof d.body === "string") { try { d = JSON.parse(d.body); } catch (e) { /* keep raw */ } }
    const arr = Array.isArray(d) ? d
      : d && (d.results || d.technicians || d.places || d.businesses || d.items);
    if (!Array.isArray(arr)) return [];
    const seen = new Set(), out = [];
    arr.map(normalizeBusiness).forEach(b => {
      if (!b || !b.name) return;
      const key = b.placeId || (b.name + "|" + b.address).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(b);
    });
    return out;
  }

  function distanceLabel(b) {
    if (b.distanceKm !== null) return (Math.round(b.distanceKm * 10) / 10) + " km away";
    return b.distanceText;
  }

  // ---------- UI ----------
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function shell(root, id, body) {
    root.innerHTML = `
      <div class="back-links">
        ${id ? `<a class="back-link" href="#/repair-vs-replace?id=${encodeURIComponent(id)}">← Back to Repair vs Replace</a>` : ""}
        <a class="back-link" href="#/appliances">← Back to My Appliances</a>
      </div>
      <div class="page-header"><div>
        <h1>Find an Appliance Technician</h1>
        <p class="subtitle">Find local repair professionals who can help with your appliance.</p>
      </div></div>${body}`;
  }

  function notice(icon, title, text, extra) {
    return `<div class="state-box"><div class="state-icon">${icon}</div><h2>${esc(title)}</h2>
      <p>${esc(text)}</p>${extra || ""}</div>`;
  }

  function row(label, value, wide) {
    return `<div${wide ? ' style="grid-column:1/-1"' : ""}><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  }

  function businessCard(b, i) {
    const tel = telHref(b.phone);
    const rating = b.rating !== null
      ? `★ ${b.rating.toFixed(1)}${b.reviewCount !== null ? " (" + b.reviewCount + (b.reviewCount === 1 ? " review)" : " reviews)") : ""}` : "";
    const status = b.openNow === true ? '<span class="badge badge-active">Open now</span>'
      : b.openNow === false ? '<span class="badge badge-expired">Closed now</span>' : "";
    const dist = distanceLabel(b);
    const details = [
      b.address && ["Address", b.address], b.phone && ["Phone", b.phone],
      b.website && ["Website", b.website], rating && ["Google rating", rating],
      dist && ["Distance", dist],
      b.openNow !== null && ["Open status", b.openNow ? "Open now" : "Closed now"]
    ].filter(Boolean);
    return `
      <article class="card biz-card" data-index="${i}">
        <div class="card-head">
          <div class="appliance-icon">🔧</div>
          <div class="card-title"><h3>${esc(b.name)}</h3>
            ${rating ? `<span class="muted">${esc(rating)}</span>` : ""}</div>
          ${status}
        </div>
        <ul class="biz-info">
          ${b.address ? `<li>📍 ${esc(b.address)}</li>` : ""}
          ${b.phone ? `<li>📞 ${esc(b.phone)}</li>` : ""}
          ${b.website ? `<li>🌐 ${esc(b.website.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</li>` : ""}
          ${dist ? `<li>🧭 ${esc(dist)}</li>` : ""}
        </ul>
        <div class="biz-details" hidden>
          <dl class="meta">${details.map(d => row(d[0], d[1])).join("")}</dl>
          ${b.mapsUrl ? `<a href="${esc(b.mapsUrl)}" target="_blank" rel="noopener noreferrer">View on Google Maps</a>` : ""}
        </div>
        <div class="biz-actions">
          <button class="btn" data-act="details" aria-expanded="false">View Details</button>
          ${tel ? `<a class="btn" href="${esc(tel)}">Call Technician</a>` : ""}
          ${b.website ? `<a class="btn" href="${esc(b.website)}" target="_blank" rel="noopener noreferrer">Visit Website</a>` : ""}
          <button class="btn btn-primary" data-act="quote">Add Quote</button>
          <button class="btn btn-success" data-act="repair">Record Completed Repair</button>
        </div>
      </article>`;
  }

  async function render(root, params) {
    running = false;
    const me = ++session;
    const id = params.get("id");
    if (!id) {
      shell(root, null, notice("📦", "No appliance selected",
        "Open this screen from an appliance card or from Repair vs Replace.",
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
        '<button class="btn" id="retryLoad">Retry</button>'));
      root.querySelector("#retryLoad").addEventListener("click", () => render(root, params));
      return;
    }
    if (location.hash !== myHash || me !== session) return;
    if (!appliance) {
      shell(root, id, notice("🔒", "Appliance details unavailable",
        "The API is not connected or you are not signed in, so the appliance could not be loaded.",
        '<a class="btn" href="#/appliances">Back to My Appliances</a>'));
      return;
    }

    const w = WarrantyChecker.computeWarranty(appliance);
    const problem = Navigation.getProblemContext(id);
    const rc = Navigation.getRepairContext(id);
    const problemText = problem
      ? [problem.category, problem.errorCode ? "Error code " + problem.errorCode : "", problem.description].filter(Boolean).join(" - ")
      : "Not provided";
    const cost = rc && typeof rc.estimatedRepairCost === "number"
      ? Number(rc.estimatedRepairCost).toLocaleString("en-CA", { style: "currency", currency: "CAD" }) : "";

    const cfg = window.CLUENEST_CONFIG || {};
    const integrationReady = Auth.isConfigured() && /^\/[\w\-\/]*$/.test(cfg.technicianSearchPath || "");

    const radiusOpts = '<option value="">Default</option>' + RADII.map(r => `<option value="${r}">${r} km</option>`).join("");
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
          ${row("Warranty status", w.status)}
          ${cost ? row("Estimated repair cost", cost) : ""}
          ${row("Problem", problemText, true)}
        </dl>
      </div>
      ${integrationReady ? "" : `<div class="alert alert-info">Technician search is not connected yet. It needs the signed-in API and a backend technician-search endpoint (see <code>frontend/js/config.js</code>). No results are shown until then.</div>`}
      <form id="searchForm" class="form-card" novalidate>
        <fieldset><legend>Search Location</legend>
          <div class="form-grid">
            <div class="form-field"><label for="location">City or postal code <span class="req">*</span></label>
              <input id="location" maxlength="${MAX_LOCATION}" autocomplete="off" placeholder="Enter your city or postal code" />
              <div class="field-error" id="err-location" role="alert"></div></div>
            <div class="form-field"><label for="radius">Search radius (optional)</label>
              <select id="radius">${radiusOpts}</select>
              <div class="field-error" id="err-radius" role="alert"></div></div>
          </div>
          <small class="muted">Type a location yourself. We never ask for your precise device location.</small>
        </fieldset>
        <div class="form-actions"><button type="submit" class="btn btn-primary" id="searchBtn">Find Technicians</button></div>
      </form>
      <div id="results"></div>`);

    const $ = s => root.querySelector(s);

    async function run(query) {
      if (running) return;
      running = true;
      const mine = session;
      $("#searchBtn").disabled = true;
      $("#searchBtn").textContent = "Searching…";
      $("#results").innerHTML = `<div class="state-box"><div class="spinner"></div><p>Searching for technicians near ${esc(query.location)}…</p></div>`;
      try {
        const data = await Api.searchTechnicians(query);
        if (mine !== session) return;
        const list = parseResults(data);
        if (!list.length) {
          $("#results").innerHTML = notice("🔍", "No technicians found",
            "No businesses were returned for " + query.location + ". Try a nearby city, a postal code or a larger radius.");
          return;
        }
        $("#results").innerHTML = `
          <div class="results-head"><h2>${list.length} ${list.length === 1 ? "business" : "businesses"} near ${esc(query.location)}</h2>
            <button class="btn" id="otherBtn" type="button">Search another location</button></div>
          <p class="disclaimer">${esc(NOTICE)}</p>
          <div class="grid biz-grid">${list.map(businessCard).join("")}</div>`;
        $("#otherBtn").addEventListener("click", () => { const l = $("#location"); l.focus(); l.select(); window.scrollTo(0, 0); });
        $("#results").querySelectorAll(".biz-card").forEach(card => {
          const b = list[Number(card.dataset.index)];
          card.querySelector('[data-act="details"]').addEventListener("click", e => {
            const panel = card.querySelector(".biz-details");
            panel.hidden = !panel.hidden;
            e.currentTarget.setAttribute("aria-expanded", String(!panel.hidden));
            e.currentTarget.textContent = panel.hidden ? "View Details" : "Hide Details";
          });
          card.querySelector('[data-act="quote"]').addEventListener("click", () => {
            Navigation.setTechnicianContext({ applianceId: appliance.id, problem: problemText,
              business: { name: b.name, address: b.address, phone: b.phone, website: b.website,
                rating: b.rating, reviewCount: b.reviewCount, placeId: b.placeId } });
            Navigation.selectAppliance(appliance);
            Navigation.go("technician-quotes", appliance.id);
          });
          // Opens the existing Repair History form for this appliance, with this business as the technician.
          card.querySelector('[data-act="repair"]').addEventListener("click", () => {
            Navigation.setTechnicianContext({ applianceId: appliance.id, problem: problemText,
              business: { name: b.name, address: b.address, phone: b.phone, website: b.website,
                rating: b.rating, reviewCount: b.reviewCount, placeId: b.placeId } });
            Navigation.selectAppliance(appliance);
            Navigation.go("repair-history", appliance.id, { mode: "add", from: "technician" });
          });
        });
      } catch (e) {
        if (mine !== session) return;
        $("#results").innerHTML = notice("⚠️", "Technician search failed", e.message,
          '<button class="btn" id="retrySearch">Retry</button>');
        $("#retrySearch").addEventListener("click", () => run(query));
      } finally {
        if (mine === session) {
          running = false;
          $("#searchBtn").disabled = false;
          $("#searchBtn").textContent = "Find Technicians";
        }
      }
    }

    $("#searchForm").addEventListener("submit", e => {
      e.preventDefault();
      if (running) return;
      const location_ = $("#location").value, radius = $("#radius").value;
      const errors = validate(location_, radius);
      ["location", "radius"].forEach(k => {
        $("#err-" + k).textContent = errors[k] || "";
        $("#" + k).classList.toggle("invalid", Boolean(errors[k]));
      });
      const first = ["location", "radius"].find(k => errors[k]);
      if (first) { $("#" + first).focus(); return; }
      if (!integrationReady) {
        $("#results").innerHTML = notice("🔧", "Technician search not connected",
          "The technician-search backend is not configured in this app yet, so no results can be shown. Nothing was sent.");
        return;
      }
      const query = { location: location_.trim(), applianceType: appliance.type || "" };
      if (radius) query.radiusKm = Number(radius);
      run(query);
    });
  }

  return { render, validate, parseResults, normalizeBusiness, safeUrl, telHref, NOTICE };
})();

if (typeof module !== "undefined") module.exports = FindTechnician;
