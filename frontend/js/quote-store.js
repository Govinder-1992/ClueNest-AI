// PROTOTYPE quote storage. No backend quote API exists yet, so quotes are kept in this
// browser's localStorage, separately for each signed-in user ID.
//
// Limitations (development stage only):
//  - Data lives only in this browser on this device. It is not synced and not backed up.
//  - Clearing browser data deletes the quotes.
//  - It is not a secure store: anyone with access to the browser profile can read it.
//  - Never put tokens or secrets in a quote record.
//
// Replace this file with calls to a real backend (e.g. through api.js) when one exists.
// quotes.js uses only list/add/update/remove, so nothing else needs to change.
const QuoteStore = (() => {
  const PREFIX = "cluenest_prototype_quotes_v1:";

  const key = userId => PREFIX + userId;

  function readAll(userId) {
    if (!userId) throw new Error("A signed-in user is required to read quotes.");
    let raw;
    try { raw = localStorage.getItem(key(userId)); }
    catch (e) { throw new Error("Browser storage is not available, so quotes cannot be loaded."); }
    if (raw == null) return [];
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { throw new Error("Saved quotes could not be read (the stored data is damaged). Nothing was changed."); }
    if (!Array.isArray(data)) throw new Error("Saved quotes could not be read (unexpected format). Nothing was changed.");
    return data.filter(q => q && typeof q.id === "string" && q.userId === userId);
  }

  function writeAll(userId, quotes) {
    try { localStorage.setItem(key(userId), JSON.stringify(quotes)); }
    catch (e) { throw new Error("The quote could not be saved because browser storage is full or unavailable."); }
  }

  function list(userId) { return readAll(userId); }

  function add(userId, quote) {
    const all = readAll(userId);
    all.push(Object.assign({}, quote, { userId }));
    writeAll(userId, all);
  }

  function update(userId, quote) {
    const all = readAll(userId);
    const i = all.findIndex(q => q.id === quote.id);
    if (i === -1) throw new Error("That quote no longer exists.");
    all[i] = Object.assign({}, quote, { userId });
    writeAll(userId, all);
  }

  // Removes only the one quote. Appliances and other data are never touched.
  function remove(userId, id) {
    const all = readAll(userId);
    writeAll(userId, all.filter(q => q.id !== id));
  }

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "q-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  return { list, add, update, remove, newId };
})();
