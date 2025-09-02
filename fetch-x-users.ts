// fetch-x-users.ts
// Bun-runnable script to read usernames from a CSV and fetch full user datasets
// from the X API v2, writing each profile to its own fetched/<username>.json file.
//
// Usage:
//   bun run fetch-x-users.ts            # reads usernames.csv in the current folder
//   bun run fetch-x-users.ts --csv myfile.csv
//
// Requirements:
//   - Place your API token in .env as X_BEARER_TOKEN=... (Bun loads .env automatically)
//   - The CSV should contain a column named "username" (preferred) or just the
//     usernames in the first column. Values may optionally start with @.
//
// Notes:
//   - The script validates that the provided file has a .csv extension.
//   - It will request a broad set of user.fields and automatically fall back to a
//     safe subset if the API rejects unknown fields.
//   - API limit: up to 100 usernames per request. If your CSV contains more than
//     100 unique usernames, the script will exit with an error (split the file).
//   - Each user is saved to fetched/<username>.json.
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_CSV = "usernames.csv";
const OUTPUT_DIR = "fetched";

interface XAPIError {
  value?: string;
  detail?: string;
  title?: string;
  type?: string;
  status?: number;
}

interface XPublicMetrics {
  followers_count?: number;
  following_count?: number;
  tweet_count?: number;
  listed_count?: number;
}

interface XUserEntities {
  url?: unknown;
  description?: unknown;
  [key: string]: unknown;
}

interface RawXUser {
  id: string;
  name: string;
  username: string;
  description?: string;
  entities?: XUserEntities;
  profile_image_url?: string;
  profile_banner_url?: string; // may not be supported in all tiers
  public_metrics?: XPublicMetrics;
  url?: string; // profile website URL (see entities.url for details)
  verified?: boolean;
  verified_type?: string; // e.g., blue, business, government, none (varies)
  affiliation?: unknown; // placeholder for any affiliation object if provided
  [key: string]: unknown;
}

interface XUsersByResponse {
  data?: RawXUser[];
  errors?: XAPIError[];
}

class RateLimitError extends Error {
  retryAfterSec?: number;
  resetAtEpochSec?: number;
  constructor(message: string, opts?: { retryAfterSec?: number; resetAtEpochSec?: number }) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSec = opts?.retryAfterSec;
    this.resetAtEpochSec = opts?.resetAtEpochSec;
  }
}

function stderr(msg: string) {
  console.error(msg);
}

function parseArgs(argv: string[]) {
  const out: { csv?: string } = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--csv" || a === "-c") {
      const next = argv[i + 1];
      if (!next) {
        stderr("Error: --csv requires a filename");
        process.exit(1);
      }
      out.csv = next;
      i++;
    } else {
      // ignore unknown flags/positionals for now
    }
  }
  return out;
}

function ensureCsvExtension(filePath: string) {
  const lower = filePath.toLowerCase();
  if (!lower.endsWith(".csv")) {
    stderr(`Error: Expected a .csv file, got: ${filePath}`);
    process.exit(1);
  }
}

// Minimal CSV parser that supports quoted fields and commas.
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (c === '"') {
      if (inQuotes) {
        // Double quote inside quotes -> escaped quote
        if (text[i + 1] === '"') {
          cell += '"';
          i++; // skip next quote
        } else {
          inQuotes = false;
        }
      } else {
        inQuotes = true;
      }
    } else if (c === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !inQuotes) {
      // End of line. Handle CRLF or LF
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }
  // Push last cell/row if any
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function normalizeUsername(u: string): string {
  const trimmed = u.trim();
  const noAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return noAt;
}

function sanitizeFilename(basename: string): string {
  // Replace any disallowed path characters with underscores
  return basename.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
}

function extractUsernames(csvText: string): string[] {
  const rows = parseCSV(csvText)
    .map(r => r.map(c => c.trim()))
    .filter(r => r.length > 0 && r.some(c => c.length > 0));

  if (rows.length === 0) return [];

  // Detect header
  const header = rows[0].map(h => h.toLowerCase());
  const possibleCols = ["username", "handle", "user"];
  let colIndex = 0;
  let startRow = 0;

  const found = header.findIndex(h => possibleCols.includes(h));
  if (found >= 0) {
    colIndex = found;
    startRow = 1; // skip header
  } else {
    // No header, treat first column as usernames
    colIndex = 0;
    startRow = 0;
  }

  const set = new Set<string>();
  for (let i = startRow; i < rows.length; i++) {
    const v = rows[i][colIndex];
    if (!v) continue;
    const name = normalizeUsername(v);
    if (name) set.add(name);
  }
  return Array.from(set);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function deriveSubscriptionType(verified?: boolean, verified_type?: string): string | null {
  if (verified_type && typeof verified_type === "string") return verified_type;
  if (verified === true) return "verified";
  return "none";
}

async function fetchUsersBatch(usernames: string[], token: string, userFields: string[]): Promise<XUsersByResponse> {
  const endpoint = "https://api.x.com/2/users/by";
  const params = new URLSearchParams({
    usernames: usernames.join(","),
    "user.fields": userFields.join(","),
  });

  const res = await fetch(`${endpoint}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  let json: XUsersByResponse | null = null;
  const text = await res.text();
  try {
    json = text ? (JSON.parse(text) as XUsersByResponse) : {};
  } catch {
    json = {};
  }

  if (!res.ok) {
    // Handle HTTP 429 rate limits explicitly
    const is429 = res.status === 429 || (json?.errors || []).some(e => e?.status === 429);
    if (is429) {
      const retryAfterStr = res.headers.get("retry-after") || undefined;
      const rlResetStr = res.headers.get("x-rate-limit-reset") || undefined;
      const retryAfterSec = retryAfterStr ? Number(retryAfterStr) : undefined;
      const resetAtEpochSec = rlResetStr ? Number(rlResetStr) : undefined;
      throw new RateLimitError("Rate limit exceeded (HTTP 429).", { retryAfterSec, resetAtEpochSec });
    }
    const errDetail = json?.errors?.map(e => e.detail).filter(Boolean).join(" | ") || `${res.status} ${res.statusText}`;
    throw new Error(`X API error: ${errDetail}`);
  }

  return json || {};
}

async function fetchUsersWithFallback(usernames: string[], token: string): Promise<RawXUser[]> {
  // Preferred broad field set (some may not be available on all tiers)
  const broadFields = [
    "created_at",
    "description",
    "entities",
    "location",
    "pinned_tweet_id",
    "profile_image_url",
    "public_metrics",
    "url",
    "verified",
    "verified_type",
    // These may or may not be supported depending on API tier
    "profile_banner_url",
    "affiliation",
  ];

  // Safe subset expected to work broadly
  const safeFields = [
    "description",
    "entities",
    "public_metrics",
    "profile_image_url",
    "url",
    "verified",
    "verified_type",
  ];

  try {
    const resp = await fetchUsersBatch(usernames, token, broadFields);
    return resp.data ?? [];
  } catch (e) {
    // If we hit a rate limit, do NOT try a second call; bubble up to main immediately
    if (e instanceof RateLimitError) {
      throw e;
    }
    stderr(`Warning: broad user.fields failed; retrying with a safe subset. (${(e as Error).message})`);
    const resp = await fetchUsersBatch(usernames, token, safeFields);
    return resp.data ?? [];
  }
}

async function fetchUsersWithMeta(usernames: string[], token: string): Promise<{ users: RawXUser[]; errors: XAPIError[] }> {
  // Preferred broad field set (some may not be available on all tiers)
  const broadFields = [
    "created_at",
    "description",
    "entities",
    "location",
    "pinned_tweet_id",
    "profile_image_url",
    "public_metrics",
    "url",
    "verified",
    "verified_type",
    // These may or may not be supported depending on API tier
    "profile_banner_url",
    "affiliation",
  ];

  // Safe subset expected to work broadly
  const safeFields = [
    "description",
    "entities",
    "public_metrics",
    "profile_image_url",
    "url",
    "verified",
    "verified_type",
  ];

  try {
    const resp = await fetchUsersBatch(usernames, token, broadFields);
    return { users: resp.data ?? [], errors: resp.errors ?? [] };
  } catch (e) {
    if (e instanceof RateLimitError) {
      throw e;
    }
    stderr(`Warning: broad user.fields failed; retrying with a safe subset. (${(e as Error).message})`);
    const resp = await fetchUsersBatch(usernames, token, safeFields);
    return { users: resp.data ?? [], errors: resp.errors ?? [] };
  }
}

async function writeUserJson(user: RawXUser) {
  const base = sanitizeFilename(user.username);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const file = path.join(OUTPUT_DIR, `${base}.json`);
  const out = {
    id: user.id,
    name: user.name,
    username: user.username,
    affiliation: user.affiliation ?? null,
    description: user.description ?? null,
    entities: user.entities ?? null,
    profile_banner_url: (user as any).profile_banner_url ?? null,
    profile_image_url: user.profile_image_url ?? null,
    public_metrics: user.public_metrics ?? null,
    subscription_type: deriveSubscriptionType(user.verified, (user as any).verified_type),
    url: user.url ?? null,
    verified: user.verified ?? null,
  };
  await Bun.write(file, JSON.stringify(out, null, 2));
}

async function main() {
  const { csv } = parseArgs(process.argv);
  const csvPath = csv ?? DEFAULT_CSV;
  ensureCsvExtension(csvPath);

  const token = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;
  if (!token) {
    stderr("Error: Missing API token. Please create .env with X_BEARER_TOKEN=... and try again.");
    process.exit(1);
  }

  let csvText = "";
  try {
    csvText = await Bun.file(csvPath).text();
  } catch (e) {
    stderr(`Error: Could not read CSV file: ${csvPath} (${(e as Error).message})`);
    process.exit(1);
  }

  const usernames = extractUsernames(csvText);
  if (usernames.length === 0) {
    stderr("Error: No usernames found in CSV.");
    process.exit(1);
  }

  // Enforce X API upper limit for /users/by (multi-username) endpoint
  if (usernames.length > 100) {
    stderr(`Error: The X API endpoint /2/users/by supports at most 100 usernames per request. Found ${usernames.length}. Please split your CSV into chunks of 100 or fewer usernames and try again.`);
    process.exit(1);
  }

  stderr(`Fetching ${usernames.length} user(s) from X API...`);

  try {
    // Single call (<=100 usernames by guard above)
    const { users, errors } = await fetchUsersWithMeta(usernames, token);
    let count = 0;
    for (const u of users) {
      await writeUserJson(u);
      count++;
    }

    const requestedLower = new Set(usernames.map(u => u.toLowerCase()));
    const returnedLower = new Set(users.map(u => u.username.toLowerCase()));
    const errMap = new Map<string, XAPIError>();
    for (const e of (errors || [])) {
      if (e && typeof e.value === "string") errMap.set(e.value.toLowerCase(), e);
    }
    const missing = Array.from(requestedLower).filter(u => !returnedLower.has(u));
    const missingDetailed = missing.map(u => {
      const e = errMap.get(u);
      return { username: u, status: e?.status ?? null, error: e?.detail ?? null };
    });

    if (missingDetailed.length > 0) {
      stderr(`Note: Received ${count}/${usernames.length}. Missing: ${missingDetailed.length}.`);
    }

    console.log(JSON.stringify({ requested: usernames.length, written: count, missing: missingDetailed }, null, 2));
  } catch (e) {
    if (e instanceof RateLimitError) {
      const parts: string[] = ["Error: X API rate limit exceeded."];
      if (typeof e.retryAfterSec === "number" && !Number.isNaN(e.retryAfterSec)) {
        parts.push(`Retry-After: ~${e.retryAfterSec}s.`);
      }
      if (typeof e.resetAtEpochSec === "number" && !Number.isNaN(e.resetAtEpochSec)) {
        const resetDate = new Date(e.resetAtEpochSec * 1000);
        parts.push(`Resets at: ${resetDate.toISOString()}.`);
      }
      stderr(parts.join(" "));
      process.exit(1);
    }
    stderr(`Error: ${(e as Error).message}`);
    process.exit(1);
  }
}

await main();

