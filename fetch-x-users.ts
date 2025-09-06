// fetch-x-users.ts
// Bun-runnable script to read usernames OR numeric IDs from a CSV and fetch full
// user datasets from the X API v2, writing each profile to its own
// fetched/<dd-mm-yyyy>-<timestamp>/<username-or-id>.json file.
//
// Usage:
//   bun run fetch-x-users.ts            # reads usernames.csv in the current folder
//   bun run fetch-x-users.ts --csv myfile.csv
//
// Requirements:
//   - Place your API token in .env as X_BEARER_TOKEN=... (Bun loads .env automatically)
//   - The CSV should contain a column named "username"/"handle"/"user" (preferred),
//     OR a column named "id"/"user_id"/"userid". If no header is present, the first
//     column is used. The script verifies that all entries are either usernames OR
//     numeric IDs (no mixing) and calls the appropriate endpoint.
//
// Notes:
//   - The script validates that the provided file has a .csv extension.
//   - It will request a broad set of user.fields and automatically fall back to a
//     safe subset if the API rejects unknown fields.
//   - API limit: up to 100 items per request for both usernames and IDs.
//   - Each run is saved to a timestamped folder under fetched/ for later diffing.
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_CSV = "usernames.csv";
const OUTPUT_ROOT = "fetched";

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

  created_at?: string; // ISO 8601
  location?: string;
  pinned_tweet_id?: string;
  verified?: boolean;
  verified_type?: string;

  description?: string;
  entities?: XUserEntities;
  profile_image_url?: string;
  public_metrics?: XPublicMetrics;
  url?: string;
  affiliation?: unknown;
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

type ExtractResult = { mode: "usernames" | "ids"; values: string[] };

function extractValues(csvText: string): ExtractResult {
  const rows = parseCSV(csvText)
    .map(r => r.map(c => c.trim()))
    .filter(r => r.length > 0 && r.some(c => c.length > 0));

  if (rows.length === 0) return { mode: "usernames", values: [] };

  // Detect header
  const header = rows[0].map(h => h.toLowerCase());
  const possibleUserCols = ["username", "handle", "user"];
  const possibleIdCols = ["id", "user_id", "userid"];
  let colIndex = 0;
  let startRow = 0;

  let headerMode: "usernames" | "ids" | null = null;
  let found = header.findIndex(h => possibleUserCols.includes(h));
  if (found >= 0) { colIndex = found; startRow = 1; headerMode = "usernames"; }
  if (found < 0) {
    const foundId = header.findIndex(h => possibleIdCols.includes(h));
    if (foundId >= 0) { colIndex = foundId; startRow = 1; headerMode = "ids"; }
  }
  if (headerMode == null) { colIndex = 0; startRow = 0; }

  const set = new Set<string>();
  for (let i = startRow; i < rows.length; i++) {
    const v = rows[i][colIndex];
    if (!v) continue;
    set.add(v);
  }
  const raw = Array.from(set);
  const normalized = raw.map(v => headerMode === "ids" ? v.trim() : normalizeUsername(v));

  const onlyDigits = (s: string) => /^\d+$/.test(s);
  const idCount = normalized.filter(onlyDigits).length;
  const total = normalized.length;

  let mode: "usernames" | "ids";
  if (headerMode === "usernames") mode = "usernames";
  else if (headerMode === "ids") mode = "ids";
  else {
    if (idCount === total) mode = "ids";
    else if (idCount === 0) mode = "usernames";
    else {
      stderr("Error: Detected a mixture of numeric IDs and usernames in the CSV. Please provide a uniform list.");
      process.exit(1);
    }
  }

  const values = mode === "usernames"
    ? normalized.map(normalizeUsername)
    : normalized.map(v => {
        const s = v.trim();
        if (!/^\d+$/.test(s)) {
          stderr(`Error: Non-numeric entry found in ID mode: ${v}`);
          process.exit(1);
        }
        return s;
      });

  return { mode, values };
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

async function fetchUsersByIdsBatch(ids: string[], token: string, userFields: string[]): Promise<XUsersByResponse> {
  const endpoint = "https://api.x.com/2/users";
  const params = new URLSearchParams({ ids: ids.join(","), "user.fields": userFields.join(",") });
  const res = await fetch(`${endpoint}?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
  let json: XUsersByResponse | null = null; const text = await res.text();
  try { json = text ? (JSON.parse(text) as XUsersByResponse) : {}; } catch { json = {}; }
  if (!res.ok) {
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
    "created_at",
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

async function fetchUsersByIdsWithMeta(ids: string[], token: string): Promise<{ users: RawXUser[]; errors: XAPIError[] }> {
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
    "profile_banner_url",
    "affiliation",
  ];
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
    const resp = await fetchUsersByIdsBatch(ids, token, broadFields);
    return { users: resp.data ?? [], errors: resp.errors ?? [] };
  } catch (e) {
    if (e instanceof RateLimitError) throw e;
    stderr(`Warning: broad user.fields failed; retrying with a safe subset. (${(e as Error).message})`);
    const resp = await fetchUsersByIdsBatch(ids, token, safeFields);
    return { users: resp.data ?? [], errors: resp.errors ?? [] };
  }
}

async function writeUserJson(user: RawXUser, outDir: string) {
  const base = sanitizeFilename(user.username || `id_${user.id}`);
  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${base}.json`);
  const out = {
    id: user.id,
    name: user.name,
    username: user.username,
    created_at: user.created_at ?? null,
    location: user.location ?? null,
    pinned_tweet_id: user.pinned_tweet_id ?? null,    
    verified_type: user.verified_type ?? null,
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
  await fs.writeFile(file, JSON.stringify(out, null, 2), "utf8");
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
    csvText = await fs.readFile(csvPath, "utf8");
  } catch (e) {
    stderr(`Error: Could not read CSV file: ${csvPath} (${(e as Error).message})`);
    process.exit(1);
  }

  const extracted = extractValues(csvText);
  const values = extracted?.values || [];
  if (values.length === 0) {
    stderr("Error: No usernames found in CSV.");
    process.exit(1);
  }

  // Prepare timestamped output directory
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  const ts = now.getTime();
  const runDir = path.join(OUTPUT_ROOT, `${dd}-${mm}-${yyyy}-${ts}`);

  const groups = chunk(values, 100);
  stderr(`Fetching ${values.length} user(s) from X API in ${extracted.mode} mode in ${groups.length} batch(es)...`);

  try {
    let written = 0;
    const allErrors: XAPIError[] = [];
    const requestedLower = new Set(values.map(u => u.toLowerCase()));
    const returnedLower = new Set<string>();

    for (let i = 0; i < groups.length; i++) {
      const batch = groups[i];
      stderr(`Batch ${i + 1}/${groups.length}: fetching ${batch.length}...`);
      const { users, errors } = extracted.mode === 'ids'
        ? await fetchUsersByIdsWithMeta(batch, token)
        : await fetchUsersWithMeta(batch, token);
      for (const u of (users || [])) {
        await writeUserJson(u, runDir);
        written++;
        returnedLower.add((extracted.mode === 'ids' ? u.id : u.username).toLowerCase());
      }
      for (const e of (errors || [])) allErrors.push(e);
    }

    const errMap = new Map<string, XAPIError>();
    for (const e of allErrors) {
      if (e && typeof e.value === 'string') errMap.set(e.value.toLowerCase(), e);
    }
    const missing = Array.from(requestedLower).filter(u => !returnedLower.has(u));
    const missingDetailed = missing.map(u => {
      const e = errMap.get(u);
      return { value: u, status: e?.status ?? null, error: e?.detail ?? null };
    });

    if (missingDetailed.length > 0) {
      stderr(`Note: Received ${written}/${values.length}. Missing: ${missingDetailed.length}.`);
    }

    console.log(JSON.stringify({ requested: values.length, written, mode: extracted.mode, batches: groups.length, outDir: runDir, missing: missingDetailed }, null, 2));
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

