// Optional continuous screen memory (Localbird-inspired). Off by default.
// Talks to a local helper over HTTP (ROAMIES_SCREENMEM_URL, default 127.0.0.1:9111).
// When the helper is missing, tools return a clear status — core Roamies still works.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const DEFAULT_SCREENMEM_URL = 'http://127.0.0.1:9111';
export const DEFAULT_RETENTION = { maxFrames: 400, maxMb: 400 };

export function screenmemUrl(env = process.env) {
  const raw = env.ROAMIES_SCREENMEM_URL;
  if (!raw) return DEFAULT_SCREENMEM_URL;
  try {
    const u = new URL(raw);
    if (['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return u.origin;
  } catch { /* ignore */ }
  return DEFAULT_SCREENMEM_URL;
}

export async function screenmemStatus({ fetchImpl = fetch, base = screenmemUrl(), timeout = 1500 } = {}) {
  try {
    const r = await fetchImpl(`${base}/status`, { signal: AbortSignal.timeout(timeout) });
    if (!r.ok) return { ok: false, reason: 'error', message: `HTTP ${r.status}` };
    const j = await r.json().catch(() => ({}));
    return { ok: true, capturing: !!j.capturing, frames: j.frames ?? null, ...j };
  } catch {
    return { ok: false, reason: 'offline', message: 'Screen memory helper is not running.' };
  }
}

export async function screenmemConfigure(opts = {}, { fetchImpl = fetch, base = screenmemUrl(), timeout = 3000 } = {}) {
  const r = await fetchImpl(`${base}/configure`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(opts),
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) throw new Error(`configure failed: HTTP ${r.status}`);
  return r.json().catch(() => ({}));
}

export async function screenmemStart({ fetchImpl = fetch, base = screenmemUrl(), timeout = 3000 } = {}) {
  const r = await fetchImpl(`${base}/capture/start`, { method: 'POST', signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`start failed: HTTP ${r.status}`);
  return r.json().catch(() => ({ ok: true }));
}

export async function screenmemStop({ fetchImpl = fetch, base = screenmemUrl(), timeout = 3000 } = {}) {
  const r = await fetchImpl(`${base}/capture/stop`, { method: 'POST', signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`stop failed: HTTP ${r.status}`);
  return r.json().catch(() => ({ ok: true }));
}

export async function searchScreenHistory(query, {
  fetchImpl = fetch, base = screenmemUrl(), timeout = 8000, limit = 8,
} = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const r = await fetchImpl(`${base}/search?q=${encodeURIComponent(q)}&limit=${limit}`, {
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) throw new Error(`search failed: HTTP ${r.status}`);
  const j = await r.json().catch(() => ({}));
  return Array.isArray(j.results) ? j.results : Array.isArray(j) ? j : [];
}

/**
 * Spawn the vendored Node screenmem helper if ROAMIES_SCREENMEM points at a script/binary.
 * Returns { child } or null.
 */
export function spawnScreenmemHelper(bin = process.env.ROAMIES_SCREENMEM, {
  spawnImpl = spawn,
  env = process.env,
  dataDir,
} = {}) {
  if (!bin || !fs.existsSync(bin)) return null;
  const child = spawnImpl(bin.endsWith('.mjs') || bin.endsWith('.js') ? process.execPath : bin,
    bin.endsWith('.mjs') || bin.endsWith('.js') ? [bin] : [],
    {
      stdio: 'ignore',
      detached: true,
      env: {
        ...env,
        ROAMIES_SCREENMEM_DATA: dataDir || path.join(env.HOME || '', '.gg', 'sidekick', 'screenmem'),
      },
    });
  child.unref?.();
  return { child };
}

/** Local JSONL store used when the full Localbird helper isn't up — still searchable by substring. */
export function createLocalFrameStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const index = path.join(dir, 'frames.jsonl');
  return {
    dir,
    append(frame) {
      fs.appendFileSync(index, JSON.stringify({ ...frame, at: frame.at || Date.now() }) + '\n');
    },
    search(query, limit = 8) {
      if (!fs.existsSync(index)) return [];
      const q = String(query || '').toLowerCase();
      const lines = fs.readFileSync(index, 'utf8').trim().split('\n').filter(Boolean);
      const hits = [];
      for (let i = lines.length - 1; i >= 0 && hits.length < limit; i--) {
        try {
          const row = JSON.parse(lines[i]);
          const blob = `${row.summary || ''} ${row.app || ''} ${row.text || ''}`.toLowerCase();
          if (!q || blob.includes(q)) hits.push(row);
        } catch { /* skip bad line */ }
      }
      return hits;
    },
    count() {
      if (!fs.existsSync(index)) return 0;
      return fs.readFileSync(index, 'utf8').trim().split('\n').filter(Boolean).length;
    },
    purge(maxFrames = DEFAULT_RETENTION.maxFrames) {
      if (!fs.existsSync(index)) return;
      const lines = fs.readFileSync(index, 'utf8').trim().split('\n').filter(Boolean);
      if (lines.length <= maxFrames) return;
      fs.writeFileSync(index, lines.slice(-maxFrames).join('\n') + '\n');
    },
  };
}
