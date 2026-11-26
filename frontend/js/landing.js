// Public landing page, shown instead of the app screens while nobody is signed in.
// It only describes features the app has. The buttons are wired in app.js (.js-signin and .js-signup).
const Landing = (() => {
  const FEATURES = [
    { icon: "🔌", title: "My Appliances", text: "Keep every appliance in one place with brand, model, purchase date and warranty." },
    { icon: "🧠", title: "Guided Troubleshooting", text: "Describe a problem and get possible causes and step-by-step checks, with safety warnings." },
    { icon: "🛡️", title: "Warranty Checker", text: "See at a glance whether a warranty is active, expiring soon or expired." },
    { icon: "⚖️", title: "Repair or Replace", text: "Compare the cost of repairing with replacing before you decide." },
    { icon: "👷", title: "Find a Technician", text: "Search local repair services, call them or visit their website." },
    { icon: "🧾", title: "Repair History", text: "Record each repair with the date, cost and notes, and see what you have spent." },
    { icon: "⏰", title: "Maintenance Reminders", text: "Schedule one-time or repeating reminders, with optional e-mail alerts." },
    { icon: "📊", title: "Dashboard", text: "Upcoming and overdue maintenance, warranties and repair spending on one screen." }
  ];
  const STEPS = [
    { n: 1, title: "Add your appliances", text: "Register the appliances in your home." },
    { n: 2, title: "Report a problem", text: "Describe what is wrong and follow the guided checks." },
    { n: 3, title: "Decide and fix", text: "Check the warranty, compare repair with replace, and find a technician." },
    { n: 4, title: "Stay on top of it", text: "Record the repair, then schedule the next maintenance." }
  ];
  const TRUST = [
    { icon: "🔐", title: "Secure sign-in", text: "Accounts are handled by Amazon Cognito. Your password is never stored by ClueNest." },
    { icon: "🔒", title: "Private to you", text: "Every record belongs to your account. No one else can see your appliances." },
    { icon: "✉️", title: "Reminders you control", text: "E-mail reminders are optional and can be switched off in Settings." }
  ];
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function render(root, opts) {
    const notice = opts && opts.notice ? `<div class="alert alert-info lp-notice" role="status">${esc(opts.notice)}</div>` : "";
    root.innerHTML = `
      <div class="lp">
        <header class="lp-nav">
          <div class="lp-brand"><span class="lp-logo">🪺</span><span>ClueNest AI</span></div>
          <nav class="lp-links" aria-label="Page sections">
            <button class="lp-link" data-scroll="lp-features">Features</button>
            <button class="lp-link" data-scroll="lp-how">How it works</button>
            <button class="lp-link" data-scroll="lp-trust">Security</button>
          </nav>
          <div class="lp-nav-actions">
            <button class="btn js-signin">Sign in</button>
            <button class="btn btn-primary js-signup">Get started</button>
          </div>
        </header>
        ${notice}
        <section class="lp-hero">
          <div class="lp-hero-text">
            <span class="lp-pill">Smart Home. Smarter Care.</span>
            <h1>Your home appliances, finally under control.</h1>
            <p>Track warranties, troubleshoot problems, decide between repair and replacement, record repairs and never miss maintenance again.</p>
            <div class="lp-cta">
              <button class="btn btn-primary btn-lg js-signup">Create your account</button>
              <button class="btn btn-lg js-signin">Sign in</button>
            </div>
            <div class="field-error" id="signInError" role="alert"></div>
          </div>
          <div class="lp-hero-art" aria-hidden="true">
            <div class="lp-mock">
              <div class="lp-mock-head"><span class="lp-mock-icon">🧺</span>
                <div><strong>Laundry Washer</strong><small>Bosch WAT28400UC</small></div>
                <span class="lp-mock-badge">Warranty active</span></div>
              <div class="lp-mock-row"><span>Problem</span><b>Not draining</b></div>
              <div class="lp-mock-row"><span>Last repair</span><b>Drain pump replaced</b></div>
              <div class="lp-mock-row"><span>Next maintenance</span><b>Clean filter · in 12 days</b></div>
              <div class="lp-mock-bar"><i></i></div>
            </div>
            <div class="lp-float lp-float-a">⏰ Reminder set</div>
            <div class="lp-float lp-float-b">✅ Repair recorded</div>
            <small class="lp-example">Example only</small>
          </div>
        </section>
        <section class="lp-section" id="lp-features">
          <h2>Everything your appliances need</h2>
          <p class="lp-lead">From the first problem to the next maintenance, in one place.</p>
          <div class="lp-grid">
            ${FEATURES.map(f => `<article class="lp-card"><span class="lp-card-icon">${f.icon}</span><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></article>`).join("")}
          </div>
        </section>
        <section class="lp-section lp-alt" id="lp-how">
          <h2>How it works</h2>
          <p class="lp-lead">One simple path, from a problem to a plan.</p>
          <ol class="lp-steps">
            ${STEPS.map(s => `<li><span class="lp-step-n">${s.n}</span><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join("")}
          </ol>
        </section>
        <section class="lp-section" id="lp-trust">
          <h2>Built to be trusted</h2>
          <p class="lp-lead">Your home details stay yours.</p>
          <div class="lp-grid lp-grid-3">
            ${TRUST.map(f => `<article class="lp-card"><span class="lp-card-icon">${f.icon}</span><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></article>`).join("")}
          </div>
        </section>
        <section class="lp-final">
          <h2>Ready to take care of your home?</h2>
          <p>Create an account and add your first appliance in a minute.</p>
          <button class="btn btn-lg lp-final-btn js-signup">Get started</button>
        </section>
        <footer class="lp-footer"><span>🪺 ClueNest AI</span><span>Smart Home. Smarter Care.</span></footer>
      </div>`;
    root.querySelectorAll("[data-scroll]").forEach(b => b.addEventListener("click", () => {
      const el = document.getElementById(b.dataset.scroll);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  }

  return { render, FEATURES, STEPS };
})();

if (typeof module !== "undefined") module.exports = Landing;
