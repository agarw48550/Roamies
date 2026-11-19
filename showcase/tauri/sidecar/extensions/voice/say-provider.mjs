// macOS say as a first-class speaker provider (no key). Adapts SayVoice to the Fish/Cartesia contract.
import { SAY_RATE, SayVoice, sayStatus } from '../../macos-say.mjs';

export { SAY_RATE };

export async function sayAccount() {
  const s = await sayStatus();
  if (!s.ok) return { ok: false, reason: s.reason === 'platform' ? 'platform' : 'network' };
  return { ok: true, credit: null };
}

/** Wraps SayVoice so onAudio only receives pcm (rate comes from PROVIDERS.say.rate). */
export class SayProviderVoice {
  constructor({ onAudio, onEnd, onError, platform = process.platform, voice = null } = {}) {
    this.inner = new SayVoice({
      voice,
      platform,
      onAudio: (pcm) => onAudio?.(pcm),
      onEnd,
      onError,
    });
  }
  open() { this.inner.open(); return this; }
  say(t) { this.inner.say(t); }
  end() { this.inner.end(); }
  abort() { this.inner.abort(); }
  rebind(cbs) {
    this.inner.onAudio = (pcm) => cbs.onAudio?.(pcm);
    this.inner.onEnd = cbs.onEnd;
    this.inner.onError = cbs.onError;
    return true;
  }
}
