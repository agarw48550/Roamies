import assert from 'node:assert/strict';
import { checkConnectorOpen, draftEmailTarget, whatsappTarget } from '../connectors.mjs';
import { SAFE, ASK, BLOCK } from '../safety.mjs';
import os from 'node:os';

const home = os.homedir();
assert.equal(checkConnectorOpen(draftEmailTarget({ to: 'a@b.com' }), home).level, SAFE);
assert.equal(checkConnectorOpen(whatsappTarget({ phone: '15551234567' }), home).level, SAFE);
assert.equal(checkConnectorOpen('file:///etc/passwd', home).level, BLOCK);
assert.ok([SAFE, ASK, BLOCK].includes(checkConnectorOpen('https://web.whatsapp.com/', home).level));
console.log('addons safety tests: passed');
