// Ordered TTS fallback chain (fork extension). Default: ElevenLabs → Cartesia → Microsoft → macOS say.
import { CARTESIA_MODEL, CARTESIA_MODELS, CARTESIA_RATE, CartesiaVoice, DEFAULT_VOICE as CARTESIA_DEFAULT_VOICE, cartesiaAccount } from '../../cartesia.mjs';
import { ELEVEN_CHOICES, ELEVEN_DEFAULT_VOICE, ELEVEN_MODEL, ELEVEN_MODELS, ELEVEN_RATE, ElevenLabsVoice, elevenAccount } from './elevenlabs.mjs';
import { MS_CHOICES, MS_DEFAULT_VOICE, MS_MODEL, MS_MODELS, MS_RATE, MicrosoftVoice, microsoftAccount } from './microsoft.mjs';
import {
  OR_SPEECH_CHOICES, OR_SPEECH_DEFAULT_VOICE, OR_SPEECH_MODEL, OR_SPEECH_MODELS, OR_SPEECH_RATE,
  OpenRouterSpeechVoice, openrouterSpeechAccount, listOpenrouterSpeechModels,
} from './openrouter-speech.mjs';
import { SAY_RATE, SayProviderVoice, sayAccount } from './say-provider.mjs';

export const CHAIN_IDS = ['elevenlabs', 'cartesia', 'microsoft', 'openrouter', 'say'];
export const DEFAULT_VOICE_CHAIN = ['elevenlabs', 'cartesia', 'microsoft', 'say'];

export const CHAIN_LABELS = {
  elevenlabs: 'ElevenLabs',
  cartesia: 'Cartesia',
  microsoft: 'Microsoft Speech',
  openrouter: 'OpenRouter speech',
  say: 'macOS Say',
};

export function normalizeVoiceChain(raw) {
  const seen = new Set();
  const out = [];
  for (const id of Array.isArray(raw) ? raw : DEFAULT_VOICE_CHAIN) {
    if (!CHAIN_IDS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  // Always keep say as last-resort on Mac if the chain is non-empty and say was omitted.
  if (out.length && !out.includes('say') && process.platform === 'darwin') out.push('say');
  return out.length ? out : [...DEFAULT_VOICE_CHAIN];
}

/** Extra PROVIDERS entries for createSpeaker({ providers }). region may be a string or () => string. */
export function extensionProviders({ microsoftRegion = 'eastus' } = {}) {
  const region = () => (typeof microsoftRegion === 'function' ? microsoftRegion() : microsoftRegion) || 'eastus';
  return {
    elevenlabs: {
      id: 'elevenlabs', name: 'ElevenLabs', Voice: ElevenLabsVoice, account: elevenAccount,
      models: ELEVEN_MODELS, pick: ELEVEN_MODEL, freeModel: null, rate: ELEVEN_RATE, defaultVoice: ELEVEN_DEFAULT_VOICE,
    },
    microsoft: {
      id: 'microsoft', name: 'Microsoft Speech',
      Voice: class extends MicrosoftVoice {
        constructor(opts) { super({ ...opts, region: region() }); }
      },
      account: (key) => microsoftAccount(key, { region: region() }),
      models: MS_MODELS, pick: MS_MODEL, freeModel: null, rate: MS_RATE, defaultVoice: MS_DEFAULT_VOICE,
    },
    openrouter: {
      id: 'openrouter', name: 'OpenRouter speech', Voice: OpenRouterSpeechVoice, account: openrouterSpeechAccount,
      models: OR_SPEECH_MODELS, pick: OR_SPEECH_MODEL, freeModel: null, rate: OR_SPEECH_RATE, defaultVoice: OR_SPEECH_DEFAULT_VOICE,
    },
    say: {
      id: 'say', name: 'macOS Say', Voice: SayProviderVoice, account: sayAccount,
      models: ['say'], pick: 'say', freeModel: null, rate: SAY_RATE, defaultVoice: null, noKey: true,
    },
    // Keep cartesia registered here too so chain fallbacks can switch to it even if core PROVIDERS changes.
    cartesia: {
      id: 'cartesia', name: 'Cartesia', Voice: CartesiaVoice, account: cartesiaAccount,
      models: CARTESIA_MODELS, pick: CARTESIA_MODEL, freeModel: null, rate: CARTESIA_RATE, defaultVoice: CARTESIA_DEFAULT_VOICE,
    },
  };
}

export const EXTENSION_TTS_META = {
  elevenlabs: { id: 'elevenlabs', name: 'ElevenLabs', secret: 'elevenlabs', site: 'elevenlabs.io' },
  microsoft: { id: 'microsoft', name: 'Microsoft Speech', secret: 'microsoft-speech', site: 'portal.azure.com', hint: 'Save as REGION|KEY (e.g. eastus|yourkey)' },
  openrouter: { id: 'openrouter', name: 'OpenRouter speech', secret: 'openrouter-speech', site: 'openrouter.ai', sharedProvider: 'openrouter' },
  say: { id: 'say', name: 'macOS Say', local: true, noKey: true },
  chain: { id: 'chain', name: 'Fallback chain', chain: true },
};

export {
  ELEVEN_CHOICES, ELEVEN_DEFAULT_VOICE, ELEVEN_MODEL, MS_CHOICES, MS_DEFAULT_VOICE, MS_MODEL,
  OR_SPEECH_CHOICES, OR_SPEECH_DEFAULT_VOICE, OR_SPEECH_MODEL, listOpenrouterSpeechModels,
};
