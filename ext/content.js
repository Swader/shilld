(() => {
  const SHILL_URL_BASE = "https://shilld.xyz/";

  const shills = new Set();

  // Ask the background service worker for the canonical list (with 5-day cache)
  chrome.runtime.sendMessage({ type: "GET_SHILLS" }, (resp) => {
    if (!resp) {
      console.warn("Shilld: no response from background when requesting shills list");
      return;
    }
    if (resp.error) {
      console.warn("Shilld: using empty list due to error:", resp.error);
    }
    const list = Array.isArray(resp.usernames) ? resp.usernames : [];
    list.forEach((u) => shills.add(normalizeUsername(u)));
    // Initial sweep after list loads
    scanAll();
  });

  function normalizeUsername(u) {
    if (!u) return "";
    u = String(u).trim();
    if (u.startsWith("@")) u = u.slice(1);
    return u.toLowerCase();
  }

  function createBadge(username) {
    const a = document.createElement("a");
    a.className = "shilld-badge";
    a.textContent = "PAID SHILL";
    a.href = SHILL_URL_BASE + encodeURIComponent(username);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = `This account (@${username}) is marked as a PAID SHILL. Click to view details.`;
    return a;
  }

  function extractUsernameFromUserLink(a) {
    try {
      const url = new URL(a.getAttribute("href"), location.origin);
      const path = url.pathname.split("/").filter(Boolean);
      if (!path.length) return null;
      const user = path[0];
      // Exclude non-user paths commonly used by X/Twitter
      const reserved = new Set([
        "home",
        "explore",
        "notifications",
        "messages",
        "i",
        "settings",
        "compose",
        "search",
        "logout",
        "tos",
        "privacy"
      ]);
      if (reserved.has(user)) return null;
      return normalizeUsername(user);
    } catch (_e) {
      return null;
    }
  }

  function addBadgeToUserNameContainer(container, username) {
    if (!container || !username) return;
    if (container.querySelector(".shilld-badge")) return; // already added
    const badge = createBadge(username);
    container.appendChild(badge);
  }

  function processTweetArticle(article) {
    if (!article || article.dataset.shilldProcessed === "true") return;

    const header = article.querySelector('div[data-testid="User-Name"]');
    if (!header) {
      // Header can render slightly later; let MutationObserver catch it
      return;
    }

    const link = header.querySelector('a[href^="/"]');
    const username = link ? extractUsernameFromUserLink(link) : null;

    if (username && shills.has(username)) {
      addBadgeToUserNameContainer(header, username);
    }

    article.dataset.shilldProcessed = "true";
  }

  function processProfileHeader() {
    const header = document.querySelector('div[data-testid="UserName"]');
    if (!header || header.dataset.shilldProcessed === "true") return;

    let username = null;
    const link = header.querySelector('a[href^="/"]');
    if (link) {
      username = extractUsernameFromUserLink(link);
    }

    // Fallbacks
    if (!username) {
      const text = header.textContent || "";
      const m = text.match(/@([A-Za-z0-9_]{1,15})/);
      if (m) username = normalizeUsername(m[1]);
    }
    if (!username) {
      const path = location.pathname.split("/").filter(Boolean);
      if (path.length === 1) username = normalizeUsername(path[0]);
    }

    if (username && shills.has(username)) {
      addBadgeToUserNameContainer(header, username);
    }

    header.dataset.shilldProcessed = "true";
  }

  function scanAll() {
    // Tweets in timeline, threads, search, etc.
    document.querySelectorAll('article[role="article"]').forEach(processTweetArticle);
    // Profile page header
    processProfileHeader();
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "childList") {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;

          if (node.matches && node.matches('article[role="article"]')) {
            processTweetArticle(node);
          } else {
            node.querySelectorAll && node.querySelectorAll('article[role="article"]').forEach(processTweetArticle);
            const header = node.querySelector && node.querySelector('div[data-testid="UserName"]');
            if (header) processProfileHeader();
          }
        });
      }
    }
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
  });
})();

