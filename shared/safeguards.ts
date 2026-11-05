/**
 * Safeguards for investigations that touch young people. Roblox, Discord and similar places are full of children, and an account on one
 * can lead, in a few steps, to a real name, a school or a street. Plexus looks for signs that a subject may be a minor (what they say about
 * themselves in public, never a guess from behaviour) and, when it sees them, holds back from the steps that point toward a real-world
 * identity and says why. It can be wrong in both directions, so a human can always override it, and every override is logged.
 */
const AGE = [
  /\b(?:i['’]?m|im|i am|age[d]?\s*[:=]?|aged)\s*(?:only\s*|just\s*)?(1[0-7]|[5-9])\b(?!\s*(?:\+|k\b|m\b|%|:|\.\d|,\d|\s*(?:years? (?:in|of|exp)|yrs? (?:in|of|exp)|months?|days?|hours?|mins?)))/i,
  /\b(1[0-7]|[5-9])\s*(?:y\/o|y\.o\.|yo|yrs?\s*old|years?\s*old|year[- ]old)\b/i,
];
const GRADE = [/\b(?:grade|gr\.?)\s*([4-9]|1[0-2])\b(?!\s*[a-f]\b)/i, /\b([4-9]|1[0-2])(?:st|nd|rd|th)\s*grade(?:r)?\b/i];
const SCHOOL = /\b(?:middle school|junior high|elementary school|(?:high school|hs)\s+(?:freshman|sophomore|junior|senior)|freshman|sophomore)\b/i;

export function youthSignals(text: string, now = new Date()): string[] {
  const t = text.slice(0, 20_000);
  const out: string[] = [];
  for (const re of AGE) { const m = t.match(re); if (m) { out.push(`says they are ${m[1]}`); break; } }
  for (const re of GRADE) { const m = t.match(re); if (m) { out.push(`mentions being in grade ${m[1]}`); break; } }
  const sc = t.match(SCHOOL); if (sc) out.push(`mentions ${sc[0].toLowerCase()}`);
  const born = t.match(/\b(?:born|b-?day|dob)\D{0,14}((?:19|20)\d{2})\b/i);
  if (born && Number(born[1]) >= now.getFullYear() - 17 && Number(born[1]) <= now.getFullYear()) out.push(`gives a birth year of ${born[1]}`);
  return out;
}

/** Findings that point from an online identity toward a real-world one. */
export const REAL_WORLD_TYPES = ['person', 'phone', 'email', 'location'] as const;
export const isRealWorld = (type: string) => (REAL_WORLD_TYPES as readonly string[]).includes(type);

export interface Care { youth: boolean; reasons: string[]; /** a person decided; automatic detection will not change it */ manual?: 'on' | 'off' }

export const CARE_GUIDANCE = [
  'Do not contact the account or anyone around it. Contact can alert an offender, tip off a bully, or put a child at risk.',
  'Preserve the evidence as it is (the signed evidence package is built for this) and do not keep digging toward a home, school or family.',
  'Report to the platform (Roblox and Discord both have safety report forms) and, if a child may be in danger, to the police or your country\'s child-protection line. In the US that is the NCMEC CyberTipline (report.cybertip.org).',
];
