import assert from 'node:assert/strict';
import { draftEmailTarget, whatsappTarget, draftOpenedNote } from '../connectors.mjs';
import { normalizePhrase, validateShortcut, findShortcut } from '../shortcuts.mjs';
import { checkWatch, createWatch } from '../watch.mjs';
import os from 'node:os';

assert.match(draftEmailTarget({ to: 'a@b.com', subject: 'Hi', via: 'mailto' }), /^mailto:a%40b\.com|^mailto:a@b\.com/);
assert.match(draftEmailTarget({ to: 'a@b.com', subject: 'Hi', via: 'gmail' }), /mail\.google\.com/);
assert.match(whatsappTarget({ phone: '+1 (555) 123-4567', text: 'hey' }), /wa\.me\/15551234567/);
assert.match(draftOpenedNote('email'), /won't press Send/i);

assert.equal(normalizePhrase('  Hello  World '), 'hello world');
{
  const v = validateShortcut({ phrase: 'open docs', kind: 'open', target: 'https://example.com' }, os.homedir());
  assert.equal(v.ok, true);
  assert.equal(findShortcut([v.item], 'Open Docs')?.target, 'https://example.com');
}
{
  const w = createWatch({ kind: 'until', target: String(Date.now() - 1000) });
  assert.equal(checkWatch(w).fired, true);
}
{
  const w = createWatch({ kind: 'file', target: '/no/such/file-roamies-test' });
  assert.equal(checkWatch(w).fired, false);
}
console.log('connectors/shortcuts/watch tests: passed');
