// Opt-in addon tools (PIM, connectors, screen memory, shortcuts, watches). Merged into createTools by sidekick.
import { z } from 'zod';
import os from 'node:os';
import path from 'node:path';
import { ASK, BLOCK, isYes } from './safety.mjs';
import { pimAvailable, listReminders, addReminder, completeReminder, listCalendarToday, addCalendarEvent } from './pim.mjs';
import { draftEmailTarget, whatsappTarget, checkConnectorOpen, draftOpenedNote } from './connectors.mjs';
import {
  screenmemStatus, screenmemStart, screenmemStop, screenmemConfigure, searchScreenHistory, createLocalFrameStore,
} from './screenmem.mjs';
import { loadShortcuts, saveShortcuts, findShortcut, validateShortcut, normalizePhrase } from './shortcuts.mjs';
import { createWatch } from './watch.mjs';
import { notify } from './notify.mjs';

const HOME = os.homedir();

/**
 * Extra tools. All gated by flags on `gates` so defaults stay off / no-ops when unavailable.
 * gates: { macPim, screenMemory, shortcuts, watches, osNotify, paused }
 */
export function createAddonTools({
  allowActions,
  ask,
  openTarget, // async (target) => string result — usually tools' open execute
  actInApp, // optional async (steps) => …
  dataDir,
  userName = 'you',
  gates = {},
  watches,
  screenMemPaused = () => false,
} = {}) {
  const confirm = async (reason, ctx) => {
    if (typeof ask !== 'function') return false;
    const a = await ask({ prompt: reason, yesNo: true }, ctx);
    return isYes(a);
  };

  const need = (flag, label) => {
    if (!gates[flag]) throw new Error(`Turn on ${label} in the panel (Behavior → Add-ons) first.`);
  };

  const tools = [];

  tools.push(
    {
      name: 'list_reminders',
      description: `List incomplete reminders from the Mac Reminders app (not Roamies' own list). Use when ${userName} asks what's in Reminders. Needs the Mac PIM add-on.`,
      parameters: z.object({}),
      execute: async () => {
        need('macPim', 'Mac Reminders & Calendar');
        if (!pimAvailable()) throw new Error('Reminders bridge is Mac-only.');
        const rows = await listReminders();
        if (!rows.length) return 'No open reminders in Reminders.app.';
        return rows.map((r, i) => `${i + 1}. ${r.name}${r.due ? ` (due ${r.due})` : ''}`).join('\n');
      },
    },
    {
      name: 'edit_reminder',
      description: `Add or complete a reminder in the Mac Reminders app. action: 'add' or 'complete'. Needs the Mac PIM add-on. Roamies' own remember_commitment list is separate.`,
      parameters: z.object({ action: z.enum(['add', 'complete']), text: z.string().min(1).max(200), due: z.string().optional() }),
      execute: async ({ action, text, due }, ctx) => {
        need('macPim', 'Mac Reminders & Calendar');
        if (!pimAvailable()) throw new Error('Reminders bridge is Mac-only.');
        if (!allowActions()) throw new Error('Actions are off.');
        if (!(await confirm(`${action === 'add' ? 'Add' : 'Complete'} reminder “${text.slice(0, 60)}” in Reminders?`, ctx))) {
          throw new Error(`${userName} said no.`);
        }
        if (action === 'add') {
          const r = await addReminder(text, { due: due || null });
          return `Added reminder “${r.name}” in Reminders.app.`;
        }
        const r = await completeReminder(text);
        return `Completed “${r.name}” in Reminders.app.`;
      },
    },
    {
      name: 'list_calendar',
      description: `List today's events from the Mac Calendar app. Needs the Mac PIM add-on.`,
      parameters: z.object({}),
      execute: async () => {
        need('macPim', 'Mac Reminders & Calendar');
        if (!pimAvailable()) throw new Error('Calendar bridge is Mac-only.');
        const rows = await listCalendarToday();
        if (!rows.length) return 'Nothing on the Calendar for today.';
        return rows.map((e, i) => `${i + 1}. ${e.title} (${e.start || '?'} – ${e.end || '?'})`).join('\n');
      },
    },
    {
      name: 'edit_calendar',
      description: `Add an event to the Mac Calendar app. Needs title, start and end as Mac date strings. Needs the Mac PIM add-on.`,
      parameters: z.object({ title: z.string().min(1).max(200), start: z.string(), end: z.string() }),
      execute: async ({ title, start, end }, ctx) => {
        need('macPim', 'Mac Reminders & Calendar');
        if (!pimAvailable()) throw new Error('Calendar bridge is Mac-only.');
        if (!allowActions()) throw new Error('Actions are off.');
        if (!(await confirm(`Add “${title.slice(0, 60)}” to Calendar?`, ctx))) throw new Error(`${userName} said no.`);
        const e = await addCalendarEvent(title, { start, end });
        return `Added “${e.title}” to Calendar.`;
      },
    },
  );

  tools.push(
    {
      name: 'draft_email',
      description: `Open a Gmail or mailto draft for ${userName}. Does not send — Send always needs their confirmation via act_in_app. via: 'gmail' (browser) or 'mailto' (Mail app).`,
      parameters: z.object({
        to: z.string().optional(),
        subject: z.string().optional(),
        body: z.string().optional(),
        via: z.enum(['gmail', 'mailto']).optional(),
      }),
      execute: async ({ to, subject, body, via = 'mailto' }) => {
        if (!allowActions()) throw new Error('Actions are off.');
        const target = draftEmailTarget({ to, subject, body, via });
        const v = checkConnectorOpen(target, HOME);
        if (v.level === BLOCK) throw new Error(v.reason || 'Blocked.');
        await openTarget(target);
        return draftOpenedNote('email', { userName });
      },
    },
    {
      name: 'send_whatsapp',
      description: `Open WhatsApp (Web or app link) with an optional phone (digits) and draft text. Does not press Send — that always asks ${userName} first via act_in_app.`,
      parameters: z.object({
        phone: z.string().optional(),
        text: z.string().optional(),
        prefer: z.enum(['web', 'app']).optional(),
      }),
      execute: async ({ phone, text, prefer = 'web' }) => {
        if (!allowActions()) throw new Error('Actions are off.');
        const target = whatsappTarget({ phone, text, prefer });
        const v = checkConnectorOpen(target, HOME);
        if (v.level === BLOCK) throw new Error(v.reason || 'Blocked.');
        await openTarget(target);
        return draftOpenedNote('whatsapp', { userName });
      },
    },
  );

  tools.push({
    name: 'notify_user',
    description: `Show a system notification. Use for background watches or when the overlay may be hidden. Needs OS notifications add-on.`,
    parameters: z.object({ title: z.string().max(80).optional(), body: z.string().min(1).max(240) }),
    execute: async ({ title, body }) => {
      need('osNotify', 'OS notifications');
      const r = await notify({ title: title || 'Roamies', body });
      if (!r.ok) throw new Error(r.message || r.reason || 'Notification failed.');
      return 'Notification posted.';
    },
  });

  const localDir = path.join(dataDir, 'screenmem');
  const local = createLocalFrameStore(localDir);
  tools.push(
    {
      name: 'screen_memory_status',
      description: 'Whether continuous screen memory is running and how many frames are stored. Needs Screen memory add-on.',
      parameters: z.object({}),
      execute: async () => {
        need('screenMemory', 'Screen memory');
        if (screenMemPaused()) return 'Screen memory is paused (low-memory mode).';
        const s = await screenmemStatus();
        if (!s.ok) return `Screen memory helper offline (${s.message || s.reason}). Local frames: ${local.count()}.`;
        return `Screen memory ${s.capturing ? 'capturing' : 'idle'}${s.paused ? ' (paused)' : ''}; helper frames: ${s.frames ?? '?'}; local: ${local.count()}.`;
      },
    },
    {
      name: 'search_screen_history',
      description: `Search recent screen-memory frames for what ${userName} was looking at. Read-only. Needs Screen memory add-on.`,
      parameters: z.object({ query: z.string().min(1).max(200) }),
      execute: async ({ query }) => {
        need('screenMemory', 'Screen memory');
        try {
          const remote = await searchScreenHistory(query);
          if (remote.length) {
            return remote.map((r, i) => `${i + 1}. ${r.summary || r.text || JSON.stringify(r)}`).join('\n');
          }
        } catch { /* fall through to local */ }
        const hits = local.search(query);
        if (!hits.length) return 'No matching screen-memory frames.';
        return hits.map((r, i) => `${i + 1}. ${r.summary || r.text || ''}`).join('\n');
      },
    },
  );

  tools.push(
    {
      name: 'list_shortcuts',
      description: 'List instant phrase shortcuts (exact phrase → open or approved command, no LLM). Needs Shortcuts add-on.',
      parameters: z.object({}),
      execute: async () => {
        need('shortcuts', 'Shortcuts');
        const items = loadShortcuts(dataDir);
        if (!items.length) return 'No shortcuts saved.';
        return items.map((it) => `“${it.phrase}” → ${it.kind} ${it.target}${it.ask ? ' (asks first)' : ''}`).join('\n');
      },
    },
    {
      name: 'save_shortcut',
      description: `Save an instant shortcut: when ${userName} says the exact phrase, run open or command without calling the model. Needs Shortcuts add-on.`,
      parameters: z.object({
        phrase: z.string().min(2).max(80),
        kind: z.enum(['open', 'command']),
        target: z.string().min(1).max(500),
      }),
      execute: async ({ phrase, kind, target }, ctx) => {
        need('shortcuts', 'Shortcuts');
        const v = validateShortcut({ phrase, kind, target }, HOME);
        if (!v.ok) throw new Error(v.why);
        if (!(await confirm(`Save shortcut “${normalizePhrase(phrase)}” → ${kind} ${target}?`, ctx))) {
          throw new Error(`${userName} said no.`);
        }
        const items = loadShortcuts(dataDir).filter((it) => normalizePhrase(it.phrase) !== normalizePhrase(phrase));
        items.push(v.item);
        saveShortcuts(dataDir, items);
        return `Saved shortcut “${v.item.phrase}”.`;
      },
    },
  );

  tools.push({
    name: 'watch_for',
    description: `Watch for a file to appear or contain text, or until a unix-ms time, then notify ${userName}. No AI while waiting. Needs Watches add-on.`,
    parameters: z.object({
      kind: z.enum(['file', 'until']),
      target: z.string().min(1),
      match: z.string().optional(),
      message: z.string().max(200).optional(),
    }),
    execute: async ({ kind, target, match, message }) => {
      need('watches', 'Watches');
      if (!watches) throw new Error('Watch runner unavailable.');
      const w = createWatch({ kind, target, match, message: message || 'Watch finished.' });
      watches.add(w);
      return `Watching (${w.id}). I'll notify when it fires.`;
    },
  });

  // Internal helper for sidekick to resolve a shortcut before the LLM.
  tools._findShortcut = (phrase) => findShortcut(loadShortcuts(dataDir), phrase);
  tools._screenmemControl = { start: screenmemStart, stop: screenmemStop, configure: screenmemConfigure, status: screenmemStatus };

  return tools;
}
