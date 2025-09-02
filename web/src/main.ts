type Proof = {
  name: string;
  date: string;
  description: string;
  urls: string[];
};

type AccountBasic = {
  username: string;
  name: string;
  image: string;
  bio: string;
  id?: string | null;
  affiliation?: any | null;
  subscription_type?: string | null;
  url?: string | null;
  verified?: boolean | null;
};

type AccountFull = AccountBasic & {
  proofs: Proof[];
};

const app = document.getElementById("app")!;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, any> | null,
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === "className") (el as any).className = v as string;
      else if (k.startsWith("on") && typeof v === "function") (el as any)[k.toLowerCase()] = v;
      else if (v != null) (el as any)[k] = v;
    }
  }
  for (const c of children) {
    if (c == null) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function clear(node: Element) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function titleCase(username: string): string {
  return username.replace(/[_-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function normalizeQuery(s: string): string {
  return s.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function computeSearchScore(acc: AccountBasic, query: string): number {
  const q = normalizeQuery(query);
  if (!q) return 1; // neutral score shows all

  const uname = normalizeQuery(acc.username);
  const name = normalizeQuery(acc.name || "");
  const bio = normalizeQuery(acc.bio || "");
  const id = acc.id ? String(acc.id) : "";
  const url = normalizeQuery(acc.url || "");

  // Highest priority: exact username
  if (uname === q) return 100;
  // Starts with username or @username
  if (uname.startsWith(q) || ("@" + uname).startsWith(q)) return 90;

  // Exact name
  if (name === q) return 80;
  // Word-boundary name match
  if (new RegExp(`\\b${escapeRegex(q)}`).test(name)) return 70;

  // Substring username
  if (uname.includes(q)) return 60;
  // Substring name
  if (name.includes(q)) return 50;

  // ID and URL (lower weight)
  if (id && id.includes(q)) return 30;
  if (url && url.includes(q)) return 25;

  // Bio substring (lowest weight, only if reasonably specific)
  if (q.length >= 3 && bio.includes(q)) return 10;

  return 0;
}

function navLink(href: string, text: string) {
  return h("a", { href }, text);
}

async function renderLanding() {
  clear(app);
  const hero = h(
    "section",
    { className: "hero" },
    h(
      "div",
      { className: "card" },
      h("h1", null, "Shilld: Visible PAID SHILL badges on X/Twitter"),
      h(
        "p",
        null,
        "The Shilld extension adds a bold ",
        h("span", { className: "badge-preview" }, "PAID SHILL"),
        " badge to tweets and profile headers for usernames from a public list."
      ),
      h(
        "ul",
        { className: "feature-list" },
        h("li", { className: "feature" }, "Fetches the canonical list from /shills/_all.json (this site)."),
        h("li", { className: "feature" }, "Background service worker caches results for 5 days."),
        h("li", { className: "feature" }, "Works on x.com and twitter.com, including dynamic timelines."),
        h("li", { className: "feature" }, "No data leaves your browser.")
      ),
      h("div", { style: "display:flex; gap:12px;" }, navLink("/directory", "Browse directory"), h("a", { className: "btn", href: "#install" }, "How to install"))
    ),
    h(
      "div",
      { className: "card hero-visual" },
      h("img", { src: "./images/hero.png", alt: "Badge preview screenshot" })
    )
  );

  const how = h(
    "section",
    { className: "card", id: "how" },
    h("h2", null, "How it works"),
    h(
      "p",
      null,
      "A background service worker fetches the usernames list from this site (CORS-safe in the extension context), caches it for 5 days in chrome.storage, and the content script inserts the badge next to usernames in tweets and on profile headers."
    )
  );

  app.append(hero, how);
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function fetchHTML(url: string): Promise<DocumentFragment> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const text = await res.text();
  const tpl = document.createElement('template');
  tpl.innerHTML = text;
  return tpl.content;
}

async function renderDirectory() {
  clear(app);
  const title = h("h1", null, "Directory");
  const searchWrap = h("div", { className: "search" });
  const input = h("input", { placeholder: "Search name, @handle, bio" }) as HTMLInputElement;
  searchWrap.append(input, h("div", { className: "muted" }));

  const resultsWrap = h("div", null);
  const grid = h("div", { className: "grid" });
  resultsWrap.append(grid);
  app.append(title, searchWrap, resultsWrap);

  type AllJson = { accounts: AccountBasic[] };
  let all: AccountBasic[] = [];
  try {
    const data = await fetchJSON<AllJson>("/shills/_all.json");
    all = data.accounts || [];
  } catch (_e) {
    grid.append(h("div", { className: "muted" }, "Failed to load directory."));
    return;
  }

  function render(list: AccountBasic[]) {
    clear(grid);
    list.forEach((acc) => {
      const card = h(
        "div",
        { className: "card user-card" },
        h("img", { src: acc.image, alt: `Avatar of @${acc.username}`, loading: "lazy" }),
        (() => {
          const nameLink = h("a", { href: `/shills/${acc.username}` }, `${acc.name} (@${acc.username})`);
          const wrapper = h("div", null, nameLink);
          if (acc.verified) {
            const cls = acc.subscription_type === 'business' ? 'yellow' : (acc.subscription_type === 'blue' ? 'blue' : (acc.subscription_type === 'government' ? 'gray' : 'blue'));
            wrapper.appendChild(h("span", { className: `verified-icon ${cls}`, title: `Verified: ${acc.subscription_type || 'blue'}` }));
          }
          return wrapper;
        })(),
        h("div", { className: "muted" }, acc.bio),
        acc.url ? h("div", null, h("a", { href: acc.url, target: "_blank", rel: "noopener" }, acc.url)) : null
      );
      grid.append(card);
    });
  }

  // Per-link interception removed; global handler manages SPA routing

  render(all);

  input.addEventListener("input", () => {
    const q = input.value.trim();
    if (q.length === 0) {
      render(all);
      return;
    }
    const scored = all
      .map((a) => ({ a, s: computeSearchScore(a, q) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s)
      .map((x) => x.a);
    render(scored);
  });
}

function hasExistingAccountRender(): boolean {
  // detects pre-rendered account content inside main#app
  return !!document.querySelector('main#app section.card');
}

async function safeFetchAccount(username: string): Promise<AccountFull | null> {
  try {
    return await fetchJSON<AccountFull>(`/shills/${encodeURIComponent(username)}/${encodeURIComponent(username)}.json`);
  } catch (_e) {
    return null;
  }
}

async function renderAccount(username: string) {
  const title = h("h1", null, `@${username}`);

  try {
    // Resolve canonical username first to avoid extra failing requests
    let canonical = username;
    try {
      const all = await fetchJSON<{ accounts: AccountBasic[] }>(`/shills/_all.json`);
      const match = (all.accounts || []).find(a => a.username.toLowerCase() === username.toLowerCase());
      if (match) canonical = match.username;
    } catch (e) {
      console.log('Failed to load _all.json for canonicalization:', e);
    }

    const hasPrerender = !!document.querySelector('main #app section.card');
    console.log('[account] canonical', canonical, 'hasPrerender', hasPrerender);
    const data = await safeFetchAccount(canonical);
    if (!data) {
      if (!hasPrerender) {
        clear(app);
        app.append(title);
        app.append(h("div", { className: "muted" }, "Account not found."));
      } else {
        console.warn('Account JSON not found; keeping prerendered content.');
      }
      return;
    }

    // We have data: render fresh content from template
    clear(app);
    app.append(title);
    const tpl = await fetchHTML('/account.html');
    const tplEl = tpl.querySelector('#account-template') as HTMLTemplateElement | null;
    const frag = tplEl && 'content' in tplEl ? (tplEl as any).content.cloneNode(true) as DocumentFragment : tpl;
    const accountEl = frag.querySelector('[data-account]') as HTMLElement;
    const avatar = frag.querySelector('[data-avatar]') as HTMLImageElement;
    const nameEl = frag.querySelector('[data-name]') as HTMLElement;
    const userEl = frag.querySelector('[data-username]') as HTMLElement;
    const verifiedEl = frag.querySelector('[data-verified]') as HTMLElement;
    const bioEl = frag.querySelector('[data-bio]') as HTMLElement;
    const metaEl = frag.querySelector('[data-meta]') as HTMLElement;
    const urlEl = frag.querySelector('[data-url]') as HTMLAnchorElement;
    const proofsWrap = frag.querySelector('[data-proofs]') as HTMLElement;

    avatar.src = data.image || (data as any).profile_image_url || '';
    avatar.alt = `Avatar of @${data.username}`;
    nameEl.textContent = data.name;
    userEl.textContent = `@${data.username}`;
    bioEl.textContent = data.bio || (data as any).description || '';
    metaEl.textContent = [ data.id ? `ID: ${data.id} · ` : '', data.subscription_type ? `Sub: ${data.subscription_type}` : '', data.verified ? ' · Verified' : '' ].filter(Boolean).join('');
    if (data.url) { urlEl.href = data.url; urlEl.textContent = data.url; } else { urlEl.parentElement?.remove(); }
    if (data.verified) {
      const cls = data.subscription_type === 'business' ? 'yellow' : (data.subscription_type === 'blue' ? 'blue' : (data.subscription_type === 'government' ? 'gray' : 'blue'));
      verifiedEl.className = `verified-icon ${cls}`;
      verifiedEl.title = `Verified: ${data.subscription_type || 'blue'}`;
    }

    if (!data.proofs || data.proofs.length === 0) {
      proofsWrap.append(h('div', { className: 'muted' }, 'No proofs provided.'));
    } else {
      data.proofs.forEach((p) => {
        const urls = h('div', null, ...p.urls.map((u) => h('div', null, h('a', { href: u, target: '_blank', rel: 'noopener' }, u))));
        proofsWrap.append(h('div', { className: 'proof' }, h('strong', null, p.name), h('div', { className: 'muted' }, p.date), h('div', null, p.description), urls));
      });
    }

    app.append(accountEl, frag.querySelector('h3')!, proofsWrap);
  } catch (e) {
    console.log('renderAccount fatal', e);
    if (!hasExistingAccountRender()) {
      app.append(h("div", { className: "muted" }, "Account not found."));
    }
  }
}

function route() {
  const segments = location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  console.log('[route] path', location.pathname, 'segments', segments);
  if (segments.length === 0) return void renderLanding();
  if (segments[0] === 'directory') return void renderDirectory();
  if (segments[0] === 'shills' && segments[1]) {
    console.log('[route] account', segments[1]);
    return void renderAccount(segments[1]);
  }
  if (segments.length === 1) {
    console.log('[route] legacy account', segments[0]);
    return void renderAccount(segments[0]);
  }
  return void renderLanding();
}

window.addEventListener("popstate", route);
window.addEventListener("DOMContentLoaded", () => {
  // Intercept internal link clicks for SPA navigation
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest && (target.closest('a[href]') as HTMLAnchorElement | null);
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) return;
      // Internal link (begins with '/')
      if (href.startsWith('/')) {
        // Avoid duplicate navigation if we're already at this path
        if (location.pathname === href) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        history.pushState({}, '', href);
        route();
      }
    },
    true
  );
  route();
});


