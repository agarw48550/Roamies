#!/usr/bin/env node
// Lightweight Localbird-compatible HTTP helper for Roamies screen memory (opt-in).
// Endpoints: GET /status, POST /configure, POST /capture/start|stop, GET /search?q=
// Stores lightweight metadata frames locally; full Swift/C# capture from third_party/localbird
// can replace this process via ROAMIES_SCREENMEM on Mac/Windows.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createLocalFrameStore, DEFAULT_RETENTION } from './screenmem.mjs';

const port = Number(process.env.ROAMIES_SCREENMEM_PORT || 9111);
const dataDir = process.env.ROAMIES_SCREENMEM_DATA
  || path.join(os.homedir(), '.gg', 'sidekick', 'screenmem');
const store = createLocalFrameStore(dataDir);

let capturing = false;
let intervalMs = 15_000;
let timer = null;
let paused = false;
let lastApp = '';

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}

async function frontMeta() {
  // Best-effort: Mac osascript; Linux xdotool; else unknown.
  try {
    if (process.platform === 'darwin') {
      const out = await run('osascript', ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true']);
      return { app: out.trim(), title: '' };
    }
    if (process.platform === 'linux') {
      const id = (await run('xdotool', ['getactivewindow'])).trim();
      const name = (await run('xdotool', ['getwindowname', id])).trim();
      return { app: 'window', title: name };
    }
  } catch { /* ignore */ }
  return { app: 'unknown', title: '' };
}

async function captureOnce() {
  if (paused) return;
  const front = await frontMeta();
  const trigger = front.app !== lastApp ? 'app-change' : 'timer';
  lastApp = front.app;
  store.append({
    summary: `${front.app}${front.title ? `: ${front.title}` : ''}`,
    app: front.app,
    text: front.title || '',
    trigger,
    at: Date.now(),
  });
  store.purge(DEFAULT_RETENTION.maxFrames);
}

function arm() {
  clearInterval(timer);
  timer = null;
  if (!capturing || paused) return;
  timer = setInterval(() => { captureOnce().catch(() => {}); }, intervalMs);
  timer.unref?.();
  captureOnce().catch(() => {});
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  try {
    if (req.method === 'GET' && u.pathname === '/status') {
      return json(res, 200, { ok: true, capturing, paused, frames: store.count(), intervalMs, dataDir });
    }
    if (req.method === 'POST' && u.pathname === '/configure') {
      const body = await readBody(req);
      if (body.intervalMs) intervalMs = Math.max(5_000, Math.min(120_000, Number(body.intervalMs) || intervalMs));
      if (body.paused != null) paused = !!body.paused;
      arm();
      return json(res, 200, { ok: true, intervalMs, paused, capturing });
    }
    if (req.method === 'POST' && u.pathname === '/capture/start') {
      capturing = true; paused = false; arm();
      return json(res, 200, { ok: true, capturing: true });
    }
    if (req.method === 'POST' && u.pathname === '/capture/stop') {
      capturing = false; clearInterval(timer); timer = null;
      return json(res, 200, { ok: true, capturing: false });
    }
    if (req.method === 'GET' && u.pathname === '/search') {
      const q = u.searchParams.get('q') || '';
      const limit = Number(u.searchParams.get('limit') || 8);
      return json(res, 200, { results: store.search(q, limit) });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(port, '127.0.0.1', () => {
  fs.mkdirSync(dataDir, { recursive: true });
  console.error(`[screenmem-helper] listening on 127.0.0.1:${port} data=${dataDir}`);
});

function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (d) => { buf += d; });
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); }
    });
  });
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${code}`))));
  });
}
