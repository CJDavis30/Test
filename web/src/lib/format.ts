import type { EntityType, Finding, Level } from '@shared/types';
import { labelFor } from '@shared/normalize';

export const TYPE_ORDER: EntityType[] = ['person', 'email', 'phone', 'username', 'account', 'org', 'location', 'domain', 'ip', 'url', 'wallet', 'breach', 'image'];
export const GROUP_LABEL: Record<EntityType, string> = {
  person: 'Names', email: 'Emails', phone: 'Phone numbers', username: 'Usernames', account: 'Accounts', org: 'Organizations',
  location: 'Locations', domain: 'Domains', ip: 'IP addresses', url: 'Pages', wallet: 'Wallets', breach: 'Data breaches', image: 'Images',
};

export const levelColor = (l: Level) => `var(--lvl${l})`;

export function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(+d)) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: iso.length > 7 ? 'numeric' : undefined });
}

export function hostOf(url?: string): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export function platformOf(f: Pick<Finding, 'attrs' | 'value'>): string {
  const p = f.attrs.platform;
  return typeof p === 'string' ? p : hostOf(f.value);
}

export const displayValue = (f: Pick<Finding, 'type' | 'value' | 'attrs'>) => labelFor(f.type, f.value, f.attrs);

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function clamp(n: number, a: number, b: number) { return Math.min(b, Math.max(a, n)); }
