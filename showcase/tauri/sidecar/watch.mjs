// Lightweight “tell me when X” pollers (Atticus-inspired). No AI while waiting.
// Opt-in via tools; fires once then removes itself. Uses notify() when done.
import fs from 'node:fs';
import path from 'node:path';

export function watchesPath(dataDir) {
  return path.join(dataDir, 'watches.json');
}

export function loadWatches(dataDir) {
  try {
    const j = JSON.parse(fs.readFileSync(watchesPath(dataDir), 'utf8'));
    return Array.isArray(j?.items) ? j.items : [];
  } catch {
    return [];
  }
}

export function saveWatches(dataDir, items) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(watchesPath(dataDir), JSON.stringify({ version: 1, items }, null, 2));
}

export function createWatch({ id, kind = 'file', target, match = '', message = '', everyMs = 5000 } = {}) {
  return {
    id: id || `w${Date.now().toString(36)}`,
    kind,
    target: String(target || ''),
    match: String(match || ''),
    message: String(message || 'Done.'),
    everyMs: Math.max(2000, Math.min(60_000, Number(everyMs) || 5000)),
    createdAt: Date.now(),
  };
}

/** Check one watch. Returns { fired, detail } without mutating. */
export function checkWatch(watch, { readFile = (p) => fs.readFileSync(p, 'utf8'), exists = fs.existsSync, now = Date.now() } = {}) {
  if (!watch?.target) return { fired: false };
  if (watch.kind === 'file') {
    if (!exists(watch.target)) return { fired: false };
    if (!watch.match) return { fired: true, detail: `File appeared: ${watch.target}` };
    try {
      const text = readFile(watch.target);
      if (String(text).includes(watch.match)) return { fired: true, detail: `Matched in ${watch.target}` };
    } catch { return { fired: false }; }
    return { fired: false };
  }
  if (watch.kind === 'until') {
    const when = Number(watch.target);
    if (Number.isFinite(when) && now >= when) return { fired: true, detail: 'Time reached' };
    return { fired: false };
  }
  return { fired: false };
}

/**
 * Polling runner. onFire(watch, detail) then removes the watch.
 */
export function createWatchRunner({
  dataDir,
  check = checkWatch,
  onFire = () => {},
  load = () => loadWatches(dataDir),
  save = (items) => saveWatches(dataDir, items),
  setTimer = (f, ms) => setTimeout(f, ms),
  clearTimer = (h) => clearTimeout(h),
  enabled = () => true,
} = {}) {
  let timer = null;
  const tick = () => {
    timer = null;
    if (!enabled()) {
      timer = setTimer(tick, 5000);
      timer?.unref?.();
      return;
    }
    let items = load();
    let minEvery = 5000;
    const keep = [];
    for (const w of items) {
      minEvery = Math.min(minEvery, w.everyMs || 5000);
      const r = check(w);
      if (r.fired) onFire(w, r.detail);
      else keep.push(w);
    }
    if (keep.length !== items.length) save(keep);
    timer = setTimer(tick, keep.length ? minEvery : 10_000);
    timer?.unref?.();
  };
  return {
    start() { if (!timer) tick(); },
    stop() { if (timer) clearTimer(timer); timer = null; },
    add(watch) {
      const items = load();
      items.push(watch);
      save(items);
      this.start();
      return watch;
    },
    list: () => load(),
  };
}
