// diff.ts
// Compare a fetched snapshot (JSON files under fetched/<run>/) to current shill files in web/shills/
// Usage:
//   bun run diff.ts                               # newest subfolder, inspect mode
//   bun run diff.ts --dir fetched/<run>           # choose run, inspect mode
//   bun run diff.ts --mode inspect                # explicit inspect (ignores pinned and metrics)
//   bun run diff.ts --mode update                 # writes changes (affiliation/metrics) into shill files
//   bun run diff.ts --mode ids                    # scans web/shills for duplicate IDs (renamed accounts)

import fs from 'node:fs/promises';
import path from 'node:path';

type PubMetrics = {
  followers_count?: number;
  following_count?: number;
  tweet_count?: number;
  listed_count?: number;
};

type FetchedUser = {
  id: string;
  name?: string | null;
  username: string;
  description?: string | null;
  profile_image_url?: string | null;
  public_metrics?: PubMetrics | null;
  url?: string | null;
  verified?: boolean | null;
  verified_type?: string | null;
  pinned_tweet_id?: string | null;
  affiliation?: unknown;
  [key: string]: unknown;
};

type ShillFile = Record<string, any> & {
  id?: string | number;
  username?: string;
  name?: string;
  bio?: string;
  description?: string;
  public_metrics?: PubMetrics;
  pinned_tweet_id?: string;
  affiliation?: unknown;
  changes?: Array<Record<string, any>>;
};

function stderr(msg: string) { console.error(msg); }

function parseArgs(argv: string[]) {
  const out: { dir?: string; mode?: 'inspect' | 'update' | 'ids' } = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir' || a === '-d') {
      out.dir = argv[i + 1];
      i++;
    } else if (a === '--mode') {
      const v = (argv[i + 1] || '').toLowerCase();
      if (v === 'inspect' || v === 'update' || v === 'ids') out.mode = v as any;
      i++;
    } else if (a === '--inspect') {
      out.mode = 'inspect';
    } else if (a === '--update') {
      out.mode = 'update';
    } else if (a === '--ids') {
      out.mode = 'ids';
    }
  }
  return out;
}

async function listNewestFetchedRun(root: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    if (!dirs.length) return null;
    // Sort by trailing timestamp if present; fallback to mtime
    dirs.sort((a, b) => {
      const ta = Number(a.split('-').pop());
      const tb = Number(b.split('-').pop());
      if (!Number.isNaN(ta) && !Number.isNaN(tb)) return tb - ta;
      return a.localeCompare(b) * -1;
    });
    return path.join(root, dirs[0]);
  } catch { return null; }
}

function normalizeText(s: any): string {
  return String(s ?? '').trim();
}

function deepEqual(a: unknown, b: unknown): boolean {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return String(a) === String(b); }
}

function canonicalize(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const out: Record<string, any> = {};
    for (const k of keys) out[k] = canonicalize((value as any)[k]);
    return out;
  }
  return value;
}

function diffMetrics(newM?: PubMetrics | null, oldM?: PubMetrics | null): string[] {
  const out: string[] = [];
  const keys: (keyof PubMetrics)[] = ['followers_count', 'following_count', 'tweet_count', 'listed_count'];
  for (const k of keys) {
    const n = (newM?.[k] ?? null) as number | null;
    const o = (oldM?.[k] ?? null) as number | null;
    if (n == null && o == null) continue;
    if (n == null || o == null || n !== o) {
      const delta = (n != null && o != null) ? n - o : null;
      const deltaStr = delta == null ? '' : (delta > 0 ? ` (+${delta})` : ` (${delta})`);
      out.push(`  - ${k.replace('_', ' ')}: ${o ?? 'n/a'} -> ${n ?? 'n/a'}${deltaStr}`);
    }
  }
  return out;
}

async function main() {
  const { dir, mode = 'inspect' } = parseArgs(process.argv);
  const fetchedRoot = path.join(process.cwd(), 'fetched');
  const webShills = path.join(process.cwd(), 'web', 'shills');

  // IDs mode: group shills by identical id and print username sets that share the same id
  if (mode === 'ids') {
    let shillFiles: string[] = [];
    try { shillFiles = (await fs.readdir(webShills)).filter(f => f.endsWith('.json')); } catch {
      stderr('Failed to read web/shills');
      process.exit(1);
    }
    const idToUsers = new Map<string, string[]>();
    for (const f of shillFiles) {
      try {
        const raw = JSON.parse(await fs.readFile(path.join(webShills, f), 'utf8')) as ShillFile;
        const idVal = raw.id != null ? String(raw.id) : '';
        if (!idVal) continue;
        const uname = normalizeText(raw.username || path.basename(f, '.json'));
        const arr = idToUsers.get(idVal) || [];
        if (!arr.includes(uname)) arr.push(uname);
        idToUsers.set(idVal, arr);
      } catch {}
    }
    let groups = 0;
    for (const [, users] of idToUsers) {
      if (users.length > 1) {
        groups++;
        console.log(users.map(u => `@${u}`).join(', '));
      }
    }
    if (groups === 0) console.log('No duplicate IDs found.');
    return;
  }
  const runDir = dir ? path.resolve(dir) : await listNewestFetchedRun(fetchedRoot);
  if (!runDir) {
    stderr('No fetched runs found. Provide --dir fetched/<run> or run the fetch script first.');
    process.exit(1);
  }

  let files: string[] = [];
  try {
    files = (await fs.readdir(runDir)).filter(f => f.endsWith('.json'));
  } catch (e) {
    stderr(`Failed to read run directory: ${runDir}`);
    process.exit(1);
  }
  if (!files.length) {
    stderr('No JSON files found in run directory.');
    process.exit(1);
  }

  console.log(`Diff run: ${runDir} (${mode})`);
  console.log('');

  // Derive ISO timestamp for this run from folder name if possible
  let runIso = new Date().toISOString();
  try {
    const base = path.basename(runDir);
    const parts = base.split('-');
    const tsNum = Number(parts[parts.length - 1]);
    if (!Number.isNaN(tsNum)) runIso = new Date(tsNum).toISOString();
  } catch {}

  for (const f of files) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(runDir, f), 'utf8')) as FetchedUser;
      const username = normalizeText(raw.username);
      if (!username) {
        console.log(`${f}: Skipping (no username in fetched file)`);
        continue;
      }
      const shillPath = path.join(webShills, `${username}.json`);
      let shill: ShillFile | null = null;
      try { shill = JSON.parse(await fs.readFile(shillPath, 'utf8')) as ShillFile; } catch { shill = null; }

      const changes: string[] = [];
      if (!shill) {
        changes.push('  - Not in shills directory (new or untracked)');
      } else {
        // Name
        const oldName = normalizeText(shill.name ?? '');
        const newName = normalizeText(raw.name ?? '');
        if (oldName && newName && oldName !== newName) {
          changes.push(`  - Name: "${oldName}" -> "${newName}"`);
        }
        // Bio/Description
        const oldBio = normalizeText((shill as any).bio ?? (shill as any).description ?? '');
        const newBio = normalizeText(raw.description ?? '');
        if (oldBio && newBio && oldBio !== newBio) {
          changes.push(`  - Bio: "${oldBio}" -> "${newBio}"`);
        }
        // Pinned tweet (skip in inspect mode)
        if (mode !== 'inspect') {
          const oldPinned = normalizeText(shill.pinned_tweet_id ?? '');
          const newPinned = normalizeText(raw.pinned_tweet_id ?? '');
          if (oldPinned || newPinned) {
            if (oldPinned !== newPinned) {
              if (oldPinned && newPinned) changes.push(`  - Pinned tweet: ${oldPinned} -> ${newPinned}`);
              else if (!oldPinned && newPinned) changes.push(`  - New pinned tweet: ${newPinned}`);
              else if (oldPinned && !newPinned) changes.push('  - Pinned tweet removed');
            }
          }
        }
        // Affiliation
        const affNewCanon = canonicalize(raw.affiliation);
        const affOldCanon = canonicalize(shill.affiliation);
        const affChanged = !deepEqual(affNewCanon, affOldCanon);
        if (affChanged) {
          const aOld = affOldCanon ? JSON.stringify(affOldCanon) : 'none';
          const aNew = affNewCanon ? JSON.stringify(affNewCanon) : 'none';
          changes.push(`  - Affiliation changed: ${aOld} -> ${aNew}`);
        }
        // Public metrics
        if (mode !== 'inspect') {
          const metricDiffs = diffMetrics(raw.public_metrics ?? undefined, shill.public_metrics ?? undefined);
          if (metricDiffs.length) {
            changes.push('  - Public metrics:');
            changes.push(...metricDiffs);
          }
        }

        // Update mode: write change logs (affiliation + metrics) into file
        if (mode === 'update') {
          const updates: Record<string, any> = { at: runIso };
          if (affChanged) {
            updates.affiliation_before = affOldCanon ?? null;
            updates.affiliation_after = affNewCanon ?? null;
          }
          const metricDiffsObj: Record<string, { before: number | null; after: number | null }> = {};
          const keys: (keyof PubMetrics)[] = ['followers_count', 'following_count', 'tweet_count', 'listed_count'];
          for (const k of keys) {
            const before = (shill.public_metrics?.[k] ?? null) as number | null;
            const after = (raw.public_metrics?.[k] ?? null) as number | null;
            if (before !== after) metricDiffsObj[k] = { before, after };
          }
          if (Object.keys(metricDiffsObj).length > 0) updates.public_metrics = metricDiffsObj;

          if (Object.keys(updates).length > 1) {
            const existing: any[] = Array.isArray(shill.changes) ? shill.changes : [];
            existing.push(updates);
            const newShill = { ...shill, changes: existing } as any;
            await fs.writeFile(shillPath, JSON.stringify(newShill, null, 2), 'utf8');
          }
        }
      }

      if (changes.length) {
        console.log(`@${username}`);
        for (const line of changes) console.log(line);
        console.log('');
      }
    } catch (e) {
      console.log(`${f}: Failed to diff (${(e as Error).message})`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });


