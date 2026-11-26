// PROTOTYPE settings storage. No backend settings API exists yet, so preferences are kept in this
// browser's localStorage, separately for each signed-in user ID (same approach as the other prototype stores).
//
// Limitations (development stage only):
//  - Saved only in this browser on this device. NOT synchronised across devices or browsers.
//  - Clearing browser data resets it.
//  - Nothing in the app sends emails, SMS or push notifications, so these values currently only record
//    what the user prefers. Never put passwords, tokens or secrets here.
//
// Replace this file with calls to a real backend (through api.js) when one exists.
const SettingsStore = (() => {
  const PREFIX = "cluenest_prototype_settings_v1:";
  const KEYS = ["maintenance", "warranty", "repairs"];
  const defaults = () => ({ notifications: { maintenance: true, warranty: true, repairs: true } });

  function load(userId) {
    if (!userId) throw new Error("A signed-in user is required to read settings.");
    let raw;
    try { raw = localStorage.getItem(PREFIX + userId); }
    catch (e) { throw new Error("Browser storage is not available, so your preferences cannot be loaded."); }
    const out = defaults();
    if (raw == null) return out;
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { throw new Error("Saved preferences could not be read (the stored data is damaged). Nothing was changed."); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Saved preferences could not be read (unexpected format). Nothing was changed.");
    // Only known keys with real booleans are accepted; anything else falls back to the default.
    KEYS.forEach(k => { if (data.notifications && typeof data.notifications[k] === "boolean") out.notifications[k] = data.notifications[k]; });
    return out;
  }

  function save(userId, settings) {
    if (!userId) throw new Error("A signed-in user is required to save settings.");
    const clean = defaults();
    KEYS.forEach(k => { clean.notifications[k] = settings.notifications[k] === true; });
    try { localStorage.setItem(PREFIX + userId, JSON.stringify(clean)); }
    catch (e) { throw new Error("Your preference could not be saved because browser storage is full or unavailable."); }
    return clean;
  }

  return { load, save, defaults, KEYS };
})();
