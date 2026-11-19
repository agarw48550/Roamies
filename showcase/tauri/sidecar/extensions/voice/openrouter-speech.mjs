// OpenRouter TTS via POST /api/v1/audio/speech (PCM). Uses the OpenRouter API key.
export const OR_SPEECH_API = 'https://openrouter.ai/api/v1/audio/speech';
export const OR_SPEECH_MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=speech';
export const OR_SPEECH_RATE = 24000;
export const OR_SPEECH_MODEL = 'google/gemini-3.8-flash-lite-tts';
export const OR_SPEECH_DEFAULT_VOICE = 'Kore';
// Curated starters; the panel can refresh from the Models API.
export const OR_SPEECH_MODELS = [
  'google/gemini-3.8-flash-lite-tts',
  'google/gemini-3.8-flash-tts',
  'mistralai/voxtral-mini-tts-3-0',
];
export const OR_SPEECH_CHOICES = [
  { id: 'google/gemini-3.8-flash-lite-tts', name: 'Gemini 3.8 Flash Lite TTS' },
  { id: 'google/gemini-3.8-flash-tts', name: 'Gemini 3.8 Flash TTS' },
  { id: 'mistralai/voxtral-mini-tts-3-0', name: 'Voxtral Mini TTS 3' },
];

const plain = (text) => String(text ?? '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

export async function openrouterSpeechAccount(key, { fetchImpl = fetch, timeout = 8000 } = {}) {
  if (!key) return { ok: false, reason: 'key' };
  try {
    const r = await fetchImpl('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${key}` },
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

export async function listOpenrouterSpeechModels({ key, fetchImpl = fetch, timeout = 10_000 } = {}) {
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  const r = await fetchImpl(OR_SPEECH_MODELS_URL, { headers, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`OpenRouter models: HTTP ${r.status}`);
  const j = await r.json();
  const rows = Array.isArray(j.data) ? j.data : [];
  return rows.map((m) => ({ id: m.id, name: m.name || m.id })).filter((m) => m.id);
}

/** PCM 16-bit LE mono. Some models return wav/mp3 — we request pcm and strip a WAV header if present. */
function asPcm(buf) {
  if (buf.length >= 44 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
    // Find data chunk
    let i = 12;
    while (i + 8 <= buf.length) {
      const id = buf.toString('ascii', i, i + 4);
      const size = buf.readUInt32LE(i + 4);
      if (id === 'data') return buf.subarray(i + 8, i + 8 + size);
      i += 8 + size;
    }
  }
  return buf;
}

export class OpenRouterSpeechVoice {
  constructor({
    key, voice = OR_SPEECH_DEFAULT_VOICE, model = OR_SPEECH_MODEL, rate = OR_SPEECH_RATE,
    fetchImpl = fetch, onAudio, onEnd, onError,
  }) {
    Object.assign(this, { key, voice, model, rate, fetchImpl, onAudio, onEnd, onError });
    this.queue = [];
    this.state = 'open';
    this.heard = false;
    this.busy = false;
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
  abort() { this.state = 'done'; this.queue.length = 0; }
  rebind(cbs) { Object.assign(this, cbs); return true; }

  async pump() {
    if (this.busy || this.state === 'done') return;
    if (!this.queue.length) {
      if (this.state === 'ending') { this.state = 'done'; this.onEnd?.(); }
      return;
    }
    this.busy = true;
    const text = this.queue.shift();
    try {
      const r = await this.fetchImpl(OR_SPEECH_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/agarw48550/roamies',
          'X-Title': 'Roamies',
        },
        body: JSON.stringify({
          model: this.model,
          input: text,
          voice: this.voice,
          response_format: 'pcm',
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (this.state === 'done') return;
      if (r.status === 401 || r.status === 403) {
        const err = new Error('OpenRouter speech: bad key');
        err.heard = this.heard; err.reason = 'key';
        this.state = 'done';
        return this.onError?.(err);
      }
      if (r.status === 429) {
        const err = new Error('OpenRouter speech: quota');
        err.heard = this.heard; err.reason = 'quota';
        this.state = 'done';
        return this.onError?.(err);
      }
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        const err = new Error(`OpenRouter speech: HTTP ${r.status}${body ? ` ${body.slice(0, 120)}` : ''}`);
        err.heard = this.heard; err.reason = 'network';
        this.state = 'done';
        return this.onError?.(err);
      }
      const pcm = asPcm(Buffer.from(await r.arrayBuffer()));
      if (pcm.length) {
        this.heard = true;
        this.onAudio?.(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
      }
    } catch (e) {
      if (this.state === 'done') return;
      const err = e instanceof Error ? e : new Error(String(e));
      err.heard = this.heard;
      err.reason = 'network';
      this.state = 'done';
      return this.onError?.(err);
    } finally {
      this.busy = false;
    }
    this.pump();
  }
}
