// The wake word's name: what can be saved, and why not. Run: npm test
import assert from 'node:assert/strict';
import { cleanWakeName, wakeName, wakePhrase, DEFAULT_WAKE_ALIASES } from '../wakename.mjs';

assert.deepEqual(cleanWakeName('Jarvis'), { ok: true, name: 'Jarvis' });
assert.deepEqual(cleanWakeName('  jarvis '), { ok: true, name: 'Jarvis' });
assert.deepEqual(cleanWakeName('Hey Jarvis'), { ok: true, name: 'Jarvis' }, 'the greeting is dropped');
assert.deepEqual(cleanWakeName('hi, NOVA'), { ok: true, name: 'Nova' });
assert.equal(cleanWakeName('Zoë').ok, false, 'under 4 letters');
assert.deepEqual(cleanWakeName('Chloë'), { ok: true, name: 'Chloë' }, 'letters beyond English');
assert.deepEqual(cleanWakeName(''), { ok: true, name: '' }, 'empty: back to Roamie');
assert.deepEqual(cleanWakeName('Roamies'), { ok: true, name: '' });
assert.deepEqual(cleanWakeName('roamie'), { ok: true, name: '' });
assert.deepEqual(cleanWakeName('Roamy'), { ok: true, name: '' }, 'Roamy is a default alias');
assert.deepEqual(cleanWakeName('Romie'), { ok: true, name: '' }, 'Romie is a default alias');
for (const bad of ['Bob', 'Mr Jarvis', 'R2D2', 'Jar-vis', 'okay', 'Alexa', 'x'.repeat(21)]) {
  const r = cleanWakeName(bad);
  assert.equal(r.ok, false, `${bad} is refused`);
  assert.ok(r.why.length > 5, 'with a reason');
}
assert.equal(wakeName({}), 'Roamie');
assert.equal(wakeName({ wakeName: 'Jarvis' }), 'Jarvis');
assert.equal(wakePhrase({}), 'Hey Roamie');
assert.ok(DEFAULT_WAKE_ALIASES.includes('roamie'));
console.log('wake name tests: passed');
