import type { EntityType, Level } from './types';

/**
 * Turns the engine's terse internals (relation labels, scores, evidence weights) into plain English.
 * `{s}` is the thing the investigator searched for, `{f}` is the thing that was found.
 */
const T: Record<string, string> = {
  // identity
  'belongs to': '{f} appears to own {s}.',
  'belonged to': '{f} used to own {s}.',
  'work email': '{f} is {s}’s work email address.',
  'personal email': '{f} is {s}’s personal email address.',
  'side-project email': '{f} is the email {s} uses for a side project.',
  'email': '{f} is an email address linked to {s}.',
  'possible email': '{f} might be an email address of {s} (not confirmed).',
  'email of': '{s} is an email address of {f}.',
  'staff email': '{s} is a staff email address at {f}.',
  'phone': '{f} is a phone number for {s}.',
  'former phone': '{f} used to be {s}’s phone number.',
  'username': '{s} also uses the username “{f}”.',
  'used by': '{s} is a username used by {f}.',
  'possible handle': '“{f}” might be a username used by {s}. It only matches the first part of the email address, which is a weak hint.',
  'similar handle': '“{f}” is a similar username that may belong to the same person as {s}.',
  'same handle exists': 'The username in {s} is also registered on {f}. That alone does not prove it is the same person.',
  'handle': '{s} is the username on {f}.',
  'profile photo': '{f} is {s}’s profile photo.',
  'avatar': '{f} is the profile picture used with {s}.',
  'photo of': '{s} is the profile photo of {f}.',
  'avatar for': '{s} is the profile picture used with {f}.',
  'also known as': '{f} looks like another way {s} appears online.',
  'appears as': '{s} shows up under the name {f}.',
  'possible namesake': '{f} has a very similar name to {s}, but may be a different person.',
  'possible public-figure match': '{s} has the same name as a notable public figure. That is likely a coincidence.',
  'name on profile': '{f} is the name shown on {s}’s public profile.',
  'display name': '{f} is the display name on {s}’s profile.',
  'commit author name': '{f} is the name used when {s} was used to publish code.',
  'commits as': '{f} is the code account that publishes under {s}.',
  // accounts
  'profile': '{f} is a profile page for {s}.',
  'account': '{f} is an account that belongs to {s}.',
  'owner': '{s} is an account that belongs to {f}.',
  'linked account': '{f} is linked from {s}’s profile.',
  'cryptographically proven account': '{f} is proven to belong to {s} with a digital signature (very strong).',
  'registered with this email': '{s} has an account on {f}.',
  'profile with this public email': '{f} is a profile that publicly lists {s}.',
  'public email': '{f} is the email address shown publicly on {s}’s profile.',
  'website on profile': '{f} is the website listed on {s}’s profile.',
  'website': '{f} is {s}’s website.',
  'owned by': '{s} is owned by {f}.',
  'GitHub profile': '{f} is {s}’s GitHub page.', 'GitLab profile': '{f} is {s}’s GitLab page.', 'Bluesky profile': '{f} is {s}’s Bluesky page.',
  'Hacker News profile': '{f} is {s}’s Hacker News page.', 'DEV profile': '{f} is {s}’s DEV page.', 'Keybase profile': '{f} is {s}’s Keybase page.',
  'Reddit profile': '{f} is a Reddit account with the same username as {s}.', 'Gravatar profile': '{f} is the Gravatar profile registered with {s}.',
  // work & places
  'works at': '{s} works at {f}.',
  'employee': '{f} works at {s}.',
  'employer': '{f} appears to be {s}’s employer (based on the company email address).',
  'previously at': '{s} used to work at {f}.',
  'former employee': '{f} used to work at {s}.',
  'founder of': '{s} founded {f}.',
  'founder': '{f} founded {s}.',
  'officer': '{f} is an officer of {s}.',
  'officer of': '{s} is an officer of {f}.',
  'co-worker': '{f} works with {s}.',
  'colleague': '{f} works with {s}.',
  'staff handle': '{s} is a username used by someone at {f}.',
  'company on profile': '{f} is the company listed on {s}’s profile.',
  'organization': '{f} is the organization behind {s}.',
  'based in': '{s} appears to be based in {f}.',
  'resident': '{f} appears to be based in {s}.',
  'likely location': '{s} is probably around {f} (weak hint).',
  'seen here': '{s} has been seen in {f}.',
  'location on profile': '{s} says on a public profile that they are in {f}.',
  'headquarters': '{f} is where {s} is headquartered.',
  'headquarters of': '{s} is where {f} is headquartered.',
  'registered address': '{f} is the official registered address of {s}.',
  'registered address of': '{s} is the official registered address of {f}.',
  'registered legal entity': '{f} is the official legal record for {s}.',
  'registered in': '{s} is registered in {f}.',
  'number registered in': 'The phone number {s} was issued in {f}.',
  // infrastructure
  'subdomain': '{f} is a subdomain of {s}.',
  'subdomain of': '{s} is a subdomain of {f}.',
  'parent domain': '{f} is the main domain that {s} belongs to.',
  'resolves to': 'The address {s} points to {f}.',
  'resolved to (historic)': '{s} used to point to {f}.',
  'hosts': '{s} hosts {f}.',
  'hosted on this IP': '{f} is hosted at {s}.',
  'seen on this IP': '{f} was seen running at {s}.',
  'served from': '{s} is served from {f}.',
  'hosted on': '{s} is hosted on {f}.',
  'hostname': '{f} is a hostname for {s}.',
  'reverse DNS': '{f} is the name registered for {s}.',
  'mail handled by': 'Email for {s} is handled by {f}.',
  'mailbox at': '{s} is a mailbox on {f}.',
  'nameserver': '{f} runs the DNS (address lookup) for {s}.',
  'sends mail via (SPF)': '{s} is allowed to send email through {f}.',
  'uses service': '{s} uses {f}.',
  'registrar': '{f} is the company {s} was registered through.',
  'registrar of': '{s} is the company that registered {f}.',
  'registrant': '{f} registered {s}.',
  'registrant of': '{s} registered {f}.',
  'registrant contact': '{f} is the contact email {s}’s owner gave when registering it.',
  'registration record': '{f} is the official registration record for {s}.',
  'archived page': '{f} is an archived page from {s}.',
  'page on': '{s} is an archived page from {f}.',
  'scanned page': '{f} is a page on {s} that was seen by a public web scanner.',
  'network owner': '{f} owns the network that {s} belongs to.',
  'operates': '{s} runs the network {f}.',
  'network operator': '{f} runs the network that {s} is on.',
  'operator domain': '{f} is the website of the company that runs {s}.',
  'geolocated to': '{s} appears to be located in {f} (approximate; usually the hosting company, not a person).',
  'open ports': '{s} has network services open to the internet.',
  'possible vulnerability': '{s} may be affected by {f} (guessed from its software version; could be a false alarm).',
  // leaks, money
  'appeared in': '{s} was exposed in the {f} data breach.',
  'exposed': '{f} was exposed in the {s} data breach.',
  'payment address': '{f} is a crypto wallet {s} has shared publicly.',
  'on-chain activity': '{f} shows the public transaction history of {s}.',
  'spent together with': '{f} was used in the same transactions as {s}, so they probably have the same owner.',
  'organization (hunter)': '{f} is the company behind {s}.',
  'email at this domain': '{f} is an email address at {s}.',
  'works at this domain': '{f} works at {s}.',
};

const BIO = /^(listed in|link in) (.+) bio$/i;
const NOUN: Record<EntityType, string> = {
  person: 'this person', email: 'this email', phone: 'this phone number', username: 'this username', domain: 'this domain', ip: 'this IP address',
  url: 'this page', org: 'this organization', location: 'this place', account: 'this account', image: 'this image', wallet: 'this wallet', breach: 'this breach',
};
export const subjectNoun = (t: EntityType) => NOUN[t];

/** One plain-English sentence for "how does this finding relate to what I searched?". */
export function explainRelation(relation: string, subject: string, found: string): string {
  let t = T[relation];
  if (!t) {
    const m = relation.match(BIO);
    if (m) t = m[1].toLowerCase() === 'listed in' ? `{f} is listed in {s}’s ${m[2]} bio.` : `{f} is linked from {s}’s ${m[2]} bio.`;
  }
  const text = t ?? `{f} is connected to {s} (${relation}).`;
  // Sentences that start with a value (an email, a domain…) keep it exactly as written; only literal text is capitalised.
  const out = text.replace(/\{s\}/g, subject).replace(/\{f\}/g, found);
  return /^this /.test(out) ? out.charAt(0).toUpperCase() + out.slice(1) : out;
}

export function confidenceSentence(level: Level, independent: number): string {
  const n = `${independent} separate sources`;
  switch (level) {
    case 4: return independent > 1 ? `${n} agree.` : 'One high-trust source says so.';
    case 3: return independent > 1 ? `${n} agree, but it isn’t certain.` : 'One good source says so.';
    case 2: return independent > 1 ? `${n} mention it.` : 'Only one source mentions it. Worth checking.';
    default: return 'Thin evidence. Probably noise unless you can confirm it.';
  }
}

const CAUTION: [RegExp, string][] = [
  [/namesake/i, 'Same name does not mean same person.'],
  [/public-figure/i, 'Probably a coincidence: a famous person with a similar name.'],
  [/same handle exists/i, 'A taken username is not proof it is the same person.'],
  [/possible handle|similar handle|possible email/i, 'A guess from patterns, not a confirmed link.'],
  [/geolocated|registered in|number registered/i, 'Approximate: this shows where a service or number is registered, not where a person is.'],
  [/possible vulnerability/i, 'Guessed from software versions; may be a false alarm.'],
];

/** Phones, places and jobs change. A claim last reported years ago may simply be out of date, which is different from being wrong. */
export function staleness(f: { type?: string; relation?: string; when?: string }, now = Date.now()): string | null {
  if (!f.when || !['phone', 'location', 'org', 'email'].includes(f.type ?? '')) return null;
  const t = Date.parse(f.when); if (!Number.isFinite(t)) return null;
  const years = (now - t) / (365.25 * 86_400_000);
  if (years < 2) return null;
  const noun = f.type === 'phone' ? 'phone numbers' : f.type === 'location' ? 'addresses' : f.type === 'email' ? 'email addresses' : 'jobs';
  return `Last reported ${f.when.slice(0, 4)}, about ${Math.floor(years)} years ago. ${noun[0].toUpperCase()}${noun.slice(1)} change, so this may be out of date rather than wrong.`;
}

/** Only the things worth pausing on, as short lines. Praise is not a warning, so agreement is not listed here. */
export function warningsFor(f: { relation: string; level: Level; evidence: { family: string; polarity?: 'for' | 'against' }[]; reasons: string[]; type?: string; when?: string }, now = Date.now()): string[] {
  const out: string[] = [];
  const stale = staleness(f, now); if (stale) out.push(stale);
  const independent = new Set(f.evidence.filter((e) => e.polarity !== 'against').map((e) => e.family)).size;
  const against = f.evidence.filter((e) => e.polarity === 'against').length;
  if (against) out.push(`${against} cross-check${against > 1 ? 's' : ''} contradict${against > 1 ? '' : 's'} it. See the cards marked in red.`);
  if (independent === 1 && f.level <= 3) out.push('Only one source backs this.');
  for (const [re, msg] of CAUTION) if (re.test(f.relation)) out.push(msg);
  return out;
}

/** Evidence weight (claim strength × how much we trust the source) in words. */
export function evidenceStrength(weight: number, trust = 1): { label: string; level: Level } {
  const v = weight * trust;
  return v >= 0.75 ? { label: 'Strong evidence', level: 4 } : v >= 0.55 ? { label: 'Good evidence', level: 3 } : v >= 0.35 ? { label: 'Fair evidence', level: 2 } : { label: 'Weak evidence', level: 1 };
}

/**
 * A sentence stated as fact must be backed like one. Weak or contradicted findings are prefixed so the wording never claims more than the evidence does.
 */
export function hedge(sentence: string, level: Level, contradicted: boolean): string {
  if (contradicted) return `Disputed. ${sentence}`;
  if (level <= 2) return `Unconfirmed. ${sentence}`;
  return sentence;
}
