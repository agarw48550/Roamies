import assert from 'node:assert/strict';
import { CartesiaVoice, cartesiaAccount, plain, CARTESIA_MODELS } from '../cartesia.mjs';
import { createSpeaker, PROVIDERS, voiceProblemText } from '../speaker.mjs';
import { SayVoice } from '../macos-say.mjs';

assert.ok(CARTESIA_MODELS.includes('sonic-3'));
assert.equal(plain('[warm] Hello there'), 'Hello there');
assert.ok(PROVIDERS.cartesia);
assert.equal(PROVIDERS.cartesia.sayFallback, true);
assert.match(voiceProblemText('quota', 'Cartesia'), /credits ran out/);

{
  const a = await cartesiaAccount('', { fetchImpl: async () => ({ ok: false }) });
  assert.deepEqual(a, { ok: false, reason: 'key' });
}
{
  const a = await cartesiaAccount('k', {
    fetchImpl: async () => ({ status: 401, ok: false, text: async () => '' }),
  });
  assert.equal(a.reason, 'key');
}
{
  const a = await cartesiaAccount('k', {
    fetchImpl: async () => ({ status: 429, ok: false, text: async () => 'quota_exceeded' }),
  });
  assert.equal(a.reason, 'quota');
}

// Cartesia WebSocket voice: scripted FakeWS
class FakeWS {
  static instances = [];
  constructor(url) { this.url = url; this.sent = []; FakeWS.instances.push(this); setTimeout(() => this.onopen?.(), 0); }
  send(m) { this.sent.push(typeof m === 'string' ? JSON.parse(m) : m); }
  close() { this.closed = true; }
}
{
  FakeWS.instances = [];
  const chunks = [];
  let ended = false;
  const v = new CartesiaVoice({
    key: 'k', WebSocketImpl: FakeWS,
    onAudio: (pcm) => chunks.push(pcm),
    onEnd: () => { ended = true; },
    onError: (e) => { throw e; },
  }).open();
  await new Promise((r) => setTimeout(r, 5));
  v.say('Hi.');
  const ws = FakeWS.instances[0];
  assert.ok(ws.sent.some((m) => m.transcript === 'Hi.' && m.continue === true));
  ws.onmessage({ data: JSON.stringify({ type: 'chunk', data: Buffer.from([1, 0, 2, 0]).toString('base64') }) });
  assert.equal(chunks.length, 1);
  v.end();
  ws.onmessage({ data: JSON.stringify({ type: 'done' }) });
  assert.equal(ended, true);
}

// Speaker: cartesia quota → say fallback only on darwin
{
  class BoomVoice {
    constructor(o) { Object.assign(this, o); }
    open() { return this; }
    say() {}
    end() { setTimeout(() => this.onError(Object.assign(new Error('Cartesia: quota'), { heard: false, reason: 'quota' })), 0); }
    abort() {}
    rebind(cbs) { Object.assign(this, cbs); return true; }
  }
  class FakeSay extends SayVoice {
    constructor(o) { super({ ...o, platform: 'darwin', runSay: async () => new Uint8Array([3, 0, 4, 0]) }); }
  }
  const out = [], problems = [];
  const sp = createSpeaker({
    emit: (m) => out.push(m),
    onProblem: (p) => problems.push(p),
    providers: { cartesia: { ...PROVIDERS.cartesia, Voice: BoomVoice, account: async () => ({ ok: false, reason: 'quota' }) } },
    SayVoiceImpl: FakeSay,
    sayPlatform: 'darwin',
    beatPhrases: [],
    bundled: () => null,
  });
  sp.setProvider('cartesia');
  sp.setKey('k');
  const r = sp.start();
  r.say('Hello.');
  r.end();
  await new Promise((x) => setTimeout(x, 40));
  assert.ok(problems.includes('quota') || problems.some((p) => String(p).includes('quota') || p === 'quota'));
  assert.ok(out.some((m) => m.pcm), 'say fallback should emit pcm');
}

console.log('cartesia tests: passed');
