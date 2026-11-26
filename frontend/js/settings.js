// Settings screen. Shows only what is genuinely available:
//  - Account details come from the signed-in user's token claims (read-only, not editable here).
//  - Maintenance reminder e-mails are REAL: the switch is saved in the backend and each user gets reminders
//    on their own Amazon SNS topic, only after confirming the e-mail that SNS sends. Warranty and repair
//    preferences below it are still PROTOTYPE-ONLY (browser-local) and nothing is sent for them.
//  - Sign Out uses Auth.signOut().
// Options the app cannot support yet (edit profile, change password, theme, date format) are not shown.
const SettingsScreen = (() => {
  const SUB = "Manage your account and ClueNest preferences.";
  const NOTIFICATIONS = [
    { key: "warranty", label: "Warranty expiry reminders", desc: "Preference for being reminded before a warranty expires." },
    { key: "repairs", label: "Repair updates", desc: "Preference for updates about repairs." }
  ];
  const PROTOTYPE_NOTE = "Prototype only: the warranty and repair preferences are saved in this browser on this device. ClueNest does not send warranty or repair messages yet.";
  // What the maintenance e-mail switch shows for each backend status.
  const EMAIL_STATUS = {
    off: { text: "Off. No e-mails are sent.", tone: "muted" },
    pending: { text: "Waiting for you to confirm. Amazon SNS sent a confirmation e-mail (from AWS Notifications) to your account address. Open it and choose Confirm subscription. Until then nothing is sent. The link works for 48 hours.", tone: "info" },
    active: { text: "On. Reminders are sent to your account e-mail address when maintenance is due or overdue.", tone: "success" },
    needs_attention: { text: "Not active. The confirmation expired or you unsubscribed from the e-mail. Turn the switch off and on again to get a new confirmation e-mail.", tone: "error" }
  };
  function emailStatus(status) { return EMAIL_STATUS[status] || EMAIL_STATUS.off; }

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Support details are shown only when configured, and only if they look valid.
  function supportContact(cfg) {
    const email = typeof cfg.supportEmail === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.supportEmail.trim()) ? cfg.supportEmail.trim() : "";
    const url = typeof cfg.supportUrl === "string" ? FindTechnician.safeUrl(cfg.supportUrl) : "";
    return { email, url };
  }

  const panel = (title, icon, body, id) => `<section class="dash-panel settings-panel" id="${id}">
    <div class="panel-head"><h2>${icon} ${esc(title)}</h2></div>${body}</section>`;

  function accountBody() {
    const p = Auth.getProfile();
    const rows = [];
    if (p.name) rows.push(["Name", p.name]);
    if (p.email) rows.push(["Email address", p.email]);
    if (p.emailVerified !== null && p.email) rows.push(["Email verified", p.emailVerified ? "Yes" : "No"]);
    if (!rows.length) {
      return `<p class="muted">No name or email address is available from your sign-in session.</p>
        <p class="muted panel-note">Account status is not available either.</p>`;
    }
    return `<dl class="meta settings-meta">${rows.map(r => `<div><dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd></div>`).join("")}</dl>
      <p class="muted panel-note">These details come from your sign-in session and can't be edited here. Profile editing isn't available yet.</p>`;
  }

  // The maintenance e-mail switch. Its state comes from the backend, so it starts disabled until loaded.
  function emailRemindersBody() {
    return `<ul class="setting-list"><li>
        <div><strong id="lbl-emailReminders">E-mail me maintenance reminders</strong>
          <span class="muted">Sent by Amazon SNS to your own account e-mail, once, when a reminder is due or overdue. Only you receive them.</span></div>
        <label class="switch"><input type="checkbox" role="switch" id="emailReminders" aria-labelledby="lbl-emailReminders" disabled />
          <span class="slider"></span></label></li></ul>
      <div id="emailStatus" role="status" aria-live="polite"><span class="muted">Loading…</span></div>`;
  }

  function notificationsBody(settings, error) {
    if (error) {
      return `<div class="alert alert-error">${esc(error)} <button class="btn btn-sm" id="retryPrefs">Retry</button></div>`;
    }
    return `${emailRemindersBody()}
      <div class="alert alert-info">${esc(PROTOTYPE_NOTE)}</div>
      <ul class="setting-list">${NOTIFICATIONS.map(n => `<li>
        <div><strong id="lbl-${n.key}">${esc(n.label)}</strong><span class="muted">${esc(n.desc)}</span></div>
        <label class="switch"><input type="checkbox" role="switch" data-key="${n.key}" aria-labelledby="lbl-${n.key}" ${settings.notifications[n.key] ? "checked" : ""} />
          <span class="slider"></span></label></li>`).join("")}</ul>
      <div id="prefStatus" role="status" aria-live="polite"></div>`;
  }

  function showEmailStatus(root, prefs) {
    const s = emailStatus(prefs.status);
    const box = root.querySelector("#emailReminders");
    if (box) { box.checked = prefs.enabled; box.disabled = false; }
    const el = root.querySelector("#emailStatus");
    if (el) el.innerHTML = `<div class="alert alert-${s.tone === "muted" ? "info" : s.tone}">${esc(s.text)}</div>`;
  }

  // Loads the saved setting, and saves a change only when the backend accepts it.
  async function wireEmailReminders(root) {
    const box = root.querySelector("#emailReminders");
    const el = root.querySelector("#emailStatus");
    if (!box || !el) return;
    const fail = (e) => { el.innerHTML = `<div class="alert alert-error">${esc(e && e.message ? e.message : "Something went wrong.")}</div>`; };
    let prefs = { enabled: false, status: "off" };
    try { prefs = await Api.getNotificationPreferences(); showEmailStatus(root, prefs); }
    catch (e) { fail(e); return; }
    box.addEventListener("change", async () => {
      const wanted = box.checked;
      box.disabled = true;
      el.innerHTML = `<span class="muted">Saving…</span>`;
      try { prefs = await Api.setMaintenanceEmail(wanted); showEmailStatus(root, prefs); }
      catch (e) { box.checked = prefs.enabled; box.disabled = false; fail(e); }   // put the switch back: nothing changed
    });
  }

  function render(root) {
    const userId = Auth.getUserId();
    const cfg = window.CLUENEST_CONFIG || {};
    const sup = supportContact(cfg);

    const helpBody = `<p><a class="btn" href="#/help" id="helpLink">Open Help</a></p>
      ${sup.email || sup.url
        ? `<ul class="setting-list contact-list">${sup.email ? `<li><span>Support email</span><a href="mailto:${esc(sup.email)}">${esc(sup.email)}</a></li>` : ""}
           ${sup.url ? `<li><span>Support website</span><a href="${esc(sup.url)}" target="_blank" rel="noopener noreferrer">${esc(sup.url)}</a></li>` : ""}</ul>`
        : `<p class="muted">No support contact details have been configured yet.</p>`}`;

    const appBody = `<dl class="meta settings-meta"><div><dt>Currency</dt><dd>Canadian Dollar (CAD)</dd></div></dl>
      <p class="muted panel-note">All amounts in ClueNest are shown in CAD. Other currencies, date formats and themes aren't supported yet.</p>`;

    const securityBody = `${userId || Auth.isAuthenticated() ? `<p><button class="btn btn-warn" id="signOutBtn">Sign Out</button></p>
        <p class="muted panel-note">Signing out ends this session on this device.</p>` : `<p class="muted">You are not signed in.</p>`}
      <p class="muted panel-note">Changing your password isn't available in ClueNest yet.</p>`;

    const signedIn = Boolean(userId);
    let prefs = null, prefError = "";
    if (signedIn) { try { prefs = SettingsStore.load(userId); } catch (e) { prefError = e.message; } }

    const prefsBlock = signedIn
      ? panel("Notification Preferences", "🔔", notificationsBody(prefs, prefError), "panelNotifications")
      : panel("Notification Preferences", "🔔", `<p class="muted">Sign in to manage notification preferences.</p>`, "panelNotifications");

    root.innerHTML = `
      <div class="page-header"><div><h1>Settings</h1><p class="subtitle">${esc(SUB)}</p></div></div>
      ${signedIn ? "" : `<div class="alert alert-info">Sign-in required. Login is not implemented yet, so no account could be identified.</div>`}
      <div class="settings-grid">
        ${panel("Account Information", "👤", signedIn ? accountBody() : `<p class="muted">Sign in to see your account information.</p>`, "panelAccount")}
        ${prefsBlock}
        ${panel("Application Preferences", "🧩", appBody, "panelApp")}
        ${panel("Security", "🔒", securityBody, "panelSecurity")}
        ${panel("Help and Support", "💬", helpBody, "panelHelp")}
      </div>`;

    const $ = s => root.querySelector(s);

    const retry = $("#retryPrefs");
    if (retry) retry.addEventListener("click", () => render(root));

    if (signedIn && prefs) {
      let current = prefs;
      root.querySelectorAll('input[data-key]').forEach(box => box.addEventListener("change", () => {
        const key = box.dataset.key;
        const next = { notifications: Object.assign({}, current.notifications, { [key]: box.checked }) };
        const status = $("#prefStatus");
        try {
          current = SettingsStore.save(userId, next);
          status.innerHTML = `<div class="alert alert-success">Preference saved in this browser.</div>`;
        } catch (e) {
          box.checked = !box.checked; // put the switch back: the change was not saved
          status.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
        }
      }));
    }

    if (signedIn) wireEmailReminders(root);

    const out = $("#signOutBtn");
    if (out) out.addEventListener("click", () => {
      out.disabled = true; out.textContent = "Signing out…";
      const logoutUrl = Auth.signOut();
      if (logoutUrl) window.location.assign(logoutUrl); // ends the Cognito hosted-UI session too
      else Navigation.go("dashboard");                    // Dashboard shows the signed-out state
    });
  }

  return { render, supportContact, emailStatus, PROTOTYPE_NOTE };
})();

if (typeof module !== "undefined") module.exports = SettingsScreen;
