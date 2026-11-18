// Opt-in low-memory / CPU guard for 8GB Macs. Samples lightly, never rewrites the agent loop.
// When other apps are heavy, notifies and can suggest quitting Roamies; a small watcher script
// can later say when it's safe to reopen. Defaults off — enable via config.lowMemoryMode.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const DEFAULT_THRESHOLDS = {
  // Free+inactive (approx) below this fraction of total → pressure
  freeRatio: 0.12,
  // Roamies process RSS above this many MB → self pressure
  selfRssMb: 900,
  // Another process above this % CPU is "heavy"
  otherCpuPct: 80,
  // Sample interval
  everyMs: 8_000,
};

const WATCH_PLIST = 'com.roamies.resource-watch';

/** Best-effort system sample. Never throws. */
export async function sampleResources({ platform = process.platform, exec = runCmd, selfPid = process.pid } = {}) {
  const total = os.totalmem();
  const free = os.freemem();
  const load = os.loadavg?.() ?? [0, 0, 0];
  let selfRssMb = Math.round((process.memoryUsage().rss || 0) / (1024 * 1024));
  let heavies = [];
  try {
    if (platform === 'darwin' || platform === 'linux') {
      const out = await exec('ps', ['-axo', 'pid,pcpu,rss,comm']);
      const rows = String(out).trim().split('\n').slice(1);
      for (const line of rows) {
        const m = line.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
        if (!m) continue;
        const pid = Number(m[1]), cpu = Number(m[2]), rssKb = Number(m[3]), comm = m[4].trim();
        if (pid === selfPid) selfRssMb = Math.max(selfRssMb, Math.round(rssKb / 1024));
        if (pid !== selfPid && cpu >= 40) heavies.push({ pid, cpu, rssMb: Math.round(rssKb / 1024), name: path.basename(comm) });
      }
      heavies.sort((a, b) => b.cpu - a.cpu);
      heavies = heavies.slice(0, 5);
    }
  } catch { /* ignore */ }
  return {
    totalMb: Math.round(total / (1024 * 1024)),
    freeMb: Math.round(free / (1024 * 1024)),
    freeRatio: total ? free / total : 1,
    load1: load[0] ?? 0,
    selfRssMb,
    heavies,
    at: Date.now(),
  };
}

/** Decide whether to warn / throttle. Pure. */
export function assess(sample, thresholds = DEFAULT_THRESHOLDS) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const lowMem = sample.freeRatio < t.freeRatio;
  const selfHot = sample.selfRssMb >= t.selfRssMb;
  const other = (sample.heavies || []).find((h) => h.cpu >= t.otherCpuPct);
  const pressure = lowMem || selfHot || !!other;
  let message = null;
  if (other && (lowMem || selfHot)) {
    message = `${other.name} is using a lot of CPU (${Math.round(other.cpu)}%). Quit Roamies to free memory?`;
  } else if (other) {
    message = `${other.name} is using a lot of CPU (${Math.round(other.cpu)}%). Other apps may make Roamies sluggish.`;
  } else if (lowMem) {
    message = 'Memory is tight on this Mac. Quit Roamies for a bit, or close heavy apps?';
  } else if (selfHot) {
    message = 'Roamies is using a lot of memory. Pause screen memory or quit to cool down?';
  }
  return { pressure, lowMem, selfHot, other: other || null, message, throttleScreenMem: pressure, pauseAutoListen: lowMem || selfHot };
}

/**
 * Polling guard. onWarn(assessment, sample) at most once per cooldownMs while pressure lasts.
 * onThrottle(assessment) whenever throttle flags change.
 */
export function createResourceGuard({
  enabled = false,
  thresholds = DEFAULT_THRESHOLDS,
  sample = sampleResources,
  onWarn = () => {},
  onThrottle = () => {},
  everyMs = DEFAULT_THRESHOLDS.everyMs,
  cooldownMs = 5 * 60_000,
  now = () => Date.now(),
  setTimer = (f, ms) => setTimeout(f, ms),
  clearTimer = (h) => clearTimeout(h),
} = {}) {
  let on = !!enabled, timer = null, lastWarn = 0, lastFlags = '';
  const tick = async () => {
    timer = null;
    if (!on) return;
    try {
      const s = await sample();
      const a = assess(s, thresholds);
      const flags = `${a.throttleScreenMem}|${a.pauseAutoListen}|${a.other?.name || ''}`;
      if (flags !== lastFlags) { lastFlags = flags; onThrottle(a, s); }
      if (a.pressure && a.message && now() - lastWarn >= cooldownMs) {
        lastWarn = now();
        onWarn(a, s);
      }
    } catch { /* never take down the agent */ }
    if (on) {
      timer = setTimer(tick, thresholds.everyMs ?? everyMs);
      timer?.unref?.();
    }
  };
  return {
    start() { if (on && !timer) tick(); },
    stop() { on = false; if (timer) clearTimer(timer); timer = null; },
    setEnabled(v) {
      on = !!v;
      if (on) this.start();
      else this.stop();
    },
    get enabled() { return on; },
    async checkOnce() { const s = await sample(); return { sample: s, assess: assess(s, thresholds) }; },
  };
}

/** Paths for the safe-to-relaunch watcher (LaunchAgent on Mac). */
export function watchPaths(dataDir) {
  const dir = path.join(dataDir, 'resource-watch');
  return {
    dir,
    state: path.join(dir, 'state.json'),
    script: path.join(dir, 'watch.sh'),
    plist: path.join(os.homedir(), 'Library', 'LaunchAgents', `${WATCH_PLIST}.plist`),
  };
}

/**
 * Write a tiny shell watcher that polls free memory and posts a notification when pressure clears.
 * Mac only. Does not load the LaunchAgent itself unless install=true.
 */
export function installRelaunchWatcher(dataDir, {
  platform = process.platform,
  freeRatio = DEFAULT_THRESHOLDS.freeRatio,
  notifyTitle = 'Roamies',
  notifyBody = 'Memory looks fine again — safe to open Roamies.',
  install = true,
} = {}) {
  if (platform !== 'darwin') return { ok: false, reason: 'platform' };
  const p = watchPaths(dataDir);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.state, JSON.stringify({ waiting: true, freeRatio, at: Date.now() }));
  const script = `#!/bin/bash
# Roamies resource watcher — exits after notifying that memory is OK again.
STATE="${p.state}"
RATIO="${freeRatio}"
while true; do
  free=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
  # pages free+inactive from vm_stat (approximate)
  eval $(vm_stat 2>/dev/null | awk '/Pages free/ {f=$3} /Pages inactive/ {i=$3} END {gsub(/\\./,"",f); gsub(/\\./,"",i); print "FREE_PAGES="f+0"; INACT="i+0}')
  page=4096
  total=$free
  avail=$(( (FREE_PAGES + INACT) * page ))
  if [ "$total" -gt 0 ]; then
    # awk ratio
    ok=$(awk -v a="$avail" -v t="$total" -v r="$RATIO" 'BEGIN { print (a/t >= r) ? 1 : 0 }')
    if [ "$ok" = "1" ]; then
      osascript -e 'display notification "${notifyBody.replace(/'/g, "'\\''")}" with title "${notifyTitle.replace(/'/g, "'\\''")}"' 2>/dev/null || true
      rm -f "$STATE"
      launchctl bootout "gui/$(id -u)/${WATCH_PLIST}" 2>/dev/null || true
      exit 0
    fi
  fi
  sleep 30
done
`;
  fs.writeFileSync(p.script, script, { mode: 0o755 });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${WATCH_PLIST}</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>${p.script}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict></plist>`;
  if (install) {
    fs.mkdirSync(path.dirname(p.plist), { recursive: true });
    fs.writeFileSync(p.plist, plist);
    try {
      spawn('launchctl', ['bootout', `gui/${process.getuid?.() || 501}/${WATCH_PLIST}`], { stdio: 'ignore' });
    } catch { /* ignore */ }
    try {
      spawn('launchctl', ['bootstrap', `gui/${process.getuid?.() || 501}`, p.plist], { stdio: 'ignore' });
    } catch { /* ignore */ }
  }
  return { ok: true, ...p };
}

export function uninstallRelaunchWatcher(dataDir, { platform = process.platform } = {}) {
  if (platform !== 'darwin') return;
  const p = watchPaths(dataDir);
  try { spawn('launchctl', ['bootout', `gui/${process.getuid?.() || 501}/${WATCH_PLIST}`], { stdio: 'ignore' }); } catch { /* ignore */ }
  try { fs.unlinkSync(p.plist); } catch { /* ignore */ }
  try { fs.rmSync(p.dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}`))));
  });
}
