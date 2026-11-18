// macOS native text-to-speech fallback for Cartesia only. Uses /usr/bin/say → AIFF → PCM.
// Same Voice surface as VoiceStudio's StudioVoice so speaker can play it through the overlay.
// On non-Mac platforms SayVoice fails with reason 'platform' (reply stays text).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const SAY_RATE = 22050;

const plain = (text) => String(text ?? '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

/** Available only on darwin with /usr/bin/say. */
export async function sayStatus({ platform = process.platform } = {}) {
  if (platform !== 'darwin') return { ok: false, reason: 'platform', message: 'macOS say is only on Mac.' };
  if (!fs.existsSync('/usr/bin/say')) return { ok: false, reason: 'offline', message: '/usr/bin/say is missing.' };
  return { ok: true, reason: null, message: null, engine: 'say' };
}

/**
 * Speak via macOS `say`, emit 16-bit LE PCM at SAY_RATE.
 * Sentences queue; each is a separate say invocation so abort can kill the current one.
 */
export class SayVoice {
  constructor({ voice = null, onAudio, onEnd, onError, platform = process.platform, runSay = runSayDefault } = {}) {
    Object.assign(this, { voice, onAudio, onEnd, onError, platform, runSay });
    this.queue = [];
    this.state = 'open';
    this.heard = false;
    this.busy = false;
    this.child = null;
  }

  open() { return this; }

  say(text) {
    const t = plain(text);
    if (this.state === 'done' || !t) return;
    this.queue.push(t);
    this.pump();
  }

  end() {
    if (this.state === 'done') return;
    this.state = 'ending';
    this.pump();
  }

  abort() {
    this.state = 'done';
    this.queue.length = 0;
    try { this.child?.kill('SIGKILL'); } catch { /* ignore */ }
    this.child = null;
  }

  async pump() {
    if (this.busy || this.state === 'done') return;
    if (!this.queue.length) {
      if (this.state === 'ending') { this.state = 'done'; this.onEnd?.(); }
      return;
    }
    if (this.platform !== 'darwin') {
      const err = new Error('macOS say is only on Mac');
      err.heard = this.heard;
      err.reason = 'platform';
      this.state = 'done';
      return this.onError?.(err);
    }
    this.busy = true;
    const text = this.queue.shift();
    try {
      const pcm = await this.runSay(text, { voice: this.voice });
      if (this.state === 'done') return;
      if (pcm?.length) {
        this.heard = true;
        this.onAudio?.(pcm, SAY_RATE);
      }
    } catch (e) {
      if (this.state === 'done') return;
      const err = e instanceof Error ? e : new Error(String(e));
      err.heard = this.heard;
      err.reason = err.reason || 'error';
      this.state = 'done';
      this.busy = false;
      return this.onError?.(err);
    }
    this.busy = false;
    this.pump();
  }
}

/** say → AIFF → raw s16le PCM via afconvert (ships with macOS). */
export function runSayDefault(text, { voice = null, sayBin = '/usr/bin/say', afconvert = '/usr/bin/afconvert' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-say-'));
  const aiff = path.join(dir, `${randomUUID()}.aiff`);
  const caf = path.join(dir, `${randomUUID()}.caf`);
  const raw = path.join(dir, `${randomUUID()}.raw`);
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } };

  return new Promise((resolve, reject) => {
    const args = ['-o', aiff];
    if (voice) args.push('-v', voice);
    args.push(text);
    const child = spawn(sayBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { cleanup(); reject(e); });
    child.on('close', (code) => {
      if (code !== 0) { cleanup(); return reject(Object.assign(new Error(err.trim() || `say exited ${code}`), { reason: 'error' })); }
      const conv = spawn(afconvert, ['-f', 'WAVE', '-d', `LEI16@${SAY_RATE}`, aiff, caf], { stdio: ['ignore', 'ignore', 'pipe'] });
      let cerr = '';
      conv.stderr.on('data', (d) => { cerr += d; });
      conv.on('error', (e) => { cleanup(); reject(e); });
      conv.on('close', (c2) => {
        // Prefer reading WAVE from caf path; if afconvert wrote WAVE, strip 44-byte header when RIFF.
        if (c2 !== 0) {
          // Fallback: try afconvert to raw LEI16
          const rawConv = spawn(afconvert, ['-f', 'caff', '-d', `LEI16@${SAY_RATE}`, aiff, raw], { stdio: 'ignore' });
          rawConv.on('close', () => {
            try {
              // Last resort: read aiff and hope overlay can use it — better to fail cleanly.
              cleanup();
              reject(Object.assign(new Error(cerr.trim() || 'afconvert failed'), { reason: 'error' }));
            } catch (e) { cleanup(); reject(e); }
          });
          return;
        }
        try {
          const buf = fs.readFileSync(caf);
          let pcm = buf;
          if (buf.length > 44 && buf.toString('ascii', 0, 4) === 'RIFF') pcm = buf.subarray(44);
          cleanup();
          resolve(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
        } catch (e) { cleanup(); reject(e); }
      });
    });
  });
}
