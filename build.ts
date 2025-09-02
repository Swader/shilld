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
  fs.copyFileSync(path.join(webSrc, 'index.html'), path.join(webDist, 'index.html'));
  fs.copyFileSync(path.join(webSrc, 'style.css'), path.join(webDist, 'style.css'));
  const fallback404 = path.join(webRoot, '404.html');
  if (fs.existsSync(fallback404)) {
    fs.copyFileSync(fallback404, path.join(webDist, '404.html'));
  }
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
  type AccountBasic = { username: string; name?: string; image?: string; bio?: string };

  let accounts: AccountBasic[] = [];
  if (fs.existsSync(webShillsSrc)) {
    const files = fs.readdirSync(webShillsSrc).filter((f) => f.endsWith('.json') && f !== '_all.json');
    for (const f of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(webShillsSrc, f), 'utf8')) as any;
        const username = String(raw.username || '').replace(/^@/, '');
        if (!username) continue;
        const name = raw.name || username;
        const image = raw.image || `https://unavatar.io/twitter/${username}`;
        const bio = raw.bio || `Bio for @${username}.`;
        accounts.push({ username, name, image, bio });
        // Copy per-account file to dist
        fs.copyFileSync(path.join(webShillsSrc, f), path.join(shillsOutRoot, `${username}.json`));
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


