// OS notifications (opt-in). macOS: osascript display notification. Linux: notify-send if present.
// Does not change overlay reminder UX — callers choose when to also say()/enqueue.
import { spawn } from 'node:child_process';

export async function notify({
  title = 'Roamies',
  body = '',
  platform = process.platform,
  run = runCmd,
} = {}) {
  const t = String(title ?? 'Roamies').slice(0, 80);
  const b = String(body ?? '').slice(0, 240);
  if (!b) return { ok: false, reason: 'empty' };
  try {
    if (platform === 'darwin') {
      const script = `display notification ${osaStr(b)} with title ${osaStr(t)}`;
      await run('osascript', ['-e', script]);
      return { ok: true };
    }
    if (platform === 'linux') {
      await run('notify-send', [t, b]);
      return { ok: true };
    }
    if (platform === 'win32') {
      // Best-effort toast via PowerShell; failures are soft.
      const ps = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; $t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $t.GetElementsByTagName('text').Item(0).AppendChild($t.CreateTextNode(${JSON.stringify(t)})) | Out-Null; $t.GetElementsByTagName('text').Item(1).AppendChild($t.CreateTextNode(${JSON.stringify(b)})) | Out-Null; [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Roamies').Show([Windows.UI.Notifications.ToastNotification]::new($t))`;
      await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
      return { ok: true };
    }
    return { ok: false, reason: 'platform' };
  } catch (e) {
    return { ok: false, reason: 'error', message: e.message };
  }
}

function osaStr(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `${cmd} exited ${code}`))));
  });
}
