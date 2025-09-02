(() => {
  const SHILLS_URL = "https://shilld.xyz/shills/_all.json";
  const CACHE_KEY = "shilld_cache_usernames";
  const CACHE_TS_KEY = "shilld_cache_ts";
  const TTL_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

  function normalizeUsername(u) {
    if (!u) return "";
    u = String(u).trim();
    if (u.startsWith("@")) u = u.slice(1);
    return u.toLowerCase();
  }

  function normalizeList(data) {
    // Accept various shapes and reduce to ["username", ...]
    // 1) { accounts: [{ username, ... }] }
    if (data && Array.isArray(data.accounts)) {
      return data.accounts
        .map((a) => a && a.username)
        .map(normalizeUsername)
        .filter(Boolean);
    }
    // 2) { usernames: ["..."] } or ["..."]
    let arr;
    if (Array.isArray(data)) arr = data;
    else if (data && Array.isArray(data.usernames)) arr = data.usernames;
    else return [];
    return arr.map(normalizeUsername).filter(Boolean);
  }

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  }

  async function fetchRemote() {
    const res = await fetch(SHILLS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = normalizeList(json);
    await storageSet({ [CACHE_KEY]: list, [CACHE_TS_KEY]: Date.now() });
    return list;
  }

  async function fetchLocalFallback() {
    try {
      const url = chrome.runtime.getURL("shills.json");
      const r = await fetch(url);
      const j = await r.json();
      const list = normalizeList(j);
      return list;
    } catch (_e) {
      return [];
    }
  }

  async function getShills() {
    const stored = await storageGet([CACHE_KEY, CACHE_TS_KEY]);
    const cached = stored[CACHE_KEY] || [];
    const ts = stored[CACHE_TS_KEY] || 0;
    const age = Date.now() - ts;

    if (cached.length && age < TTL_MS) {
      return cached;
    }

    try {
      return await fetchRemote();
    } catch (e) {
      // Network or parsing failed: return stale cache if present, else fallback
      if (cached.length) return cached;
      const fallback = await fetchLocalFallback();
      if (fallback.length) {
        await storageSet({ [CACHE_KEY]: fallback, [CACHE_TS_KEY]: Date.now() });
      }
      return fallback;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "GET_SHILLS") {
      getShills()
        .then((list) => sendResponse({ usernames: list }))
        .catch((err) => sendResponse({ usernames: [], error: String(err && err.message || err) }));
      return true; // async response
    }
  });

  chrome.runtime.onInstalled.addListener(() => {
    // Warm the cache; ignore errors
    fetchRemote().catch(() => {});
  });
})();

