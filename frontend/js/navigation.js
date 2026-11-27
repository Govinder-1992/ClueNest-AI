// Hash-based navigation. Routes: #/appliances, #/add-appliance, #/report-problem?id=...
const Navigation = (() => {
  const SELECTED_KEY = "cluenest_selected_appliance";

  const MENU = [
    { route: "dashboard", label: "Dashboard", icon: "🏠" },
    { route: "appliances", label: "My Appliances", icon: "🔌" },
    { route: "maintenance", label: "Maintenance", icon: "🛠️" },
    { route: "repair-history", label: "Repair History", icon: "🧾" },
    { route: "technician-quotes", label: "Technician Quotes", icon: "💬" },
    { route: "settings", label: "Settings", icon: "⚙️" },
    { route: "help", label: "Help", icon: "❓" }
  ];

  // Appliance action destinations (placeholders for now).
  const ACTIONS = [
    { route: "report-problem", label: "Report a Problem", icon: "⚠️" },
    { route: "warranty-checker", label: "Warranty Checker", icon: "🛡️" },
    { route: "repair-vs-replace", label: "Repair vs Replace", icon: "⚖️" },
    { route: "maintenance-reminder", label: "Maintenance Reminder", icon: "⏰" },
    { route: "find-technician", label: "Find Technician", icon: "👷" }
  ];

  function parse() {
    const raw = (location.hash || "#/dashboard").slice(2);
    const [route, query] = raw.split("?");
    return { route: route || "dashboard", params: new URLSearchParams(query || "") };
  }

  // extra (optional): more query parameters, for example { mode: "add", from: "technician" }.
  function go(route, applianceId, extra) {
    const parts = [];
    if (applianceId) parts.push("id=" + encodeURIComponent(applianceId));
    if (extra) Object.keys(extra).forEach(k => { if (extra[k] != null && extra[k] !== "") parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(extra[k])); });
    const s = parts.join("&");
    location.hash = "#/" + route + (s ? "?" + s : "");
  }

  // Store full details so destination screens can show them without refetching.
  function selectAppliance(appliance) {
    sessionStorage.setItem(SELECTED_KEY, JSON.stringify(appliance));
  }

  function getSelectedAppliance(id) {
    try {
      const a = JSON.parse(sessionStorage.getItem(SELECTED_KEY));
      return a && String(a.id) === String(id) ? a : null;
    } catch (e) {
      return null;
    }
  }

  // Problem details carried from troubleshooting to the Warranty Checker.
  const PROBLEM_KEY = "cluenest_problem_context";

  function setProblemContext(ctx) {
    sessionStorage.setItem(PROBLEM_KEY, JSON.stringify(ctx));
  }

  function getProblemContext(id) {
    try {
      const c = JSON.parse(sessionStorage.getItem(PROBLEM_KEY));
      return c && String(c.applianceId) === String(id) ? c : null;
    } catch (e) {
      return null;
    }
  }

  // Warranty decision carried from the Warranty Checker to Repair vs Replace.
  const WARRANTY_KEY = "cluenest_warranty_context";

  function setWarrantyContext(ctx) {
    sessionStorage.setItem(WARRANTY_KEY, JSON.stringify(ctx));
  }

  function getWarrantyContext(id) {
    try {
      const c = JSON.parse(sessionStorage.getItem(WARRANTY_KEY));
      return c && String(c.applianceId) === String(id) ? c : null;
    } catch (e) {
      return null;
    }
  }

  // Repair vs Replace outcome carried to Find Technician / Register Replacement.
  const REPAIR_KEY = "cluenest_repair_context";

  function setRepairContext(ctx) {
    sessionStorage.setItem(REPAIR_KEY, JSON.stringify(ctx));
  }

  function getRepairContext(id) {
    try {
      const c = JSON.parse(sessionStorage.getItem(REPAIR_KEY));
      return c && String(c.applianceId) === String(id) ? c : null;
    } catch (e) {
      return null;
    }
  }

  // Business chosen in Find Technician, carried to Technician Quotes.
  const TECH_KEY = "cluenest_technician_context";

  function setTechnicianContext(ctx) {
    sessionStorage.setItem(TECH_KEY, JSON.stringify(ctx));
  }

  function getTechnicianContext(id) {
    try {
      const c = JSON.parse(sessionStorage.getItem(TECH_KEY));
      return c && String(c.applianceId) === String(id) ? c : null;
    } catch (e) {
      return null;
    }
  }

  // A repair that was just saved as completed, carried to the Maintenance Reminder form (Step 9).
  const REPAIR_DONE_KEY = "cluenest_repair_completed_context";
  function setRepairCompletedContext(ctx) {
    sessionStorage.setItem(REPAIR_DONE_KEY, JSON.stringify(ctx));
  }
  function getRepairCompletedContext(id) {
    try {
      const c = JSON.parse(sessionStorage.getItem(REPAIR_DONE_KEY));
      return c && String(c.applianceId) === String(id) ? c : null;
    } catch (e) {
      return null;
    }
  }
  function clearRepairCompletedContext() {
    sessionStorage.removeItem(REPAIR_DONE_KEY);
  }
  // A troubleshooting session that was saved as resolved ("Problem Fixed"), carried to the Maintenance Reminder form.
  const FIXED_KEY = "cluenest_troubleshoot_fixed_context";
  function setTroubleshootFixedContext(ctx) {
    sessionStorage.setItem(FIXED_KEY, JSON.stringify(ctx));
  }
  function getTroubleshootFixedContext(id) {
    try {
      const c = JSON.parse(sessionStorage.getItem(FIXED_KEY));
      return c && String(c.applianceId) === String(id) ? c : null;
    } catch (e) {
      return null;
    }
  }
  function clearTroubleshootFixedContext() {
    sessionStorage.removeItem(FIXED_KEY);
  }
  return { MENU, ACTIONS, parse, go, setRepairCompletedContext, getRepairCompletedContext, clearRepairCompletedContext,
    setTroubleshootFixedContext, getTroubleshootFixedContext, clearTroubleshootFixedContext, selectAppliance, getSelectedAppliance, setProblemContext, getProblemContext,
    setWarrantyContext, getWarrantyContext, setRepairContext, getRepairContext,
    setTechnicianContext, getTechnicianContext };
})();

if (typeof module !== "undefined") module.exports = Navigation;
