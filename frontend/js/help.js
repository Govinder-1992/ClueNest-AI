// Help & Support screen. Static content only: no data is read or written, and no backend is called.
// Every answer describes what the app does TODAY. When a feature changes, update the matching answer here.
const HelpScreen = (() => {
  const SUB = "Find answers and learn how to get the most out of ClueNest AI.";

  const STEPS = [
    { icon: "🔌", text: "Register your home appliance.", link: { href: "#/add-appliance", label: "Add Appliance" } },
    { icon: "📝", text: "Add its brand, model, purchase date and warranty details." },
    { icon: "⚠️", text: "Report a problem when something goes wrong.", link: { href: "#/appliances", label: "My Appliances" } },
    { icon: "🤖", text: "Follow the AI troubleshooting guidance." },
    { icon: "🛡️", text: "Check warranty information." },
    { icon: "⚖️", text: "Compare repair and replacement costs when needed." },
    { icon: "👷", text: "Find technicians and record their quotes.", link: { href: "#/technician-quotes", label: "Technician Quotes" } },
    { icon: "⏰", text: "Set maintenance reminders.", link: { href: "#/maintenance", label: "Maintenance" } },
    { icon: "🧾", text: "Track previous repairs.", link: { href: "#/repair-history", label: "Repair History" } }
  ];

  // Answers are plain text paragraphs (each array item becomes one paragraph).
  const FAQ = [
    { group: "Appliances", icon: "🔌", items: [
      { q: "How do I register an appliance?", a: [
        "Open My Appliances and choose + Add Appliance (the Dashboard has an Add Appliance shortcut too). Enter the appliance name, type, brand and purchase date, and choose a warranty duration. Model number, serial number, purchase price and store are optional.",
        "ClueNest works out the warranty expiry date from the purchase date and the warranty duration. The appliance is saved through the ClueNest service, so it needs your account to be connected."] },
      { q: "Can I update appliance information?", a: [
        "Not yet. Editing an appliance is not available in ClueNest right now, so please check the details carefully before saving."] },
      { q: "How do I remove an appliance?", a: [
        "Removing an appliance is not available yet. Deleting a quote, maintenance reminder or repair record only removes that one record. It never removes the appliance."] }
    ]},
    { group: "AI Troubleshooting", icon: "🤖", items: [
      { q: "How does AI troubleshooting work?", a: [
        "On an appliance card, choose Report a Problem. Pick a problem category, describe what is happening (add an error code if you have one) and choose Start AI Troubleshooting. Your appliance and description are sent to the ClueNest service, which returns possible causes, recommended solutions and any safety warnings.",
        "If the service is running in prototype (MOCK) mode, the results are labelled as prototype guidance. If it reports a possible safety hazard, ClueNest shows only the safety response and no do-it-yourself steps."] },
      { q: "Are AI suggestions guaranteed to fix my appliance?", a: [
        "No. The suggestions are general guidance and cannot see or test your appliance. They may not match your exact problem or model."] },
      { q: "What should I do if the problem continues?", a: [
        "After the results, choose Still Problem. ClueNest opens the Warranty Checker with your appliance and problem details, so you can check your warranty and decide on next steps. If the problem is fixed, choose Problem Fixed. That shows a confirmation, but the outcome is not saved to Repair History automatically. Add a repair record yourself if you want to keep it."] },
      { q: "When should I contact a professional?", a: [
        "Contact a qualified technician for anything involving electricity or gas, for smoke, sparks or burning smells, for leaks near electrical parts, or whenever you are not sure it is safe to continue. See Important Appliance Safety below."] }
    ]},
    { group: "Warranty", icon: "🛡️", items: [
      { q: "Does an active warranty mean every repair is covered?", a: [
        "No. The Warranty Checker only compares your warranty dates with today's date. Whether a particular fault is covered depends on the manufacturer's terms, the condition of the appliance and the type of fault."] },
      { q: "What if my warranty information is missing?", a: [
        "ClueNest shows the status as Unknown rather than guessing. If you entered a purchase date and a warranty duration, the expiry date is calculated from them. If the duration is set to No Warranty, the status is No Warranty. Check your receipt or ask the retailer for the details."] },
      { q: "How do I check whether a repair is covered?", a: [
        "Contact the manufacturer or retailer, because ClueNest cannot confirm coverage. In the Warranty Checker you can enter what they told you and choose Covered or Not Covered. Covered shows a confirmation and does not submit any claim. Not Covered opens Repair vs Replace with your appliance, problem and warranty details."] }
    ]},
    { group: "Technicians and Quotes", icon: "👷", items: [
      { q: "How do I find a repair technician?", a: [
        "Choose Find Technician on an appliance card, or from the Repair vs Replace results. Type a city or postal code (a search radius is optional) and choose Find Technicians. Businesses come from Google Places through the ClueNest service, so this works only when that search service is connected. If it is not, the screen says so.",
        "A listing does not mean the business specialises in your appliance, offers the repair you need, has availability or will charge a particular price. ClueNest never uses your device location."] },
      { q: "Does ClueNest AI automatically contact technicians?", a: [
        "No. ClueNest never contacts anyone for you. Add Quote only saves the business details so you can enter the quote yourself after you have contacted them."] },
      { q: "How do I compare technician quotes?", a: [
        "Open Technician Quotes and add each quote with + Add Quote, either from a technician in Find Technician or by typing the details. Tick two or more quotes and choose Compare Quotes. The comparison highlights the lowest total estimate, but it does not recommend a technician. The lowest quote may not be the best choice.",
        "Quotes are saved in this browser on this device only (prototype storage), so they do not appear on other devices."] }
    ]},
    { group: "Maintenance", icon: "🛠️", items: [
      { q: "How do I create a maintenance reminder?", a: [
        "Open Maintenance and choose + Add Reminder (or use Maintenance Reminder on an appliance card). Choose the appliance, enter the task and a due date, and choose how often it repeats: One Time, Monthly, Every 3 Months, Every 6 Months or Yearly. The example task names in the form are only suggestions.",
        "Reminders appear in your Maintenance list and on the Dashboard. Reminders are saved through the ClueNest service, so they are available on any device you sign in on. E-mail reminders are sent only if you turn them on in Settings. ClueNest does not send SMS or push notifications."] },
      { q: "What happens when I mark a reminder complete?", a: [
        "Choose Mark as Complete. The reminder moves to Completed with today's date and stays there as maintenance history. If it repeats, ClueNest creates the next reminder following the original schedule, skipping any dates that have already passed. A one-time reminder does not create a new one."] }
    ]},
    { group: "Repair History", icon: "🧾", items: [
      { q: "Where can I view previous repairs?", a: [
        "Open Repair History in the sidebar. Records are added by you with + Add Repair Record, because repairs are not recorded automatically. Each record has a status of Completed, In Progress, Not Repaired or Cancelled. Records are saved through the ClueNest service. When you record a completed repair, ClueNest then opens the maintenance reminder form for the same appliance so you can schedule the next maintenance."] },
      { q: "How are repair expenses calculated?", a: [
        "Total Repair Expenses is the sum of the repair cost and additional expenses you entered on your repair records. Missing costs are not estimated, and technician quotes are not counted as expenses. All amounts are in Canadian dollars (CAD)."] }
    ]}
  ];

  const SAFETY = [
    "Disconnect power before performing any maintenance when it is safe to do so.",
    "Do not attempt electrical or gas repairs without appropriate qualifications.",
    "If you smell gas, leave the area and contact the appropriate emergency service or gas utility from a safe location.",
    "Stop using an appliance if it produces smoke, sparks or unusual burning smells.",
    "Follow manufacturer instructions and contact a qualified technician for serious problems."
  ];
  const SAFETY_NOTE = "AI troubleshooting is informational guidance only. It is not a replacement for a professional inspection.";
  const DATA_NOTE = "Where your data is kept: appliances are saved through the ClueNest service. Maintenance reminders, repair records and notification preferences are also saved through the ClueNest service. Quotes are prototype data saved in this browser on this device only, and are not synced across devices.";

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function render(root) {
    const sup = SettingsScreen.supportContact(window.CLUENEST_CONFIG || {});
    const contact = (sup.email || sup.url)
      ? `<ul class="setting-list contact-list">
          ${sup.email ? `<li><span>Email</span><a href="mailto:${esc(sup.email)}" id="supportEmail">${esc(sup.email)}</a></li>` : ""}
          ${sup.url ? `<li><span>Website</span><a href="${esc(sup.url)}" id="supportUrl" target="_blank" rel="noopener noreferrer">${esc(sup.url)}</a></li>` : ""}</ul>`
      : `<div class="panel-empty" id="noSupport"><p>Support contact details have not been configured yet.</p>
          <p class="muted">Once they are added to the app settings, they will appear here.</p></div>`;

    root.innerHTML = `
      <div class="page-header"><div><h1>Help &amp; Support</h1><p class="subtitle">${esc(SUB)}</p></div></div>

      <section class="help-section" id="helpStart">
        <h2 class="section-title">🚀 Getting Started</h2>
        <ol class="help-steps">${STEPS.map((s, i) => `<li><span class="step-num">${i + 1}</span><span class="step-icon">${s.icon}</span>
          <span class="step-text">${esc(s.text)}${s.link ? ` <a href="${s.link.href}">${esc(s.link.label)}</a>` : ""}</span></li>`).join("")}</ol>
      </section>

      <section class="help-section" id="helpFaq">
        <h2 class="section-title">❓ Frequently Asked Questions</h2>
        ${FAQ.map(g => `<div class="faq-group"><h3>${g.icon} ${esc(g.group)}</h3>
          ${g.items.map(it => `<details class="faq-item"><summary>${esc(it.q)}</summary>
            <div class="faq-answer">${it.a.map(p => `<p>${esc(p)}</p>`).join("")}</div></details>`).join("")}</div>`).join("")}
        <div class="alert alert-info">${esc(DATA_NOTE)}</div>
      </section>

      <section class="safety-box" id="helpSafety" aria-labelledby="safetyTitle">
        <h2 id="safetyTitle">⚠️ Important Appliance Safety</h2>
        <ul>${SAFETY.map(s => `<li>${esc(s)}</li>`).join("")}</ul>
        <p class="safety-note"><strong>${esc(SAFETY_NOTE)}</strong></p>
      </section>

      <section class="help-section" id="helpContact">
        <h2 class="section-title">💬 Contact Support</h2>
        <div class="dash-panel">${contact}</div>
      </section>`;
  }

  return { render, FAQ, STEPS, SAFETY, SAFETY_NOTE };
})();

if (typeof module !== "undefined") module.exports = HelpScreen;
