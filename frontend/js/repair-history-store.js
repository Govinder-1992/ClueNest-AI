// PROTOTYPE repair-history storage. No backend repair-history API exists yet, so records are kept in
// this browser's localStorage, separately for each signed-in user ID (same approach as quote-store.js
// and maintenance-store.js).
//
// Limitations (development stage only):
//  - Data lives only in this browser on this device. It is NOT synchronised across devices or browsers.
//  - Clearing browser data deletes it.
//  - It is not a secure store. Never put tokens or secrets in a record.
//
// Replace this file with calls to a real backend (through api.js) when one exists.
const RepairHistoryStore = (() => {
  const PREFIX = "cluenest_prototype_repair_history_v1:";
  const key = userId => PREFIX + userId;

  function readAll(userId) {
    if (!userId) throw new Error("A signed-in user is required to read repair records.");
    let raw;
    try { raw = localStorage.getItem(key(userId)); }
    catch (e) { throw new Error("Browser storage is not available, so repair records cannot be loaded."); }
    if (raw == null) return [];
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { throw new Error("Saved repair records could not be read (the stored data is damaged). Nothing was changed."); }
    if (!Array.isArray(data)) throw new Error("Saved repair records could not be read (unexpected format). Nothing was changed.");
    return data.filter(r => r && typeof r.id === "string" && r.userId === userId);
  }

  function writeAll(userId, records) {
    try { localStorage.setItem(key(userId), JSON.stringify(records)); }
    catch (e) { throw new Error("The change could not be saved because browser storage is full or unavailable."); }
  }

  function list(userId) { return readAll(userId); }

  // Reads, lets fn change the list, then writes once. fn receives a copy and must return the new list
  // (or throw to cancel). Only repair records are ever touched; appliances are stored elsewhere.
  function mutate(userId, fn) {
    const next = fn(readAll(userId).slice());
    const stamped = next.map(r => Object.assign({}, r, { userId }));
    writeAll(userId, stamped);
    return stamped;
  }

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  return { list, mutate, newId };
})();
