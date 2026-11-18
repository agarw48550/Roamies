// Thin Gmail / WhatsApp wrappers over existing open + act_in_app paths (1A).
// Send always goes through risky-click confirmation in hands — these helpers only open/draft.
import { checkOpen, ASK } from './safety.mjs';

/** Build a mailto: or Gmail compose URL. */
export function draftEmailTarget({ to = '', subject = '', body = '', via = 'mailto' } = {}) {
  const q = (k, v) => (v ? `${k}=${encodeURIComponent(String(v))}` : '');
  if (via === 'gmail') {
    const parts = [q('to', to), q('su', subject), q('body', body)].filter(Boolean).join('&');
    return `https://mail.google.com/mail/?view=cm&fs=1${parts ? `&${parts}` : ''}`;
  }
  const parts = [q('subject', subject), q('body', body)].filter(Boolean).join('&');
  const addr = String(to || '').trim();
  return `mailto:${addr}${parts ? `?${parts}` : ''}`;
}

/** WhatsApp Web / Desktop deep link. phone in international digits; text optional. */
export function whatsappTarget({ phone = '', text = '', prefer = 'web' } = {}) {
  const p = String(phone || '').replace(/[^\d]/g, '');
  const t = String(text || '');
  if (prefer === 'app' && p) return `whatsapp://send?phone=${p}${t ? `&text=${encodeURIComponent(t)}` : ''}`;
  if (p) return `https://wa.me/${p}${t ? `?text=${encodeURIComponent(t)}` : ''}`;
  return 'https://web.whatsapp.com/';
}

/** Safety check for connector opens — reuses checkOpen. */
export function checkConnectorOpen(target, home) {
  return checkOpen(target, home, {});
}

/** Human-readable tip after opening a draft. */
export function draftOpenedNote(kind, { userName = 'you' } = {}) {
  if (kind === 'email') {
    return `Opened a draft. I won't press Send unless ${userName} clearly ask — that click always asks for confirmation.`;
  }
  return `Opened WhatsApp. I won't press Send unless ${userName} clearly ask — that click always asks for confirmation.`;
}

export { ASK };
