import { useState } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { ORIGINS, PLATFORMS, TRUSTS, cleanRole, describeRole, originLabel, platformByKey, platformName, type HandleKind, type HandleRole, type OriginKey, type Trust } from '@shared/handles';

/** What the person typed into the picker. `platform` is a PLATFORMS key, '' (not sure) or '__other' with the name in `other`. */
export interface RoleDraft { platform: string; other: string; kind: HandleKind; alt: boolean; origin: OriginKey | ''; note: string; trust: Trust }
export const emptyDraft = (trust: Trust = 'probable'): RoleDraft => ({ platform: '', other: '', kind: 'username', alt: false, origin: '', note: '', trust });
export const draftOf = (r?: HandleRole): RoleDraft => {
  if (!r) return emptyDraft();
  const known = !!platformByKey(r.platform);
  return { platform: r.platform ? (known ? r.platform : '__other') : '', other: !known && r.platform ? r.platform : '', kind: r.kind, alt: !!r.alt, origin: r.origin ?? '', note: r.originNote ?? '', trust: r.trust };
};
/** The role this draft describes, or undefined when nothing has been said (so the handle stays "platform not specified"). */
export function roleOfDraft(d: RoleDraft): HandleRole | undefined {
  const platform = d.platform === '__other' ? d.other.trim() : d.platform;
  const said = !!platform || d.alt || !!d.origin || !!d.note.trim() || d.kind === 'display-name' || d.trust !== 'probable';
  if (!said) return undefined;
  return cleanRole({ platform, kind: d.kind, alt: d.alt, origin: d.origin || undefined, originNote: d.note, trust: d.trust });
}

const POPULAR = ['roblox', 'discord', 'steam', 'xbox', 'playstation', 'minecraft', 'x', 'instagram', 'tiktok', 'youtube', 'twitch', 'reddit', 'snapchat', 'github', 'telegram'];

/** One sentence on what Plexus will do differently, so the choice is never a mystery. */
export function effectOf(d: RoleDraft): string {
  const p = d.platform === '__other' ? d.other.trim() : platformByKey(d.platform)?.name;
  const def = platformByKey(d.platform);
  if (d.kind === 'display-name') return `A display name is not unique, so Plexus will not search the internet for it. It keeps it as a clue: any profile it finds whose display name matches counts a little in favour. You can still search it later.`;
  if (!p) return 'Without knowing which service this is for, every result is only "someone with the same name" and is shown separately, capped low. Say which service it is for far better results.';
  if (def?.families.length) return `Plexus will look this up on ${p} itself (that account is the one you named), read its bio and the links it lists, and follow what it says about itself. The same name on other sites is shown separately as "same name only", because most of those are strangers.`;
  return `Plexus cannot read ${p} without an account, so this is kept as a clue to recognise other profiles by (a bio that mentions it, a link to it). The same name on other sites is shown separately as "same name only".`;
}

export function RolePicker({ value, onChange, subject }: { value: RoleDraft; onChange: (d: RoleDraft) => void; subject?: string }) {
  const set = (p: Partial<RoleDraft>) => onChange({ ...value, ...p });
  return (
    <div className="rp" role="group" aria-label="What this username is">
      <div className="rp-q">{subject ? <>Whose username is <b>{subject}</b>?</> : 'Which service is this username for?'}</div>
      <div className="rp-chips" role="radiogroup" aria-label="Service">
        {POPULAR.map((k) => <button key={k} type="button" role="radio" aria-checked={value.platform === k} className="rp-chip" data-on={value.platform === k} onClick={() => set({ platform: value.platform === k ? '' : k })}>{platformByKey(k)!.name}</button>)}
        <button type="button" role="radio" aria-checked={value.platform === '__other'} className="rp-chip" data-on={value.platform === '__other'} onClick={() => set({ platform: value.platform === '__other' ? '' : '__other' })}>Other…</button>
        <button type="button" role="radio" aria-checked={value.platform === ''} className="rp-chip quiet" data-on={value.platform === ''} onClick={() => set({ platform: '', other: '' })}>Not sure</button>
      </div>
      {value.platform === '__other' && <input className="field rp-other" aria-label="Name of the service" placeholder="Name of the service or game" value={value.other} onChange={(e) => set({ other: e.target.value })} />}

      <div className="rp-row">
        <div className="rp-seg" role="radiogroup" aria-label="Kind of name">
          <button type="button" role="radio" aria-checked={value.kind === 'username'} data-on={value.kind === 'username'} onClick={() => set({ kind: 'username' })}>Username</button>
          <button type="button" role="radio" aria-checked={value.kind === 'display-name'} data-on={value.kind === 'display-name'} onClick={() => set({ kind: 'display-name' })}>Display name</button>
        </div>
        <label className="rp-check"><input type="checkbox" checked={value.alt} onChange={(e) => set({ alt: e.target.checked })} /> An alt account</label>
      </div>

      <div className="rp-row">
        <label className="rp-field"><span>Where did you get it?</span>
          <select className="field" aria-label="Where did you get it" value={value.origin} onChange={(e) => set({ origin: e.target.value as OriginKey | '' })}>
            <option value="">Not recorded</option>
            {ORIGINS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <label className="rp-field grow"><span>Details (optional)</span>
          <input className="field" aria-label="Details about where it came from" placeholder="e.g. from the Discord profile a friend sent" value={value.note} onChange={(e) => set({ note: e.target.value })} />
        </label>
      </div>

      <div className="rp-q small">How sure are you it is theirs? Anything can be a lie, so Plexus counts a shaky handle for less.</div>
      <div className="rp-chips" role="radiogroup" aria-label="How sure">
        {TRUSTS.map((t) => <button key={t.key} type="button" role="radio" aria-checked={value.trust === t.key} className="rp-chip" data-on={value.trust === t.key} onClick={() => set({ trust: t.key })}>{t.label}</button>)}
      </div>
      <p className="rp-effect"><Info size={13} />{effectOf(value)}</p>
    </div>
  );
}

/** A collapsible RolePicker with a one-line summary, for crowded places (a row in a list, a search bar). */
export function RoleSummary({ value, onChange, subject, startOpen = false }: { value: RoleDraft; onChange: (d: RoleDraft) => void; subject?: string; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const role = roleOfDraft(value);
  const said = !!role;
  return (
    <div className="rp-wrap" data-said={said}>
      <button type="button" className="rp-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="rp-sum">{said ? <><b>{describeRole(role)}</b> · {({ certain: 'sure it is theirs', probable: 'probably theirs', unsure: 'not sure' } as const)[value.trust]}{value.origin ? ` · from ${originLabel(value.origin).toLowerCase()}` : ''}</> : <>Which service is this for? <i>Tell Plexus for far better results</i></>}</span>
      </button>
      {open && <RolePicker value={value} onChange={onChange} subject={subject} />}
    </div>
  );
}

export { platformName };
