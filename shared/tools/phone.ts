/** Read a phone number: every format, which countries it could belong to, and the traps (toll-free, premium-rate, fictional 555 numbers). Runs offline. */
import { parsePhoneNumberFromString, getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js/min';

export interface PhoneReport {
  input: string; valid: boolean; possible: boolean; e164?: string; international?: string; national?: string; country?: string; countryName?: string; callingCode?: string;
  candidates: { country: string; name: string; e164: string }[]; flags: { level: 'info' | 'notice' | 'warning'; text: string }[]; links: { label: string; url: string }[];
}

const NAMES = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new (Intl as any).DisplayNames(['en'], { type: 'region' }) : null;
const nameOf = (c: string) => { try { return NAMES?.of(c) ?? c; } catch { return c; } };

export function readPhone(input: string, hint: CountryCode = 'US'): PhoneReport {
  const raw = input.trim();
  const hasPlus = raw.startsWith('+');
  const first = parsePhoneNumberFromString(raw, hasPlus ? undefined : hint);
  const flags: PhoneReport['flags'] = [], links: PhoneReport['links'] = [];
  const candidates: PhoneReport['candidates'] = [];
  if (!hasPlus) {
    for (const c of getCountries()) { const p = parsePhoneNumberFromString(raw, c); if (p?.isValid() && !candidates.some((x) => x.e164 === p.number && x.country === c)) candidates.push({ country: c, name: nameOf(c), e164: p.number }); }
    candidates.sort((a, b) => (a.country === hint ? -1 : b.country === hint ? 1 : a.country.localeCompare(b.country)));
  }
  const rep: PhoneReport = { input: raw, valid: !!first?.isValid(), possible: !!first?.isPossible(), candidates: candidates.slice(0, 12), flags, links };
  if (first) {
    rep.e164 = first.number; rep.international = first.formatInternational(); rep.national = first.formatNational(); rep.country = first.country; rep.countryName = first.country ? nameOf(first.country) : undefined; rep.callingCode = first.countryCallingCode;
    const nsn = first.nationalNumber;
    if (first.countryCallingCode === '1') {
      if (/^(800|833|844|855|866|877|888)/.test(nsn)) flags.push({ level: 'notice', text: 'US/Canada toll-free number. Businesses and scammers use these; it is not tied to a person or place.' });
      if (/^(900|976)/.test(nsn)) flags.push({ level: 'warning', text: 'Premium-rate number: calling or texting it can cost money.' });
      if (/^\d{3}555(01\d\d)$/.test(nsn)) flags.push({ level: 'warning', text: 'The 555-0100 to 555-0199 range is reserved for fiction (films, books). It is never a real subscriber.' });
      if (/^(5[0-9]{2})?5550\d{3}$/.test(nsn) || /^\d{3}555\d{4}$/.test(nsn)) flags.push({ level: 'notice', text: 'Exchange 555 is rarely used for real lines.' });
      if (/^(\d)\1{9}$/.test(nsn) || /^(123456|234567)/.test(nsn.slice(3))) flags.push({ level: 'notice', text: 'This looks like a made-up number (repeated or sequential digits).' });
      if (/^(5(00|21|22|33|44|66|77|88)|600|700)/.test(nsn)) flags.push({ level: 'notice', text: 'Area code used for personal-numbering or services, not for ordinary geographic lines.' });
    }
    if (first.countryCallingCode === '44' && /^7[0-9]{9}$/.test(nsn)) flags.push({ level: 'info', text: 'UK mobile (07…). Mobile numbers can be moved between carriers, so the prefix does not name the current carrier.' });
    if (!first.isValid() && first.isPossible()) flags.push({ level: 'notice', text: 'The length is plausible but the number is not valid for that country (wrong prefix).' });
    if (!first.isValid() && !first.isPossible()) flags.push({ level: 'warning', text: 'Not a valid phone number for that country.' });
    flags.push({ level: 'info', text: 'Plexus cannot tell the carrier or whether the line is a mobile, a landline or a VoIP number without a paid lookup. Numbers can also be ported or spoofed.' });
    const e = first.number.replace('+', '');
    links.push({ label: 'WhatsApp (does it have an account?)', url: `https://wa.me/${e}` }, { label: 'Telegram (t.me)', url: `https://t.me/+${e}` }, { label: 'Truecaller search', url: `https://www.truecaller.com/search/${(first.country ?? 'us').toLowerCase()}/${first.nationalNumber}` }, { label: 'Search the number on the web', url: `https://www.google.com/search?q=${encodeURIComponent(`"${first.formatInternational()}" OR "${first.formatNational()}"`)}` });
  } else {
    flags.push({ level: 'warning', text: 'Could not read that as a phone number.' });
  }
  return rep;
}
export { getCountryCallingCode };
