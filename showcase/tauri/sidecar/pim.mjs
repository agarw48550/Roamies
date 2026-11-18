// macOS Reminders + Calendar via AppleScript (1A). Opt-in tools call these; off/non-Mac → clear errors.
// Does not replace Roamies memory.json commitments — syncs out when the user asks.
import { spawn } from 'node:child_process';

export function pimAvailable(platform = process.platform) {
  return platform === 'darwin';
}

/** List incomplete Reminders (name + optional due). */
export async function listReminders({ run = osa, limit = 40 } = {}) {
  const script = `
tell application "Reminders"
  set out to {}
  set n to 0
  repeat with r in (reminders whose completed is false)
    set n to n + 1
    if n > ${Math.max(1, limit)} then exit repeat
    set dueText to ""
    try
      if due date of r is not missing value then set dueText to (due date of r as string)
    end try
    set end of out to ((name of r) & "||" & dueText)
  end repeat
  set AppleScript's text item delimiters to linefeed
  return out as text
end tell`;
  const text = await run(script);
  return String(text).split('\n').filter(Boolean).map((line) => {
    const [name, due] = line.split('||');
    return { name: name || line, due: due || null };
  });
}

/** Add a reminder; optional due as AppleScript-parseable date string. */
export async function addReminder(name, { due = null, run = osa } = {}) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Reminder needs a name.');
  const dueLine = due
    ? `set due date of r to date ${osaQuote(String(due))}`
    : '';
  const script = `
tell application "Reminders"
  set r to make new reminder with properties {name:${osaQuote(n)}}
  ${dueLine}
  return name of r
end tell`;
  return { name: String(await run(script)).trim() };
}

/** Complete the first incomplete reminder whose name contains needle (case-insensitive). */
export async function completeReminder(needle, { run = osa } = {}) {
  const q = String(needle || '').trim().toLowerCase();
  if (!q) throw new Error('Say which reminder to complete.');
  const script = `
tell application "Reminders"
  repeat with r in (reminders whose completed is false)
    if (name of r as text) contains ${osaQuote(q)} then
      set completed of r to true
      return name of r
    end if
  end repeat
  error "No open reminder matched."
end tell`;
  return { name: String(await run(script)).trim() };
}

/** Today's calendar events (title + time range). */
export async function listCalendarToday({ run = osa, limit = 30 } = {}) {
  const script = `
set todayStart to current date
set time of todayStart to 0
set todayEnd to todayStart + (1 * days)
tell application "Calendar"
  set out to {}
  set n to 0
  repeat with c in calendars
    repeat with e in (events of c whose start date ≥ todayStart and start date < todayEnd)
      set n to n + 1
      if n > ${Math.max(1, limit)} then exit repeat
      set end of out to ((summary of e) & "||" & ((start date of e) as string) & "||" & ((end date of e) as string))
    end repeat
    if n > ${Math.max(1, limit)} then exit repeat
  end repeat
  set AppleScript's text item delimiters to linefeed
  return out as text
end tell`;
  const text = await run(script);
  return String(text).split('\n').filter(Boolean).map((line) => {
    const [title, start, end] = line.split('||');
    return { title: title || line, start: start || null, end: end || null };
  });
}

/** Create a calendar event on the first calendar. start/end are AppleScript date strings. */
export async function addCalendarEvent(title, { start, end, run = osa } = {}) {
  const t = String(title || '').trim();
  if (!t) throw new Error('Event needs a title.');
  if (!start || !end) throw new Error('Event needs start and end times.');
  const script = `
tell application "Calendar"
  tell calendar 1
    set e to make new event with properties {summary:${osaQuote(t)}, start date:date ${osaQuote(String(start))}, end date:date ${osaQuote(String(end))}}
    return summary of e
  end tell
end tell`;
  return { title: String(await run(script)).trim() };
}

export function osaQuote(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function osa(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `osascript exited ${code}`))));
  });
}
