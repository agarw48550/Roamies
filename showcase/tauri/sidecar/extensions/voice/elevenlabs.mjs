// ElevenLabs streaming TTS (WebSocket). Same Voice contract as CartesiaVoice / FishVoice.
export const ELEVEN_API = 'https://api.elevenlabs.io';
export const ELEVEN_WS = 'wss://api.elevenlabs.io/v1/text-to-speech';
export const ELEVEN_MODELS = ['eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_multilingual_v2'];
export const ELEVEN_MODEL = 'eleven_flash_v2_5';
export const ELEVEN_RATE = 24000;
// A public premade voice (Rachel); override via config.elevenlabsVoice.
export const ELEVEN_DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM';
export const ELEVEN_CHOICES = [
  { id: 'eleven_flash_v2_5', name: 'Flash v2.5' },
  { id: 'eleven_turbo_v2_5', name: 'Turbo v2.5' },
  { id: 'eleven_multilingual_v2', name: 'Multilingual v2' },
];

const plain = (text) => String(text ?? '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

export async function elevenAccount(key, { fetchImpl = fetch, timeout = 6000 } = {}) {
  if (!key) return { ok: false, reason: 'key' };
  try {
    const r = await fetchImpl(`${ELEVEN_API}/v1/user`, {
      headers: { 'xi-api-key': key },
      signal: AbortSignal.timeout(timeout),
    });
    if (r.status === 401 || r.status === 403) return { ok: false, reason: 'key' };
    if (r.status === 429) return { ok: false, reason: 'quota', credit: 0 };
    if (!r.ok) return { ok: false, reason: 'network' };
    return { ok: true, credit: null };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

export class ElevenLabsVoice {
  constructor({
    key, voice = ELEVEN_DEFAULT_VOICE, model = ELEVEN_MODEL, rate = ELEVEN_RATE,
    WebSocketImpl = globalThis.WebSocket, onAudio, onEnd, onError,
    openTimeout = 6000, audioTimeout = 12_000,
  }) {
    Object.assign(this, { key, voice, model, rate, WebSocketImpl, onAudio, onEnd, onError, openTimeout, audioTimeout });
    this.queue = [];
    this.state = 'new';
    this.heard = false;
    this.said = 0;
    this.timer = null;
    this.ws = null;
  }

  open() {
    if (this.state !== 'new') return this;
    this.state = 'opening';
    const url = `${ELEVEN_WS}/${encodeURIComponent(this.voice)}/stream-input?model_id=${encodeURIComponent(this.model)}&output_format=pcm_24000`;
    let ws;
    try {
      ws = new this.WebSocketImpl(url, { headers: { 'xi-api-key': this.key } });
    } catch {
      try { ws = new this.WebSocketImpl(url); } catch (e) { return this.fail(e, 'network'), this; }
    }
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    this.arm(this.openTimeout, 'ElevenLabs took too long to connect', 'network');
    ws.onopen = () => {
      if (this.state === 'done') return;
      this.state = this.state === 'ending' ? 'ending' : 'open';
      this.clear();
      this.send({
        text: ' ',
        voice_settings: { stability: 0.4, similarity_boost: 0.75 },
        xi_api_key: this.key,
      });
      for (const m of this.queue.splice(0)) ws.send(m);
      if (this.said) this.arm(this.audioTimeout, 'ElevenLabs stopped sending audio', 'network');
    };
    ws.onmessage = (e) => {
      if (this.state === 'done') return;
      let m;
      try {
        m = typeof e.data === 'string' ? JSON.parse(e.data) : JSON.parse(Buffer.from(e.data).toString('utf8'));
      } catch { return; }
      if (m.audio) {
        this.heard = true;
        this.clear();
        if (this.state === 'ending') this.arm(this.audioTimeout, 'ElevenLabs stopped sending audio', 'network');
        const pcm = Buffer.from(m.audio, 'base64');
        this.onAudio?.(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
      }
      if (m.isFinal || m.is_final) this.finish();
      if (m.error || m.message && /invalid|unauthorized|quota|credit/i.test(String(m.message))) {
        const msg = String(m.error || m.message || 'error');
        const reason = /quota|credit|limit/i.test(msg) ? 'quota' : /unauth|invalid|key|401|403/i.test(msg) ? 'key' : 'network';
        this.fail(new Error(`ElevenLabs: ${msg}`), reason);
      }
    };
    ws.onerror = () => this.fail(new Error(this.heard ? 'ElevenLabs connection dropped' : 'Could not reach ElevenLabs'), 'network');
    ws.onclose = () => { if (this.state !== 'done') this.fail(new Error('ElevenLabs closed the connection'), 'network'); };
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
    this.send({ text: `${t} ` });
    if (this.state !== 'opening' && !this.timer) this.arm(this.audioTimeout, 'ElevenLabs stopped sending audio', 'network');
  }

  end() {
    if (this.state === 'done' || this.state === 'ending') return;
    if (!this.said) return this.close(), this.onEnd?.();
    this.send({ text: '' });
    this.state = 'ending';
    if (!this.timer) this.arm(this.audioTimeout, 'ElevenLabs stopped sending audio', 'network');
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
