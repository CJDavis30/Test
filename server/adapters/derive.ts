import type { Claim } from '../../shared/types';
import type { Adapter } from './types';

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'mail.com', 'fastmail.com', 'zoho.com', 'yandex.com', 'mailbox.example']);
const ROLE = new Set(['admin', 'info', 'contact', 'support', 'sales', 'hello', 'team', 'noreply', 'no-reply', 'postmaster', 'webmaster', 'abuse', 'office', 'mail']);

/** Free, offline pivots computed purely from the shape of the input. */
export const derive: Adapter = {
  id: 'derive', name: 'Derived from input', description: 'Offline pivots: email → domain/handle, URL → domain, profile URL → username.',
  accepts: ['email', 'url', 'account', 'domain'], capability: 'derive', family: 'derived', reliability: 0.95, priority: 0, anyMode: true,
  selfTest: { type: 'email', value: 'someone@example.com' },
  async run(e) {
    const out: Claim[] = [];
    if (e.type === 'email') {
      const [local, domain] = e.value.toLowerCase().split('@');
      if (domain && !FREE_MAIL.has(domain)) out.push({ type: 'domain', value: domain, relation: 'mailbox at', weight: 0.98, snippet: 'Domain portion of the email address' });
      const handle = local.split('+')[0];
      if (handle.length >= 4 && !ROLE.has(handle)) out.push({ type: 'username', value: handle, relation: 'possible handle', weight: 0.25, snippet: 'Email local part reused as a handle (weak)' });
    }
    if (e.type === 'url' || e.type === 'account') {
      try {
        const u = new URL(e.value);
        out.push({ type: 'domain', value: u.hostname.replace(/^www\./, ''), relation: 'hosted on', weight: 0.98 });
        const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '').replace(/^@/, '');
        if (e.type === 'account' && /^[\w.-]{3,40}$/.test(seg)) out.push({ type: 'username', value: seg, relation: 'handle', weight: 0.6, snippet: 'Last path segment of the profile URL' });
      } catch { /* not a URL */ }
    }
    if (e.type === 'domain') {
      const parts = e.value.split('.');
      if (parts.length > 2) out.push({ type: 'domain', value: parts.slice(-2).join('.'), relation: 'parent domain', weight: 0.9, snippet: 'Registrable parent (naive split — may be wrong for co.uk-style TLDs)' });
    }
    return out;
  },
};
