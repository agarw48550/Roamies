// Spoken replies through Cartesia TTS (WebSocket). Same Voice contract as FishVoice / GeminiVoice so
// speaker.mjs can plug it in without changing Fish or Gemini. On quota/key failure the sidecar may fall
// back to macOS say (macos-say.mjs) — never to Fish or Gemini.
import { randomUUID } from 'node:crypto';

export const CARTESIA_API = 'https://api.cartesia.ai';
export const CARTESIA_WS = 'wss://api.cartesia.ai/tts/websocket';
export const CARTESIA_VERSION = '2024-11-13';
export const CARTESIA_MODELS = ['sonic-3', 'sonic-turbo'];
export const CARTESIA_MODEL = 'sonic-3';
export const CARTESIA_RATE = 24000;
// A public Cartesia library voice; the panel can override via config.cartesiaVoice.
export const DEFAULT_VOICE = 'a0e99841-4387-4b05-98a3-2b87562cdc86';
export const CARTESIA_CHOICES = [
  { id: 'sonic-3', name: 'Sonic 3', perChar: 1 },
  { id: 'sonic-turbo', name: 'Sonic Turbo', perChar: 1 },
];

/** Strip Fish-style [cues] so Cartesia does not read them aloud. */
export const plain = (text) => String(text ?? '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Is the key good? Never throws. Same shape as fishAccount; credit is null when unknown.
 * quota_exceeded → { ok: false, reason: 'quota' }.
 */
export async function cartesiaAccount(key, { fetchImpl = fetch, timeout = 6000 } = {}) {
  if (!key) return { ok: false, reason: 'key' };
  try {
    const r = await fetchImpl(`${CARTESIA_API}/voices?limit=1`, {
      headers: { 'X-API-Key': key, 'Cartesia-Version': CARTESIA_VERSION },
      signal: AbortSignal.timeout(timeout),
    });
    if (r.status === 401 || r.status === 403) return { ok: false, reason: 'key' };
    if (r.status === 429) {
      const body = await r.text().catch(() => '');
      if (/quota/i.test(body)) return { ok: false, reason: 'quota', credit: 0 };
      return { ok: false, reason: 'network' };
    }
    if (!r.ok) return { ok: false, reason: 'network' };
    return { ok: true, credit: null };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

/**
 * One reply's voice over Cartesia's TTS WebSocket.
 * onError may set err.reason = 'quota' | 'key' | 'network' for the say fallback.
 */
export class CartesiaVoice {
  constructor({
    key, voice = DEFAULT_VOICE, model = CARTESIA_MODEL, rate = CARTESIA_RATE,
    WebSocketImpl = globalThis.WebSocket, onAudio, onEnd, onError,
    openTimeout = 6000, audioTimeout = 12_000,
  }) {
    Object.assign(this, { key, voice, model, rate, WebSocketImpl, onAudio, onEnd, onError, openTimeout, audioTimeout });
    this.contextId = randomUUID();
    this.queue = [];
    this.state = 'new';
    this.heard = false;
    this.said = 0;
    this.timer = null;
  }

  open() {
    if (this.state !== 'new') return this;
    this.state = 'opening';
    const url = `${CARTESIA_WS}?api_key=${encodeURIComponent(this.key)}&cartesia_version=${CARTESIA_VERSION}`;
    let ws;
    try { ws = new this.WebSocketImpl(url); }
    catch (e) { return this.fail(e, 'network'), this; }
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    this.arm(this.openTimeout, 'Cartesia took too long to connect', 'network');
    ws.onopen = () => {
      if (this.state === 'done') return;
      this.state = this.state === 'ending' ? 'ending' : 'open';
      this.clear();
      for (const m of this.queue.splice(0)) ws.send(m);
      if (this.said) this.arm(this.audioTimeout, 'Cartesia stopped sending audio', 'network');
    };
    ws.onmessage = (e) => {
      if (this.state === 'done') return;
      let m;
      try {
        if (typeof e.data === 'string') m = JSON.parse(e.data);
        else {
          const t = Buffer.from(e.data).toString('utf8');
          m = JSON.parse(t);
        }
      } catch { return; }
      if (m.type === 'chunk' && m.data) {
        this.heard = true;
        if (this.state === 'ending') this.arm(this.audioTimeout, 'Cartesia stopped sending audio', 'network');
        else this.clear();
        const pcm = Buffer.from(m.data, 'base64');
        this.onAudio?.(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
      } else if (m.type === 'done') {
        this.finish();
      } else if (m.type === 'error') {
        const code = String(m.error_code ?? m.code ?? m.message ?? '');
        const reason = /quota/i.test(code) ? 'quota' : /auth|key|401|403/i.test(code) ? 'key' : 'network';
        this.fail(new Error(`Cartesia: ${m.message ?? (code || 'error')}`), reason);
      }
    };
    ws.onerror = () => this.fail(new Error(this.heard ? 'Cartesia connection dropped' : 'Could not reach Cartesia'), 'network');
    ws.onclose = () => { if (this.state !== 'done') this.fail(new Error('Cartesia closed the connection'), 'network'); };
    return this;
  }

  send(obj) {
    const m = JSON.stringify(obj);
    if (this.state === 'open' || (this.state === 'ending' && this.ws?.readyState === 1)) this.ws.send(m);
    else this.queue.push(m);
  }

  say(text) {
    const t = plain(text);
    if (this.state === 'done' || this.state === 'ending' || !t) return;
    if (this.state === 'new') this.open();
    this.said++;
    this.send({
      model_id: this.model,
      transcript: t,
      voice: { mode: 'id', id: this.voice },
      language: 'en',
      context_id: this.contextId,
      output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: this.rate },
      continue: true,
    });
    if (this.state !== 'opening' && !this.timer) this.arm(this.audioTimeout, 'Cartesia stopped sending audio', 'network');
  }

  end() {
    if (this.state === 'done' || this.state === 'ending') return;
    if (!this.said) return this.close(), this.onEnd?.();
    this.send({
      model_id: this.model,
      transcript: '',
      voice: { mode: 'id', id: this.voice },
      context_id: this.contextId,
      output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: this.rate },
      continue: false,
    });
    this.state = 'ending';
    if (!this.timer) this.arm(this.audioTimeout, 'Cartesia stopped sending audio', 'network');
  }

  abort() { this.close(); }

  rebind(cbs) { Object.assign(this, cbs); return true; }

  arm(ms, message, reason = 'network') {
    this.clear();
    this.timer = setTimeout(() => this.fail(new Error(message), reason), ms);
    this.timer.unref?.();
  }
  clear() { clearTimeout(this.timer); this.timer = null; }

  fail(err, reason = 'network') {
    if (this.state === 'done') return;
    this.close();
    const e = err instanceof Error ? err : new Error(String(err));
    e.heard = this.heard;
    e.reason = reason;
    this.onError?.(e);
  }

  finish() {
    if (this.state === 'done') return;
    this.close();
    this.onEnd?.();
  }

  close() {
    this.clear();
    this.state = 'done';
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
  }
}
