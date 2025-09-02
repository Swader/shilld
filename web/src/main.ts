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
  return h(
    "a",
    {
      href,
      onclick: (e: MouseEvent) => {
        const url = new URL((e.currentTarget as HTMLAnchorElement).href, location.origin);
        if (url.origin === location.origin) {
          e.preventDefault();
          history.pushState({}, "", url.pathname);
          route();
        }
      },
    },
    text
  );
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
    const data = await fetchJSON<AllJson>("./shills/_all.json");
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
          const nameLink = h("a", { href: `/${acc.username}`, onclick: interceptNav }, `${acc.name} (@${acc.username})`);
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

  function interceptNav(e: MouseEvent) {
    const a = e.currentTarget as HTMLAnchorElement;
    const url = new URL(a.href, location.origin);
    if (url.origin === location.origin) {
      e.preventDefault();
      history.pushState({}, "", url.pathname);
      route();
    }
  }

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

async function renderAccount(username: string) {
  clear(app);
  const title = h("h1", null, `@${username}`);
  app.append(title);
  try {
    const data = await fetchJSON<AccountFull>(`./shills/${encodeURIComponent(username)}.json`);
    const header = h(
      "div",
      { className: "card", style: "display:flex; gap:16px; align-items:center;" },
      h("img", { src: data.image || data.profile_image_url, alt: `Avatar of @${username}`, width: 80, height: 80, style: "border-radius:12px; object-fit:cover;" }),
      h(
        "div",
        null,
        (() => {
          const title = h("h2", null, `${data.name} (@${data.username})`);
          if (data.verified) {
            const cls = data.subscription_type === 'business' ? 'yellow' : (data.subscription_type === 'blue' ? 'blue' : (data.subscription_type === 'government' ? 'gray' : 'blue'));
            title.appendChild(h("span", { className: `verified-icon ${cls}`, title: `Verified: ${data.subscription_type || 'blue'}` }));
          }
          return title;
        })(),
        h("div", { className: "muted" }, data.bio || data.description || ""),
        h(
          "div",
          { className: "muted" },
          [
            data.id ? `ID: ${data.id} · ` : "",
            data.subscription_type ? `Sub: ${data.subscription_type}` : "",
            data.verified ? " · Verified" : "",
          ].filter(Boolean).join("")
        ),
        data.url ? h("div", null, h("a", { href: data.url, target: "_blank", rel: "noopener" }, data.url)) : null,
        h("div", null, h("span", { className: "badge-preview" }, "PAID SHILL"))
      )
    );

    const proofsTitle = h("h3", null, "Proofs and Context");
    const proofsList = h("div", { className: "proofs" });
    if (!data.proofs || data.proofs.length === 0) {
      proofsList.append(h("div", { className: "muted" }, "No proofs provided for this demo."));
    } else {
      data.proofs.forEach((p) => {
        const urls = h(
          "div",
          null,
          ...p.urls.map((u) => h("div", null, h("a", { href: u, target: "_blank", rel: "noopener" }, u)))
        );
        proofsList.append(
          h(
            "div",
            { className: "proof" },
            h("strong", null, p.name),
            h("div", { className: "muted" }, p.date),
            h("div", null, p.description),
            urls
          )
        );
      });
    }

    app.append(header, proofsTitle, proofsList);
  } catch (_e) {
    app.append(h("div", { className: "muted" }, "Account not found."));
  }
}

function route() {
  const path = location.pathname.replace(/\/+$/, "");
  if (path === "" || path === "/") return void renderLanding();
  if (path === "/directory") return void renderDirectory();
  const user = path.slice(1);
  // guard against reserved paths
  const reserved = new Set(["favicon.ico", "assets", "shills"]);
  if (!user || reserved.has(user)) return void renderLanding();
  return void renderAccount(user);
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
        e.preventDefault();
        history.pushState({}, '', href);
        route();
      }
    },
    true
  );
  route();
});


