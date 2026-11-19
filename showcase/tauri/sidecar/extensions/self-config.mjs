// Limited self-configuration: the agent may change a whitelist of settings when asked — never rewrite app source.
import { z } from 'zod';
import { CHAIN_IDS, normalizeVoiceChain } from './voice/chain.mjs';

/** Settings the agent is allowed to read/change via configure_self. */
export const ALLOWED_KEYS = {
  voiceChain: {
    type: 'voiceChain',
    description: 'Ordered TTS fallback list (elevenlabs, cartesia, microsoft, openrouter, say)',
  },
  tts: {
    type: 'enum',
    values: ['chain', 'elevenlabs', 'cartesia', 'microsoft', 'openrouter', 'say', 'fish', 'gemini', 'voicestudio'],
    description: 'Which voice mode speaks (use chain for the fallback list)',
  },
  replies: { type: 'enum', values: ['text', 'voice'], description: 'Text only, or voice and text' },
  elevenlabsVoice: { type: 'string', max: 80, description: 'ElevenLabs voice id' },
  elevenlabsModel: { type: 'string', max: 80, description: 'ElevenLabs model id' },
  cartesiaVoice: { type: 'string', max: 80, description: 'Cartesia voice id' },
  cartesiaModel: { type: 'string', max: 40, description: 'Cartesia model id' },
  microsoftVoice: { type: 'string', max: 80, description: 'Azure neural voice name' },
  microsoftRegion: { type: 'string', max: 40, description: 'Azure Speech region' },
  openrouterSpeechModel: { type: 'string', max: 120, description: 'OpenRouter speech model slug' },
  openrouterSpeechVoice: { type: 'string', max: 80, description: 'OpenRouter speech voice id' },
  screenMemory: { type: 'bool', description: 'Continuous screen memory' },
  lowMemoryMode: { type: 'bool', description: 'Throttle extras under memory pressure' },
  osNotify: { type: 'bool', description: 'OS notifications' },
  wakeWord: { type: 'bool', description: 'Hey-Roamie wake word (Mac)' },
  autoListen: { type: 'bool', description: 'Open mic after spoken replies' },
  protectExtensions: { type: 'bool', description: 'Block automatic in-app updates that would wipe fork extras' },
  selfConfigure: { type: 'bool', description: 'Allow this configure_self tool' },
};

function coerce(spec, value) {
  if (spec.type === 'bool') {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 'on' || value === '1') return true;
    if (value === 'false' || value === 'off' || value === '0') return false;
    throw new Error('Expected true/false');
  }
  if (spec.type === 'enum') {
    const v = String(value);
    if (!spec.values.includes(v)) throw new Error(`Must be one of: ${spec.values.join(', ')}`);
    return v;
  }
  if (spec.type === 'string') {
    const v = String(value ?? '').trim();
    if (!v || v.length > (spec.max || 200)) throw new Error('Bad string value');
    return v;
  }
  if (spec.type === 'voiceChain') {
    const list = Array.isArray(value) ? value : String(value).split(/[,\s>→]+/).map((s) => s.trim()).filter(Boolean);
    const n = normalizeVoiceChain(list.filter((id) => CHAIN_IDS.includes(id)));
    if (!n.length) throw new Error('voiceChain needs at least one known provider');
    return n;
  }
  throw new Error('Unknown setting type');
}

/**
 * Tool factory. getConfig/setConfig persist; afterSet refreshes speaker/UI.
 */
export function createSelfConfigTool({
  getConfig,
  setConfig,
  afterSet = async () => {},
  enabled = () => true,
  userName = 'you',
} = {}) {
  return {
    name: 'configure_self',
    description:
      `Change Roamies settings when ${userName} asks you to reconfigure voice, fallbacks, or feature flags. `
      + 'Only a fixed whitelist of keys is allowed — you cannot edit source code, safety rules, or secrets. '
      + 'Use action=list to see allowed keys, get to read, set to change. Confirm destructive-sounding changes with the user first.',
    parameters: z.object({
      action: z.enum(['list', 'get', 'set']),
      key: z.string().max(60).optional(),
      value: z.union([z.string(), z.boolean(), z.array(z.string())]).optional(),
    }),
    execute: async ({ action, key, value }) => {
      if (!enabled()) throw new Error('Self-configure is turned off in the panel.');
      if (action === 'list') {
        return Object.entries(ALLOWED_KEYS)
          .map(([k, s]) => `${k}: ${s.description}`)
          .join('\n');
      }
      if (!key || !ALLOWED_KEYS[key]) throw new Error(`Unknown or blocked key. Allowed: ${Object.keys(ALLOWED_KEYS).join(', ')}`);
      const cfg = getConfig();
      if (action === 'get') {
        return JSON.stringify({ key, value: cfg[key] ?? null });
      }
      const next = coerce(ALLOWED_KEYS[key], value);
      const patch = { [key]: next };
      setConfig(patch);
      await afterSet(patch);
      return `Updated ${key} to ${JSON.stringify(next)}.`;
    },
  };
}
