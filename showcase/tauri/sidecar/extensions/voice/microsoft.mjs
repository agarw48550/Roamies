// Microsoft Azure Cognitive Services Speech (REST SSML → raw PCM). Sentence queue like macOS say.
export const MS_RATE = 24000;
export const MS_MODELS = ['neural'];
export const MS_MODEL = 'neural';
export const MS_DEFAULT_VOICE = 'en-US-JennyNeural';
export const MS_CHOICES = [{ id: 'neural', name: 'Neural' }];

const plain = (text) => String(text ?? '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

/** key format: "REGION|KEY" or just KEY with region passed separately via voice field prefix "region:". */
export function splitMsKey(key, regionFallback = 'eastus') {
  const s = String(key || '');
  if (s.includes('|')) {
    const i = s.indexOf('|');
    return { region: s.slice(0, i).trim() || regionFallback, key: s.slice(i + 1).trim() };
  }
  return { region: regionFallback, key: s.trim() };
}

export async function microsoftAccount(key, { region = 'eastus', fetchImpl = fetch, timeout = 6000 } = {}) {
  const { region: reg, key: k } = splitMsKey(key, region);
  if (!k) return { ok: false, reason: 'key' };
  try {
    const r = await fetchImpl(`https://${reg}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
      headers: { 'Ocp-Apim-Subscription-Key': k },
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

function ssml(text, voice) {
  const esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<speak version="1.0" xml:lang="en-US"><voice name="${voice}">${esc}</voice></speak>`;
}

export class MicrosoftVoice {
  constructor({
    key, voice = MS_DEFAULT_VOICE, model = MS_MODEL, rate = MS_RATE, region = 'eastus',
    fetchImpl = fetch, onAudio, onEnd, onError,
  }) {
    const split = splitMsKey(key, region);
    Object.assign(this, {
      key: split.key, region: split.region, voice, model, rate, fetchImpl, onAudio, onEnd, onError,
    });
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

  abort() {
    this.state = 'done';
    this.queue.length = 0;
  }

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
      const url = `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
      const r = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': this.key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'raw-24khz-16bit-mono-pcm',
          'User-Agent': 'Roamies',
        },
        body: ssml(text, this.voice),
        signal: AbortSignal.timeout(20_000),
      });
      if (this.state === 'done') return;
      if (r.status === 401 || r.status === 403) {
        const err = new Error('Microsoft Speech: bad key');
        err.heard = this.heard; err.reason = 'key';
        this.state = 'done';
        return this.onError?.(err);
      }
      if (r.status === 429) {
        const err = new Error('Microsoft Speech: quota');
        err.heard = this.heard; err.reason = 'quota';
        this.state = 'done';
        return this.onError?.(err);
      }
      if (!r.ok) {
        const err = new Error(`Microsoft Speech: HTTP ${r.status}`);
        err.heard = this.heard; err.reason = 'network';
        this.state = 'done';
        return this.onError?.(err);
      }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length) {
        this.heard = true;
        this.onAudio?.(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
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
