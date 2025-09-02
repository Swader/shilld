import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const webRoot = path.join(root, 'web');
const webSrc = path.join(webRoot, 'src');
const webDist = path.join(webRoot, 'dist');
const webShillsSrc = path.join(webRoot, 'shills');
const extRoot = path.join(root, 'ext');
const outRoot = path.join(root, 'dist');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir: string) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function log(msg: string) { console.log(msg); }

async function buildWebsite() {
  log('🏗️ Building website...');
  cleanDir(webDist);

  // Bundle TS
  ensureDir(path.join(webDist, 'assets'));
  await build({
    entryPoints: [path.join(webSrc, 'main.ts')],
    outfile: path.join(webDist, 'assets', 'main.js'),
    bundle: true,
    minify: true,
    sourcemap: true,
    format: 'esm',
    platform: 'browser',
    loader: { '.ts': 'ts' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  log('✅ JavaScript bundled.');

  // Copy static files
  // Ensure main.js is referenced by absolute path for nested routes
  const idxSrc = fs.readFileSync(path.join(webSrc, 'index.html'), 'utf8').replace('src="./assets/main.js"', 'src="/assets/main.js"');
  fs.writeFileSync(path.join(webDist, 'index.html'), idxSrc);
  fs.copyFileSync(path.join(webSrc, 'style.css'), path.join(webDist, 'style.css'));
  // Copy account template for runtime fetch
  const acctTpl = path.join(webSrc, 'account.html');
  if (fs.existsSync(acctTpl)) fs.copyFileSync(acctTpl, path.join(webDist, 'account.html'));
  const fallback404 = path.join(webRoot, '404.html');
  if (fs.existsSync(fallback404)) {
    fs.copyFileSync(fallback404, path.join(webDist, '404.html'));
  }
  // Generate sitemap.xml for account pages
  try {
    const shillsSrc = path.join(webRoot, 'shills');
    const domain = process.env.SITE_URL || 'https://shilld.xyz';
    if (fs.existsSync(shillsSrc)) {
      const files = fs.readdirSync(shillsSrc).filter(f => f.endsWith('.json') && f !== '_all.json');
      const urls = files.map(f => `${domain}/shills/${path.basename(f, '.json')}`);
      const now = new Date().toISOString();
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${u}</loc><lastmod>${now}</lastmod><changefreq>daily</changefreq><priority>0.6</priority></url>`).join('\n')}\n</urlset>\n`;
      fs.writeFileSync(path.join(webDist, 'sitemap.xml'), xml);
    }
  } catch {}
  log('✅ Static files copied.');

  // Copy images if any (support both src/images and web/images)
  const imgSrcs = [path.join(webSrc, 'images'), path.join(webRoot, 'images')];
  const imgDist = path.join(webDist, 'images');
  for (const imgSrc of imgSrcs) {
    if (fs.existsSync(imgSrc)) {
      ensureDir(imgDist);
      for (const f of fs.readdirSync(imgSrc)) {
        fs.copyFileSync(path.join(imgSrc, f), path.join(imgDist, f));
      }
    }
  }
  if (fs.existsSync(imgDist)) log('✅ Images copied.');

  // Aggregate per-user files under web/shills into dist/_all.json and dist per-account files
  const shillsOutRoot = path.join(webDist, 'shills');
  ensureDir(shillsOutRoot);
  const extShillsPath = path.join(extRoot, 'shills.json');
  type AccountBasic = {
    username: string;
    name?: string;
    image?: string; // avatar
    bio?: string; // description
    id?: string | null;
    affiliation?: any | null;
    subscription_type?: string | null;
    url?: string | null;
    verified?: boolean | null;
  };

  let accounts: AccountBasic[] = [];
  if (fs.existsSync(webShillsSrc)) {
    const files = fs.readdirSync(webShillsSrc).filter((f) => f.endsWith('.json') && f !== '_all.json');
    for (const f of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(webShillsSrc, f), 'utf8')) as any;
        const username = String(raw.username || '').replace(/^@/, '');
        if (!username) continue;
        const name = raw.name || username;
        const image = raw.image || raw.profile_image_url || `https://unavatar.io/twitter/${username}`;
        const bio = raw.bio || raw.description || `Bio for @${username}.`;
        const id = raw.id ?? null;
        const affiliation = raw.affiliation ?? null;
        const subscription_type = raw.subscription_type ?? null;
        // Prefer top-level url; otherwise first expanded_url in entities.url.urls
        const url = raw.url ?? (raw.entities && raw.entities.url && Array.isArray(raw.entities.url.urls) && raw.entities.url.urls[0]?.expanded_url) ?? null;
        const verified = (typeof raw.verified === 'boolean') ? raw.verified : null;
        accounts.push({ username, name, image, bio, id, affiliation, subscription_type, url, verified });
        // Copy per-account file into its folder under dist/shills/<username>/<username>.json
        const perOutDir = path.join(shillsOutRoot, username);
        ensureDir(perOutDir);
        fs.copyFileSync(path.join(webShillsSrc, f), path.join(perOutDir, `${username}.json`));
      } catch (e) {
        log(`⚠️  Skipping invalid shill file ${f}`);
      }
    }
  }

  // Fallbacks if no per-user files found
  if (!accounts.length) {
    try {
      const raw = JSON.parse(fs.readFileSync(extShillsPath, 'utf8'));
      let usernames: string[] = [];
      if (Array.isArray(raw)) usernames = raw as string[];
      else if (raw && Array.isArray(raw.usernames)) usernames = raw.usernames as string[];
      accounts = usernames.map((u) => ({ username: String(u) }));
    } catch {
      accounts = [ { username: 'atitty_' }, { username: 'eddyXBT' }, { username: 'MediaGiraffes' } ];
    }
    // Normalize/enrich
    accounts = accounts.map((a) => {
      const username = String(a.username).replace(/^@/, '');
      const name = a.name || username;
      const image = a.image || `https://unavatar.io/twitter/${username}`;
      const bio = a.bio || `Bio for @${username}.`;
      return { username, name, image, bio };
    });
    // Generate placeholder per-account files
    const today = new Date().toISOString().slice(0, 10);
    for (const acc of accounts) {
      const full = {
        ...acc,
        proofs: [
          { name: 'Placeholder proof', date: today, description: `Replace with real references for @${acc.username}.`, urls: [`https://x.com/${acc.username}`] }
        ]
      };
      fs.writeFileSync(path.join(shillsOutRoot, `${acc.username}.json`), JSON.stringify(full, null, 2));
    }
  }

  // Write aggregated _all.json
  fs.writeFileSync(path.join(shillsOutRoot, '_all.json'), JSON.stringify({ accounts }, null, 2));

  // Top-level shills.json for the extension to consume from the site and sync extension fallback
  const usernames = accounts.map((a) => a.username.toLowerCase());
  fs.writeFileSync(path.join(webDist, 'shills.json'), JSON.stringify({ usernames }, null, 2));
  fs.writeFileSync(extShillsPath, JSON.stringify({ usernames }, null, 2));

  log('✅ Aggregated shills data from per-user files.');

  // Pages compatibility: add .nojekyll
  fs.writeFileSync(path.join(webDist, '.nojekyll'), '');

  // Pre-render static account pages for direct access and SEO
  try {
    const shellPath = path.join(webSrc, 'index.html');
    const accountTplPath = path.join(webDist, 'account.html');
    const shell = fs.readFileSync(shellPath, 'utf8');
    const appMarker = '<main id="app" class="container"></main>';
    const escapeHtml = (s: any) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' } as any)[c]);
    const verifiedSpan = (sub?: string|null, ver?: boolean|null) => ver ? `<span class="verified-icon ${sub==='business'?'yellow':(sub==='blue'?'blue':(sub==='government'?'gray':'blue'))}" title="Verified: ${escapeHtml(sub||'blue')}"></span>` : '';

    const renderAccount = (a: AccountBasic, full: any): string => {
      const avatar = escapeHtml(a.image || (full && full.profile_image_url));
      const bio = escapeHtml(a.bio || (full && full.description) || '');
      const meta = [ a.id ? `ID: ${escapeHtml(a.id)}` : '', a.subscription_type ? `Sub: ${escapeHtml(a.subscription_type)}` : '', a.verified ? 'Verified' : '' ].filter(Boolean).join(' · ');
      const url = a.url ? `<div><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.url)}</a></div>` : '';
      const proofs = (full?.proofs || []).map((p: any) => {
        const urls = (p.urls || []).map((u: string) => `<div><a href="${escapeHtml(u)}" target="_blank" rel="noopener">${escapeHtml(u)}</a></div>`).join('');
        return `<div class="proof"><strong>${escapeHtml(p.name)}</strong><div class="muted">${escapeHtml(p.date)}</div><div>${escapeHtml(p.description)}</div>${urls}</div>`;
      }).join('') || `<div class="muted">No proofs provided.</div>`;
      return `
        <section class="card">
          <div style="display:flex; gap:16px; align-items:center;">
            <img src="${avatar}" alt="Avatar of @${escapeHtml(a.username)}" width="80" height="80" style="border-radius:12px; object-fit:cover;"/>
            <div>
              <h2>${escapeHtml(a.name)} (@${escapeHtml(a.username)}) ${verifiedSpan(a.subscription_type, a.verified)}</h2>
              <div class="muted">${bio}</div>
              <div class="muted">${meta}</div>
              ${url}
              <div><span class="badge-preview">PAID SHILL</span></div>
            </div>
          </div>
        </section>
        <h3>Proofs and Context</h3>
        <div class="proofs">${proofs}</div>
      `;
    };

    const baseShellNested = shell
      .replace('href="./style.css"', 'href="../style.css"')
      .replace('src="./assets/main.js"', 'src="../assets/main.js"')
      .replace(/src="\.\/images\//g, 'src="../images/');

    for (const acc of accounts) {
      const fullPath = path.join(shillsOutRoot, `${acc.username}.json`);
      // Adjust path for nested json location
      let full: any = {};
      try { full = JSON.parse(fs.readFileSync(path.join(shillsOutRoot, acc.username, `${acc.username}.json`), 'utf8')); } catch {}
      const content = renderAccount(acc, full);
      // Two-level nested page: /shills/<username>/index.html
      const baseShellNested2 = shell
        .replace('href="./style.css"', 'href="../../style.css"')
        .replace('src="./assets/main.js"', 'src="/assets/main.js"')
        .replace(/src="\.\/images\//g, 'src="../../images/');
      const html = baseShellNested2.replace(appMarker, `<main id="app" class="container">${content}</main>`);
      const outDir = path.join(webDist, 'shills', acc.username);
      ensureDir(outDir);
      fs.writeFileSync(path.join(outDir, 'index.html'), html);
      // No need to duplicate the account template per folder; keep a single copy at root
    }
    // Also emit a static directory page shell to allow direct visits
    const dirHtml = baseShellNested.replace(appMarker, '<main id="app" class="container"></main>');
    const dirOut = path.join(webDist, 'directory');
    ensureDir(dirOut);
    fs.writeFileSync(path.join(dirOut, 'index.html'), dirHtml);
    log('✅ Pre-rendered account pages in /shills/* and directory shell.');
  } catch (e) {
    log('⚠️  Failed to pre-render pages');
  }
  log('🎉 Website build complete → web/dist');
}

function zipExtension() {
  log('📦 Packaging Chrome extension...');
  ensureDir(outRoot);
  const extOutDir = path.join(outRoot, 'ext');
  ensureDir(extOutDir);
  const zipPath = path.join(extOutDir, 'shilld.zip');
  try {
    // Use the system zip utility (available on macOS/Linux). Exclude VCS and OS junk.
    const cmd = `cd ${JSON.stringify(extRoot)} && zip -rq ${JSON.stringify(zipPath)} . -x "*.DS_Store" "*.git*"`;
    execSync(cmd, { stdio: 'inherit', shell: '/bin/zsh' });
    log(`✅ Extension packaged at ${zipPath}`);
  } catch (e) {
    console.error('❌ Failed to zip extension. Ensure the "zip" CLI is available.');
    throw e;
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const extOnly = args.has('--ext-only');
  const siteOnly = args.has('--site-only');

  if (!siteOnly) zipExtension();
  if (!extOnly) await buildWebsite();
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
  });
}

export { buildWebsite };


