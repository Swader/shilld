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

// SVG element helper
function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, any> | null,
  ...children: (Node | string | null | undefined)[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      // Event handlers are not expected on SVG elements here
      if (k === 'className') (el as any).className.baseVal = String(v);
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c == null) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el as SVGElementTagNameMap[K];
}

function renderLanding() {
  // Landing page is now static in index.html
  // No-op; leave existing DOM as-is
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
      const card = h("div", { className: "card user-card" });

      const head = h("div", { className: "user-head" });
      const avatarWrap = h("div", { className: "avatar-wrap" });
      const avatar = h("img", { className: "avatar", src: acc.image, alt: `Avatar of @${acc.username}`, loading: "lazy" });
      (avatar as HTMLImageElement).onerror = () => { (avatar as HTMLImageElement).src = "https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png"; };
      avatarWrap.append(avatar);
      if (acc.verified) {
        const cls = acc.subscription_type === 'business' ? 'yellow' : (acc.subscription_type === 'blue' ? 'blue' : (acc.subscription_type === 'government' ? 'gray' : 'blue'));
        avatarWrap.append(h("span", { className: `verified-icon ${cls} verified-overlay`, title: `Verified: ${acc.subscription_type || 'blue'}` }));
      }
      const names = h("div", { className: "user-names" },
        h("a", { href: `/shills/${acc.username}`, className: "user-name" }, acc.name || acc.username),
        h("div", { className: "user-username" }, `@${acc.username}`)
      );
      head.append(avatarWrap, names);
      card.append(head);

      const bio = h("div", { className: "muted clamp-3" }, acc.bio || "No bio available");
      card.append(bio);

      const badges = h("div", { className: "badge-row" });
      // affiliation
      const aff: any = (acc as any).affiliation;
      if (aff && (aff.description || aff.url)) {
        const affBadge = h("span", { className: "badge destructive" });
        if (aff.badge_url) affBadge.append(h("img", { src: aff.badge_url, alt: aff.description || "affil", loading: "lazy", onerror: (e: any) => e.currentTarget && (e.currentTarget.style.display = 'none') } as any));
        affBadge.append(aff.description || (aff.url ? new URL(aff.url).hostname.replace(/^www\./,'') : 'Affiliated'));
        badges.append(affBadge);
      } else {
        badges.append(h("span", { className: "badge secondary" }, "Independent"));
      }
      // subscription/verified
      if (acc.subscription_type === 'blue' || acc.verified) badges.append(h("span", { className: "badge outline" }, "Verified"));
      if (acc.subscription_type === 'none') badges.append(h("span", { className: "badge outline" }, "Free"));
      card.append(badges);

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

type CalculatedStats = {
  generated_at: string;
  totals: {
    accounts: number;
    affiliated: number;
    independent: number;
    verified_true: number;
    verified_false: number;
    free_accounts: number;
    with_proofs: number;
  };
  subscription_distribution: Record<string, number>;
  affiliation_counts: Record<string, number>;
  url_host_counts: Record<string, number>;
  followers: {
    count_available: number;
    min: number | null;
    max: number | null;
    average: number | null;
    median: number | null;
  };
  top_affiliations: Array<{ label: string; count: number }>;
  top_url_hosts: Array<{ host: string; count: number }>;
  followers_series?: number[];
};

function barChart(data: Array<{ label: string; value: number }>, opts: { width?: number; height?: number; color?: string; title?: string } = {}) {
  const width = opts.width ?? 720;
  const height = opts.height ?? Math.max(120, 24 * data.length + 40);
  const color = opts.color ?? '#f97316';

  const max = data.reduce((m, d) => Math.max(m, d.value), 0) || 1;
  const paddingLeft = 140;
  const paddingRight = 64; // extra space for value labels
  const barHeight = 20;
  const gap = 4;
  const totalBarsHeight = data.length * (barHeight + gap);
  const innerTop = 28;
  const svg = s('svg', { viewBox: `0 0 ${width} ${Math.max(height, innerTop + totalBarsHeight + 16)}`, role: 'img', 'aria-label': opts.title || 'Bar chart' });
  if (opts.title) svg.append(s('title', null, opts.title));
  const g = s('g', { transform: `translate(0, ${innerTop})` });
  svg.append(g);

  data.forEach((d, i) => {
    const y = i * (barHeight + gap);
    const w = Math.max(1, ((width - paddingLeft - paddingRight) * d.value) / max);
    const valueX = Math.min(paddingLeft + w + 6, width - 10);
    g.append(
      s('text', { x: 8, y: y + barHeight * 0.75, className: 'muted' }, d.label),
      s('rect', { x: paddingLeft, y, width: w, height: barHeight, fill: color, rx: 4 }),
      s('text', { x: valueX, y: y + barHeight * 0.75 }, String(d.value))
    );
  });
  return svg;
}

function donutChart(data: Array<{ name: string; value: number; color: string }>, opts: { width?: number; height?: number; label?: string } = {}) {
  const width = opts.width ?? 360;
  const height = opts.height ?? 260;
  const cx = width / 2;
  const cy = Math.min(height - 20, width / 2);
  const outerR = Math.min(cx, cy) - 10;
  const innerR = Math.max(outerR - 28, 20);
  const total = Math.max(1, data.reduce((s, d) => s + (d.value || 0), 0));

  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': opts.label || 'Donut chart' });
  let start = -Math.PI / 2; // start at top
  data.forEach((d) => {
    const angle = (d.value / total) * Math.PI * 2;
    const end = start + angle;
    const large = angle > Math.PI ? 1 : 0;
    // Outer arc
    const x0 = cx + outerR * Math.cos(start);
    const y0 = cy + outerR * Math.sin(start);
    const x1 = cx + outerR * Math.cos(end);
    const y1 = cy + outerR * Math.sin(end);
    // Inner arc
    const xi = cx + innerR * Math.cos(end);
    const yi = cy + innerR * Math.sin(end);
    const xj = cx + innerR * Math.cos(start);
    const yj = cy + innerR * Math.sin(start);
    const path = `M ${x0} ${y0} A ${outerR} ${outerR} 0 ${large} 1 ${x1} ${y1} L ${xi} ${yi} A ${innerR} ${innerR} 0 ${large} 0 ${xj} ${yj} Z`;
    svg.append(s('path', { d: path, fill: d.color }));
    start = end;
  });

  // Center label
  if (opts.label) {
    svg.append(
      s('text', { x: cx, y: cy - 4, className: 'chart-center', fill: '#fff' }, opts.label),
      s('text', { x: cx, y: cy + 14, className: 'chart-center chart-note' }, `${total.toLocaleString()} total`),
    );
  }

  // Legend
  const legend = h('div', { className: 'legend' });
  data.forEach((d) => {
    const pct = Math.round((d.value / total) * 100);
    legend.append(h('span', { className: 'legend-item' }, h('span', { className: 'legend-swatch', style: `background:${d.color}` }), `${d.name} ${pct}%`));
  });

  const wrapper = h('div', null);
  wrapper.append(svg, legend);
  return wrapper;
}

// Influence helpers
function lineChart(data: Array<{ date: string; value: number }>, opts: { width?: number; height?: number; color?: string } = {}) {
  const width = opts.width ?? 720;
  const height = opts.height ?? 220;
  const color = opts.color ?? '#22c55e';
  const pad = 32;
  if (!data.length) return s('svg', { viewBox: `0 0 ${width} ${height}` });
  const xs = data.map((_, i) => i);
  const ys = data.map(d => d.value);
  const xMax = Math.max(1, xs[xs.length - 1]);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const x = (i: number) => pad + (i / xMax) * (width - 2 * pad);
  const y = (v: number) => height - pad - ((v - yMin) / Math.max(1, (yMax - yMin))) * (height - 2 * pad);
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}` });
  // grid axes
  svg.append(
    s('line', { x1: pad, y1: height - pad, x2: width - pad, y2: height - pad, stroke: '#333' }),
    s('line', { x1: pad, y1: pad, x2: pad, y2: height - pad, stroke: '#333' })
  );
  const d = data.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ');
  svg.append(s('path', { d, stroke: color, fill: 'none', 'stroke-width': 2 }));
  // markers at ends
  svg.append(s('circle', { cx: x(0), cy: y(data[0].value), r: 2, fill: color }));
  svg.append(s('circle', { cx: x(xs[xs.length - 1]), cy: y(data[data.length - 1].value), r: 2, fill: color }));
  return svg;
}

function computeHistogram(values: number[], edges: number[]) {
  const bins = Array(edges.length - 1).fill(0);
  for (const v of values) {
    for (let i = 0; i < edges.length - 1; i++) {
      if (v >= edges[i] && v < edges[i + 1]) { bins[i]++; break; }
      if (i === edges.length - 2 && v >= edges[i + 1]) bins[i]++;
    }
  }
  return bins.map((count, i) => ({
    label: i === edges.length - 2 ? `${edges[i].toLocaleString()}+` : `${edges[i].toLocaleString()}–${(edges[i + 1] - 1).toLocaleString()}`,
    count
  }));
}

function lorenzData(values: number[]) {
  const x = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const n = x.length;
  const sum = x.reduce((s, v) => s + v, 0) || 1;
  let cum = 0;
  const pts: Array<{ p: number; L: number }> = [{ p: 0, L: 0 }];
  for (let i = 0; i < n; i++) { cum += x[i]; pts.push({ p: (i + 1) / n, L: cum / sum }); }
  return pts;
}

function gini(values: number[]) {
  const x = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const n = x.length;
  if (n === 0) return 0;
  const sum = x.reduce((s, v) => s + v, 0);
  if (sum === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * x[i];
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

function lorenzChart(points: Array<{ p: number; L: number }>, giniValue: number) {
  const width = 360;
  const height = 260;
  const pad = 28;
  const x = (p: number) => pad + p * (width - 2 * pad);
  const y = (L: number) => height - pad - L * (height - 2 * pad);

  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Lorenz curve' });
  // Axes
  svg.append(
    s('line', { x1: pad, y1: height - pad, x2: width - pad, y2: height - pad, stroke: '#333' }),
    s('line', { x1: pad, y1: pad, x2: pad, y2: height - pad, stroke: '#333' })
  );
  // Equality line
  svg.append(s('line', { x1: pad, y1: height - pad, x2: width - pad, y2: pad, stroke: '#555', 'stroke-dasharray': '4 4' }));
  // Lorenz path
  const d = points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${x(pt.p)} ${y(pt.L)}`).join(' ');
  svg.append(s('path', { d, stroke: '#60a5fa', fill: 'none', 'stroke-width': 2 }));
  // Labels
  svg.append(s('text', { x: width / 2, y: 18, className: 'chart-center' }, `Gini: ${giniValue.toFixed(2)}`));
  svg.append(s('text', { x: pad, y: height - 6, className: 'muted' }, '0%'));
  svg.append(s('text', { x: width - pad, y: height - 6, className: 'muted' }, '100%'));
  svg.append(s('text', { x: 10, y: pad + 4, className: 'muted' }, '100%'));

  return svg;
}

async function renderCharts() {
  clear(app);
  const header = h('div', { className: 'analytics-header' },
    h('h1', { className: 'analytics-title' }, 'Shilld Analytics'),
    h('p', { className: 'analytics-subtitle' }, 'Statistical breakdown of affiliations and verification data')
  );
  app.append(header);

  let stats: CalculatedStats | null = null;
  try {
    stats = await fetchJSON<CalculatedStats>('/_calculated_stats.json');
  } catch (e) {
    app.append(h('div', { className: 'card' }, h('div', { className: 'muted' }, 'Failed to load statistics.')));
    return;
  }
  if (!stats) return;

  // Metric cards
  const metrics = h('div', { className: 'metrics-grid' },
    h('section', { className: 'card metric' }, h('div', { className: 'label' }, 'Total Accounts'), h('div', { className: 'value' }, String(stats.totals.accounts)), h('div', { className: 'hint' }, 'All tracked accounts')),
    h('section', { className: 'card metric' }, h('div', { className: 'label' }, 'Affiliated Rate'), h('div', { className: 'value accent' }, `${Math.round((stats.totals.affiliated / Math.max(1, stats.totals.accounts)) * 100)}%`), h('div', { className: 'hint' }, `${stats.totals.affiliated} of ${stats.totals.accounts} accounts`)),
    h('section', { className: 'card metric' }, h('div', { className: 'label' }, 'Verification Rate'), h('div', { className: 'value info' }, `${Math.round((stats.totals.verified_true / Math.max(1, stats.totals.accounts)) * 100)}%`), h('div', { className: 'hint' }, `${stats.totals.verified_true} verified accounts`)),
    h('section', { className: 'card metric' }, h('div', { className: 'label' }, 'Avg Followers'), h('div', { className: 'value success' }, Number(Math.round((stats.followers.average || 0))).toLocaleString()), h('div', { className: 'hint' }, `Median: ${Number(stats.followers.median || 0).toLocaleString()}`))
  );
  app.append(metrics);

  const affiliationPairs = [
    { name: 'Affiliated', value: stats.totals.affiliated, color: '#8b5cf6' },
    { name: 'Independent', value: stats.totals.independent, color: '#f43f5e' },
  ];
  const verificationPairs = [
    { name: 'Verified', value: stats.totals.verified_true, color: '#38bdf8' },
    { name: 'Not Verified', value: stats.totals.verified_false, color: '#f59e0b' },
  ];

  const chartsTop = h('div', { className: 'charts-grid' });
  chartsTop.append(
    (function(){
      const card = h('section', { className: 'card' }, h('h3', null, 'Affiliation Breakdown'));
      const donut = donutChart(affiliationPairs, { label: 'Affiliation' });
      card.append(donut);
      return card;
    })(),
    (function(){
      const card = h('section', { className: 'card' }, h('h3', null, 'Verification Status'));
      const donut = donutChart(verificationPairs, { label: 'Verification' });
      card.append(donut);
      return card;
    })(),
    (function(){
      const subEntries = Object.entries(stats.subscription_distribution || {});
      const subs = subEntries.map(([k, v]) => ({ name: k, value: Number(v), color: k === 'blue' ? '#22c55e' : '#a78bfa' }));
      const card = h('section', { className: 'card' }, h('h3', null, 'Subscription Type'));
      card.append(donutChart(subs, { label: 'Subscription' }));
      return card;
    })(),
  );
  app.append(chartsTop);

  // Bottom charts
  const chartsBottom = h('div', { className: 'charts-bottom' });
  // Top affiliations bar
  const affData = (stats.top_affiliations || []).map(a => ({ label: a.label, value: a.count }));
  const barCard = h('section', { className: 'card' }, h('h3', null, 'Top Affiliations'));
  barCard.append(barChart(affData, { title: 'Top affiliations', color: '#ef4444' }));
  chartsBottom.append(barCard);

  // Influence distribution (histogram, Lorenz, Gini)
  const followers = Array.isArray(stats.followers_series) ? stats.followers_series : [];
  if (followers.length) {
    const extra = h('section', { className: 'card' }, h('h3', null, 'Influence Distribution'));
    const row = h('div', { style: 'display:grid; grid-template-columns: 1.2fr 1fr; gap: 16px;' });

    // Histogram
    const edges = [0, 1000, 5000, 10000, 50000, 100000, 250000, 500000];
    const hist = computeHistogram(followers, edges);
    row.append(barChart(hist.map(hh => ({ label: hh.label, value: hh.count })), { title: 'Followers histogram', color: '#f97316', height: 220 } as any));

    // Lorenz + Gini
    const lor = lorenzData(followers);
    const g = gini(followers);
    const lc = lorenzChart(lor, g);
    row.append(lc);
    extra.append(row);
    chartsBottom.append(extra);
  }
  app.append(chartsBottom);

  // Footer note
  app.append(h('div', { className: 'muted', style: 'text-align:center; margin-top:12px;' }, `Data generated on ${new Date(stats.generated_at).toLocaleDateString()}`));
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
    const badgesEl = frag.querySelector('[data-badges]') as HTMLElement;
    const proofsWrap = frag.querySelector('[data-proofs]') as HTMLElement;
    const mFollowers = frag.querySelector('[data-m-followers]') as HTMLElement;
    const mFollowing = frag.querySelector('[data-m-following]') as HTMLElement;
    const mPosts = frag.querySelector('[data-m-posts]') as HTMLElement;
    const mLists = frag.querySelector('[data-m-lists]') as HTMLElement;
    const changesSection = frag.querySelector('[data-changes-section]') as HTMLElement;
    const changeList = frag.querySelector('[data-change-list]') as HTMLElement;
    const affSection = frag.querySelector('[data-aff-section]') as HTMLElement;
    const affList = frag.querySelector('[data-aff-list]') as HTMLElement;

    avatar.src = data.image || (data as any).profile_image_url || '';
    avatar.alt = `Avatar of @${data.username}`;
    nameEl.textContent = data.name;
    userEl.textContent = `@${data.username}`;
    bioEl.textContent = data.bio || (data as any).description || '';
    if (data.verified) {
      const cls = data.subscription_type === 'business' ? 'yellow' : (data.subscription_type === 'blue' ? 'blue' : (data.subscription_type === 'government' ? 'gray' : 'blue'));
      verifiedEl.className = `verified-icon ${cls}`;
      verifiedEl.title = `Verified: ${data.subscription_type || 'blue'}`;
    }
    // badges: latest affiliation (from changes) + subscription
    if (badgesEl) {
      const changes = Array.isArray((data as any).changes) ? (data as any).changes : [];
      let latestAff: any = (data as any).affiliation || null;
      if (changes.length) {
        const sorted = [...changes].sort((a: any, b: any) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime());
        for (let i = sorted.length - 1; i >= 0; i--) {
          const c = sorted[i];
          if (Object.prototype.hasOwnProperty.call(c, 'affiliation_after')) { latestAff = c.affiliation_after ?? null; break; }
        }
      }
      if (latestAff && (latestAff.description || latestAff.url)) {
        const text = latestAff.description || (latestAff.url ? new URL(latestAff.url).hostname.replace(/^www\./,'') : 'Affiliated');
        const badge = latestAff.url
          ? h('a', { className: 'badge destructive', href: latestAff.url, target: '_blank', rel: 'noopener' })
          : h('span', { className: 'badge destructive' });
        if (latestAff.badge_url) badge.append(h('img', { src: latestAff.badge_url, alt: text, loading: 'lazy' }));
        badge.append(`Affiliated with ${text}`);
        badgesEl.append(badge);
      } else {
        badgesEl.append(h('span', { className: 'badge secondary' }, 'Independent'));
      }
      if (data.subscription_type === 'blue' || data.verified) badgesEl.append(h('span', { className: 'badge outline' }, 'X Premium'));
    }

    // metrics
    const pm = (data as any).public_metrics || {};
    if (mFollowers) mFollowers.textContent = Number(pm.followers_count || 0).toLocaleString();
    if (mFollowing) mFollowing.textContent = Number(pm.following_count || 0).toLocaleString();
    if (mPosts) mPosts.textContent = Number(pm.tweet_count || 0).toLocaleString();
    if (mLists) mLists.textContent = Number(pm.listed_count || 0).toLocaleString();

    if (!data.proofs || data.proofs.length === 0) {
      proofsWrap.append(h('div', { className: 'muted' }, 'No proofs provided.'));
    } else {
      data.proofs.forEach((p) => {
        const urls = h('div', null, ...p.urls.map((u) => h('div', null, h('a', { href: u, target: '_blank', rel: 'noopener' }, u))));
        proofsWrap.append(h('div', { className: 'proof' }, h('strong', null, p.name), h('div', { className: 'muted' }, p.date), h('div', null, p.description), urls));
      });
    }

    // changes list (followers)
    const changes = Array.isArray((data as any).changes) ? (data as any).changes : [];
    if (changes.length && changesSection && changeList) {
      const pts: Array<{ date: string; value: number }> = [];
      let latestValue: number | null = (pm && typeof pm.followers_count === 'number') ? pm.followers_count : null;
      const sorted = [...changes].sort((a: any, b: any) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime());
      sorted.forEach((c: any) => {
        const when = new Date(c.at || Date.now());
        const f = c.public_metrics && c.public_metrics.followers_count;
        if (f && typeof f.after === 'number') {
          pts.push({ date: when.toLocaleDateString(), value: Number(f.after) });
          latestValue = Number(f.after);
          changeList.append(
            h('div', { className: 'change-row' },
              h('div', { className: 'muted' }, when.toLocaleDateString()),
              h('div', null, `${Number(f.before||0).toLocaleString()} → ${Number(f.after||0).toLocaleString()}`)
            )
          );
        }
      });
      if (pts.length) {
        changesSection.removeAttribute('hidden');
        const svg = lineChart(pts, { height: 220, color: '#8b5cf6' });
        const holder = changesSection.querySelector('[data-linechart]');
        if (holder) { holder.textContent = ''; holder.append(svg); }
      }
    }

    // affiliation changes
    const affChanges = changes.filter((c: any) => c.affiliation_before || c.affiliation_after);
    if (affChanges.length && affSection && affList) {
      affSection.removeAttribute('hidden');
      affChanges.forEach((c: any) => {
        const when = new Date(c.at || Date.now()).toLocaleDateString();
        const row = h('div', { className: 'aff-row' },
          h('span', { className: 'muted', style: 'min-width:80px;' }, when),
          h('img', { src: c.affiliation_before?.badge_url || '', alt: '', onerror: (e: any) => e.currentTarget && (e.currentTarget.style.display = 'none') } as any),
          h('span', null, c.affiliation_before?.description || 'None'),
          h('span', { className: 'muted' }, '→'),
          h('img', { src: c.affiliation_after?.badge_url || '', alt: '', onerror: (e: any) => e.currentTarget && (e.currentTarget.style.display = 'none') } as any),
          h('span', null, c.affiliation_after?.description || 'None'),
        );
        affList.append(row);
      });
    }

    // Build final page order
    const metricsSection = (mFollowers && (mFollowers.closest('section') as HTMLElement)) || null;
    const proofsSection = (proofsWrap && (proofsWrap.closest('section') as HTMLElement)) || null;

    const parts: HTMLElement[] = [];
    parts.push(accountEl);
    if (metricsSection) parts.push(metricsSection);
    if (changesSection && !changesSection.hasAttribute('hidden')) parts.push(changesSection);
    if (affSection && !affSection.hasAttribute('hidden')) parts.push(affSection);
    if (proofsSection) parts.push(proofsSection);

    app.append(...parts);
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
  if (segments[0] === 'charts') return void renderCharts();
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
        // For the homepage, do a full navigation so the static landing renders without SPA
        if (href === '/') {
          e.preventDefault();
          window.location.assign('/');
          return;
        }
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


