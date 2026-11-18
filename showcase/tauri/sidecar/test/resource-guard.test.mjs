import assert from 'node:assert/strict';
import { assess, DEFAULT_THRESHOLDS, createResourceGuard } from '../resource-guard.mjs';

{
  const a = assess({ freeRatio: 0.5, selfRssMb: 200, heavies: [] });
  assert.equal(a.pressure, false);
}
{
  const a = assess({ freeRatio: 0.05, selfRssMb: 200, heavies: [{ name: 'Chrome', cpu: 90 }] }, DEFAULT_THRESHOLDS);
  assert.equal(a.pressure, true);
  assert.ok(a.message.includes('Chrome'));
  assert.equal(a.throttleScreenMem, true);
}
{
  let warns = 0, throttles = 0, n = 0;
  const g = createResourceGuard({
    enabled: true,
    everyMs: 10_000,
    cooldownMs: 1,
    sample: async () => ({ freeRatio: 0.01, selfRssMb: 100, heavies: [{ name: 'X', cpu: 99 }], totalMb: 8192, freeMb: 80, load1: 2, at: Date.now() }),
    onWarn: () => { warns++; },
    onThrottle: () => { throttles++; },
    setTimer: (f) => { if (++n > 1) return 0; setTimeout(f, 0); return 1; },
    clearTimer: () => {},
  });
  g.start();
  await new Promise((r) => setTimeout(r, 30));
  g.stop();
  assert.ok(warns >= 1);
  assert.ok(throttles >= 1);
}
console.log('resource-guard tests: passed');
