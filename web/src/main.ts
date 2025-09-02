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

function fuzzyIncludes(haystack: string, needle: string): boolean {
  const h = normalizeQuery(haystack);
  const n = normalizeQuery(needle);
  if (!n) return true;
  // simple subsequence match
  let i = 0;
  for (const ch of h) {
    if (ch === n[i]) i++;
    if (i >= n.length) return true;
  }
  return h.includes(n);
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
  searchWrap.append(input, h("div", { className: "muted" }, "Client-side only"));

  const grid = h("div", { className: "grid" });
  app.append(title, searchWrap, grid);

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
        h("a", { href: `/${acc.username}`, onclick: interceptNav }, `${acc.name} (@${acc.username})`),
        h("div", { className: "muted" }, acc.bio)
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
    const filtered = all.filter((a) =>
      fuzzyIncludes(a.username, q) || fuzzyIncludes(a.name, q) || fuzzyIncludes(a.bio, q)
    );
    render(filtered);
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
      h("img", { src: data.image, alt: `Avatar of @${username}`, width: 80, height: 80, style: "border-radius:12px; object-fit:cover;" }),
      h("div", null, h("h2", null, data.name), h("div", { className: "muted" }, data.bio), h("div", null, h("span", { className: "badge-preview" }, "PAID SHILL")))
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


