import { describe, it, expect } from 'vitest';
import { howFor, knownHowIds, extendHow } from '../server/adapters/how';
import { liveAdapters } from '../server/adapters/live/index';
import { demoAdapters, demoHow } from './world/demo';
import { derive } from '../server/adapters/derive';

extendHow(demoHow);

describe('every source says what it asked', () => {
  const all = [derive, ...demoAdapters, ...liveAdapters];
  it('has a plain-English "asked" line, mentioning the query, for every source and every input type it accepts', () => {
    for (const a of all) for (const t of a.accepts) {
      const how = howFor(a.id, t, 'QUERY-VALUE');
      expect(how, `${a.id} (${t}) has no "asked" line`).toBeTruthy();
      expect(how!, `${a.id} (${t})`).toContain('QUERY-VALUE');
      expect(how!.length, a.id).toBeLessThan(110);
      expect(how!).not.toMatch(/[{}]|undefined/);
    }
  });
  it('has no stale entries for sources that no longer exist', () => {
    const ids = new Set(all.map((a) => a.id));
    for (const id of knownHowIds()) expect(ids.has(id), `how.ts mentions unknown source ${id}`).toBe(true);
  });
  it('phrases email vs username lookups differently where the source behaves differently', () => {
    expect(howFor('github', 'email', 'a@b.example')).toMatch(/commits/);
    expect(howFor('github', 'username', 'torvalds')).toMatch(/profile named/);
  });
});

import { lookupUrl, knownLookupIds } from '../server/adapters/how';
import { safeHttpUrl } from '../shared/normalize';

describe('every real source can be checked by hand', () => {
  const OFFLINE = new Set(['derive', 'phone-offline', 'username-sweep']);
  const all = [derive, ...demoAdapters, ...liveAdapters];
  it('has a page to repeat the lookup for every live source and every input type it accepts', () => {
    for (const a of all) {
      if (a.demo || OFFLINE.has(a.id)) continue;
      for (const t of a.accepts) {
        const u = lookupUrl(a.id, t, 'QUERY.example');
        expect(u, `${a.id} (${t}) has no page to check`).toBeTruthy();
        expect(safeHttpUrl(u), `${a.id}: unsafe or malformed ${u}`).toBe(u);
      }
    }
  });
  it('simulated and offline sources deliberately have no link (nothing real to open)', () => {
    for (const a of demoAdapters) expect(lookupUrl(a.id, 'email', 'x@y.example')).toBeUndefined();
    expect(lookupUrl('derive', 'email', 'x@y.example')).toBeUndefined();
    expect(lookupUrl('phone-offline', 'phone', '+14155552671')).toBeUndefined();
  });
  it('puts the searched value in the page, correctly encoded', () => {
    expect(lookupUrl('crtsh', 'domain', 'example.com')).toBe('https://crt.sh/?q=%25.example.com');
    expect(lookupUrl('github', 'username', 'torvalds')).toBe('https://github.com/torvalds');
    expect(lookupUrl('github', 'email', 'a+b@x.example')).toContain('a%2Bb%40x.example');
    expect(lookupUrl('wayback', 'domain', 'www.example.com')).toBe('https://web.archive.org/web/*/example.com/*');
    expect(lookupUrl('gravatar', 'email', ' Jane@Roe.Example ')).toBe(lookupUrl('gravatar', 'email', 'jane@roe.example'));
    expect(lookupUrl('bluesky', 'username', 'jay')).toContain('jay.bsky.social');
  });
  it('has no stale entries', () => {
    const ids = new Set(all.map((a) => a.id));
    for (const id of knownLookupIds()) expect(ids.has(id), id).toBe(true);
  });
});
