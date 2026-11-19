import assert from 'node:assert/strict';
import { normalizeVoiceChain, DEFAULT_VOICE_CHAIN, extensionProviders, ALLOWED_KEYS, createSelfConfigTool } from '../extensions/index.mjs';
import { elevenAccount } from '../extensions/voice/elevenlabs.mjs';
import { splitMsKey, microsoftAccount } from '../extensions/voice/microsoft.mjs';
import { openrouterSpeechAccount } from '../extensions/voice/openrouter-speech.mjs';
import { createSpeaker } from '../speaker.mjs';

assert.deepEqual(
  normalizeVoiceChain(['elevenlabs', 'cartesia', 'bogus', 'elevenlabs']),
  process.platform === 'darwin' ? ['elevenlabs', 'cartesia', 'say'] : ['elevenlabs', 'cartesia'],
);
assert.ok(DEFAULT_VOICE_CHAIN[0] === 'elevenlabs');
assert.ok(DEFAULT_VOICE_CHAIN.includes('cartesia') && DEFAULT_VOICE_CHAIN.includes('microsoft'));
assert.ok(ALLOWED_KEYS.voiceChain && ALLOWED_KEYS.selfConfigure && ALLOWED_KEYS.protectExtensions);

{
  const a = await elevenAccount('', { fetchImpl: async () => ({ ok: false }) });
  assert.equal(a.reason, 'key');
}
assert.deepEqual(splitMsKey('eastus|abc'), { region: 'eastus', key: 'abc' });
{
  const a = await microsoftAccount('', { fetchImpl: async () => ({ ok: false }) });
  assert.equal(a.reason, 'key');
}
{
  const a = await openrouterSpeechAccount('', { fetchImpl: async () => ({ ok: false }) });
  assert.equal(a.reason, 'key');
}

{
  let cfg = { tts: 'chain', voiceChain: [...DEFAULT_VOICE_CHAIN], selfConfigure: true };
  const tool = createSelfConfigTool({
    getConfig: () => cfg,
    setConfig: (p) => { cfg = { ...cfg, ...p }; },
    userName: 'Ayaan',
  });
  const listed = await tool.execute({ action: 'list' });
  assert.match(listed, /voiceChain/);
  await tool.execute({ action: 'set', key: 'tts', value: 'cartesia' });
  assert.equal(cfg.tts, 'cartesia');
  await tool.execute({ action: 'set', key: 'voiceChain', value: 'microsoft,cartesia,say' });
  assert.ok(cfg.voiceChain.includes('microsoft'));
  await assert.rejects(() => tool.execute({ action: 'set', key: 'allowActions', value: true }));
}

{
  const providers = extensionProviders({ microsoftRegion: 'westus' });
  assert.ok(providers.elevenlabs && providers.microsoft && providers.openrouter && providers.say && providers.cartesia);
  let switched = [];
  const sp = createSpeaker({
    emit: () => {},
    providers,
    getFallbacks: () => ['say'],
    resolveFallback: async (id) => {
      switched.push(id);
      return id === 'say' ? { key: null, voice: null, model: 'say' } : null;
    },
    sayPlatform: 'darwin',
  });
  sp.setProvider('say');
  assert.equal(sp.provider, 'say');
  assert.equal(sp.on, true);
}

console.log('extensions tests: passed');
