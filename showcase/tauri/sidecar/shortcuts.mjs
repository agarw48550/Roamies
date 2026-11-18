// Instant phrase → approved action shortcuts (Atticus-inspired). Opt-in; stored in shortcuts.json.
// Exact (case-insensitive) match skips the LLM; every action still goes through safety.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { checkOpen, classifyCommand, SAFE, ASK, BLOCK } from './safety.mjs';

export function shortcutsPath(dataDir) {
  return path.join(dataDir, 'shortcuts.json');
}

export function loadShortcuts(dataDir) {
  try {
    const j = JSON.parse(fs.readFileSync(shortcutsPath(dataDir), 'utf8'));
    return Array.isArray(j?.items) ? j.items : [];
  } catch {
    return [];
  }
}

export function saveShortcuts(dataDir, items) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(shortcutsPath(dataDir), JSON.stringify({ version: 1, items }, null, 2));
}

export function normalizePhrase(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function findShortcut(items, phrase) {
  const want = normalizePhrase(phrase);
  if (!want) return null;
  return (items || []).find((it) => normalizePhrase(it.phrase) === want) || null;
}

/**
 * Validate a shortcut before saving.
 * kind: 'open' | 'command'
 */
export function validateShortcut(item, home, { exists = fs.existsSync } = {}) {
  const phrase = String(item?.phrase || '').trim();
  if (phrase.length < 2 || phrase.length > 80) return { ok: false, why: 'Phrase must be 2–80 characters.' };
  const kind = item?.kind === 'command' ? 'command' : 'open';
  const target = String(item?.target || '').trim();
  if (!target) return { ok: false, why: 'Missing target.' };
  if (kind === 'open') {
    const v = checkOpen(target, home, {});
    if (v.level === BLOCK) return { ok: false, why: v.reason || 'Blocked open target.' };
    return { ok: true, item: { phrase, kind, target, ask: v.level === ASK } };
  }
  const v = classifyCommand(target, home, { exists, cwd: home });
  if (v.level === BLOCK) return { ok: false, why: v.reason || 'Blocked command.' };
  if (v.level !== SAFE && v.level !== ASK) return { ok: false, why: 'Command not allowed as a shortcut.' };
  // Shortcuts that would ASK every time are stored but still require confirm at run.
  return { ok: true, item: { phrase, kind, target, ask: v.level === ASK } };
}

export { SAFE, ASK, BLOCK };
