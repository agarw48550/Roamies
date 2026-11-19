// Fork extension entry. Keep hooks here so upstream merges only touch a few call sites.
export {
  CHAIN_IDS, CHAIN_LABELS, DEFAULT_VOICE_CHAIN, EXTENSION_TTS_META, extensionProviders, normalizeVoiceChain,
  ELEVEN_CHOICES, ELEVEN_DEFAULT_VOICE, ELEVEN_MODEL, MS_CHOICES, MS_DEFAULT_VOICE, MS_MODEL,
  OR_SPEECH_CHOICES, OR_SPEECH_DEFAULT_VOICE, OR_SPEECH_MODEL, listOpenrouterSpeechModels,
} from './voice/chain.mjs';
export { ALLOWED_KEYS, createSelfConfigTool } from './self-config.mjs';

export const EXTENSION_VERSION = 1;
