import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { parseCoords, describePlace, mapLinks, haversineKm, bearingDeg, compass } from '@shared/forensics/geo';
import { allFormats, readCoordinates, travelCheck, destination } from '@shared/tools/coords';
import { elevationFromShadow, locateBySun, ringPoints, timesForElevation, maxElevation } from '@shared/tools/sunsolve';
import { daylightCheck } from '@shared/forensics/sun';
import type { WeatherAt } from '@shared/tools/weather';
import { Field, Row, Facts, Notice, Card, CopyBtn, OffsetInput, utcFrom, useBusy, when, AddBtn } from './kit';

const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
const nowLocal = () => new Date(Date.now() - 86400000).toISOString().slice(0, 16);
const hhmm = (ms: number, offsetH = 0) => new Date(ms + offsetH * 3600000).toISOString().slice(11, 16);

function PlaceInput({ value, onChange, label = 'Place' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const c = useMemo(() => readCoordinates(value, parseCoords)[0], [value]);
  return <Field label={label} hint={c ? `Read as ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)} · ${describePlace(c.lat, c.lon)}` : 'Coordinates in any format, a Plus Code, or a map link'} grow><input className="field" value={value} onChange={(e) => onChange(e.target.value)} placeholder="48.8584, 2.2945" /></Field>;
}
const place = (s: string) => readCoordinates(s, parseCoords)[0];

export function Coords() {
  const [text, setText] = useState('');
  const found = useMemo(() => readCoordinates(text, parseCoords), [text]);
  const [bearing, setBearing] = useState('90'), [km, setKm] = useState('10');
  const a = found[0], b = found[1];
  const dest = a && Number.isFinite(num(bearing)) && Number.isFinite(num(km)) ? destination(a.lat, a.lon, num(bearing), num(km)) : null;
  return (
    <div className="tl-stack">
      <Field label="Paste coordinates, a map link, or text that contains them" hint="Handles 37.7749, -122.4194 · 37°46′29.6″N 122°25′09.8″W · Plus Codes · Google/Apple/OSM links · video-file location tags"><textarea className="field" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="37°46'29.6&quot;N 122°25'09.8&quot;W" /></Field>
      {text.trim() && !a && <Notice level="notice">No coordinates found in that text.</Notice>}
      {found.map((c, i) => {
        const f = allFormats(c.lat, c.lon);
        return (
          <Card key={i} title={describePlace(c.lat, c.lon)} sub={`Found as ${c.kind}: ${c.raw.slice(0, 60)}`}>
            <Facts rows={[['Decimal', <>{f.decimal} <CopyBtn text={f.decimal} /></>], ['Degrees, minutes, seconds', <>{f.dms} <CopyBtn text={f.dms} /></>], ['Plus Code', <>{f.plusCode} <CopyBtn text={f.plusCode} /></>], ['Geohash', <>{f.geohash} <CopyBtn text={f.geohash} /></>], ['UTM', f.utm], ['ISO 6709 (video files)', f.iso6709]]} />
            <div className="tl-links">{mapLinks(c.lat, c.lon).map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer noopener">{l.label}</a>)}</div>
            <div className="tl-actions"><AddBtn type="location" value={`${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`} /></div>
          </Card>
        );
      })}
      {a && b && <Card title="Between the first two places"><Facts rows={[['Distance', `${haversineKm(a.lat, a.lon, b.lat, b.lon).toFixed(1)} km (${(haversineKm(a.lat, a.lon, b.lat, b.lon) * 0.621371).toFixed(1)} miles)`], ['Heading from first to second', `${Math.round(bearingDeg(a.lat, a.lon, b.lat, b.lon))}° (${compass(bearingDeg(a.lat, a.lon, b.lat, b.lon))})`]]} /></Card>}
      {a && <Card title="Where would you end up?" sub="From the first place, going in a straight line">
        <Row><Field label="Heading (°)"><input className="field" style={{ width: 90 }} value={bearing} onChange={(e) => setBearing(e.target.value)} /></Field><Field label="Distance (km)"><input className="field" style={{ width: 110 }} value={km} onChange={(e) => setKm(e.target.value)} /></Field></Row>
        {dest && <Facts rows={[['Lands at', `${dest.lat.toFixed(5)}, ${dest.lon.toFixed(5)} · ${describePlace(dest.lat, dest.lon)}`]]} />}
      </Card>}
    </div>
  );
}

export function SunShadow() {
  const [height, setHeight] = useState('1.8'), [shadow, setShadow] = useState('2.6'), [dir, setDir] = useState('');
  const [dt, setDt] = useState(nowLocal()), [off, setOff] = useState('0');
  const h = num(height), s = num(shadow), when_ = utcFrom(dt, num(off) || 0);
  const ok = h > 0 && s >= 0 && Number.isFinite(when_);
  const elev = ok ? elevationFromShadow(h, s) : NaN;
  const az = dir.trim() === '' ? undefined : (((num(dir) + 180) % 360) + 360) % 360;
  const res = useMemo(() => (ok && Number.isFinite(elev) ? locateBySun(when_, elev, az !== undefined && Number.isFinite(az) ? az : undefined) : null), [ok, elev, when_, az]);
  const ringPts = useMemo(() => (res ? ringPoints(res.ring, 24).map((p) => ({ ...p, name: describePlace(p.lat, p.lon) })) : []), [res]);
  return (
    <div className="tl-stack">
      <Notice>A shadow gives the sun's height. The date and time say where the sun was over the Earth. Together they narrow down where on Earth the picture was taken. Add the direction the shadow points and it narrows to a spot. Needs a clear shadow on level ground and a trustworthy time.</Notice>
      <Row><Field label="Object height" hint="any unit"><input className="field" style={{ width: 100 }} value={height} onChange={(e) => setHeight(e.target.value)} /></Field><Field label="Shadow length" hint="same unit"><input className="field" style={{ width: 100 }} value={shadow} onChange={(e) => setShadow(e.target.value)} /></Field><Field label="Shadow points toward (° compass)" hint="0 = north, 90 = east. Optional but powerful"><input className="field" style={{ width: 150 }} value={dir} onChange={(e) => setDir(e.target.value)} /></Field></Row>
      <Row><Field label="Date and time of the photo"><input className="field" type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)} /></Field><OffsetInput value={off} onChange={setOff} /></Row>
      {res && ok && (
        <Card title={`The sun was ${elev.toFixed(1)}° above the horizon`} sub={az !== undefined ? `and in the ${compass(az)} (${Math.round(az)}°)` : undefined}>
          {res.points.length ? <>
            <p className="tl-p">With the shadow direction, the sun's position points to {res.points.length === 1 ? 'one place' : `${res.points.length} places`}:</p>
            {res.points.map((p, i) => <Facts key={i} rows={[['Place', `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)} · ${describePlace(p.lat, p.lon)}`], ['Fit', `off by ${p.elevationErr.toFixed(2)}° in height and ${p.azimuthErr.toFixed(1)}° in direction`]]} />)}
            <div className="tl-links">{mapLinks(res.points[0].lat, res.points[0].lon).slice(0, 3).map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer noopener">{l.label}</a>)}</div>
          </> : <>
            <p className="tl-p">{az !== undefined ? 'No spot fits both the height and the direction. Re-check the time, the offset and the direction.' : `It could be anywhere on a circle ${Math.round(res.ring.radiusKm).toLocaleString('en-US')} km from ${res.ring.center.lat.toFixed(1)}, ${res.ring.center.lon.toFixed(1)} (where the sun was straight overhead).`}</p>
            {az === undefined && <><p className="tl-p"><b>Places on that circle</b> (24 evenly spaced). Rule out the ones that cannot match the scenery:</p><ul className="tl-list">{ringPts.map((p, i) => <li key={i}>{p.name} <span className="faint">{p.lat.toFixed(1)}, {p.lon.toFixed(1)}</span></li>)}</ul></>}
          </>}
          {elev <= 0 && <Notice level="notice">A shadow that long means the sun was at or below the horizon, so the result is unreliable.</Notice>}
        </Card>
      )}
      {res && <Notice level="notice">Accuracy: the sun's position is exact to about 0.1°, but measuring a shadow from a photo is rough: a 2° error in sun height moves the circle by about 220 km.</Notice>}
    </div>
  );
}

export function ShadowClock() {
  const [pl, setPl] = useState(''), [height, setHeight] = useState('1.8'), [shadow, setShadow] = useState('2.6');
  const [date, setDate] = useState(new Date(Date.now() - 86400000).toISOString().slice(0, 10)), [off, setOff] = useState('0');
  const p = place(pl), elev = elevationFromShadow(num(height), num(shadow));
  const day = Date.parse(date + 'T00:00:00Z');
  const hits = p && Number.isFinite(elev) && Number.isFinite(day) ? timesForElevation(p.lat, p.lon, day, elev) : [];
  const peak = p && Number.isFinite(day) ? maxElevation(p.lat, p.lon, day) : null;
  const o = num(off) || 0;
  return (
    <div className="tl-stack">
      <Notice>If you know where a photo was taken and on what day, the length of a shadow tells you what time of day it was. This is the reverse of the shadow locator.</Notice>
      <PlaceInput value={pl} onChange={setPl} />
      <Row><Field label="Date (local)"><input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field><Field label="Object height"><input className="field" style={{ width: 100 }} value={height} onChange={(e) => setHeight(e.target.value)} /></Field><Field label="Shadow length"><input className="field" style={{ width: 100 }} value={shadow} onChange={(e) => setShadow(e.target.value)} /></Field><OffsetInput value={off} onChange={setOff} /></Row>
      {p && Number.isFinite(elev) && (
        <Card title={hits.length ? 'The shadow matches these times' : 'That shadow never happens there on that day'} sub={`Sun height ${elev.toFixed(1)}°${peak ? `. The sun's highest that day: ${peak.elevation.toFixed(1)}° at ${hhmm(Date.parse(peak.utc), o)} local.` : ''}`}>
          {hits.map((h, i) => <Facts key={i} rows={[[h.side === 'morning' ? 'Morning' : 'Afternoon', `${hhmm(h.ms, o)} local time (${hhmm(h.ms)} UTC)`], ['Shadow pointing', `${compass((h.azimuth + 180) % 360)} (${Math.round((h.azimuth + 180) % 360)}°)`]]} />)}
          {hits.length === 2 && <p className="tl-p">The direction the shadow points tells morning from afternoon: in the northern hemisphere a morning shadow points west and an afternoon one points east.</p>}
          {!hits.length && peak && <Notice level="warning">{elev > peak.elevation ? 'The shadow is shorter than the sun ever makes there that day. Either the place, the date or the measurement is wrong.' : 'The sun was never that low that day (polar day/night).'}</Notice>}
        </Card>
      )}
    </div>
  );
}

export function Travel() {
  const [a, setA] = useState(''), [b, setB] = useState(''), [ta, setTa] = useState(nowLocal()), [tb, setTb] = useState(nowLocal()), [oa, setOa] = useState('0'), [ob, setOb] = useState('0');
  const pa = place(a), pb = place(b), ma = utcFrom(ta, num(oa) || 0), mb = utcFrom(tb, num(ob) || 0);
  const r = pa && pb && Number.isFinite(ma) && Number.isFinite(mb) ? travelCheck({ ...pa, t: ma }, { ...pb, t: mb }) : null;
  return (
    <div className="tl-stack">
      <Notice>Two sightings of the same person (a post, a photo, a login) at two places and times. Could one person have been at both? Useful for alibis, for spotting two people behind one account, and for catching a wrong timezone.</Notice>
      <Card title="First sighting"><PlaceInput value={a} onChange={setA} /><Row><Field label="Date and time"><input className="field" type="datetime-local" value={ta} onChange={(e) => setTa(e.target.value)} /></Field><OffsetInput value={oa} onChange={setOa} /></Row></Card>
      <Card title="Second sighting"><PlaceInput value={b} onChange={setB} /><Row><Field label="Date and time"><input className="field" type="datetime-local" value={tb} onChange={(e) => setTb(e.target.value)} /></Field><OffsetInput value={ob} onChange={setOb} /></Row></Card>
      {r && <Card title={{ impossible: 'Not possible for one person', 'flight-needed': 'Only by plane', 'drive-or-fast-train': 'A hard drive or a train', easy: 'Easily possible' }[r.verdict]}>
        <Notice level={r.verdict === 'impossible' ? 'warning' : r.verdict === 'easy' ? 'good' : 'notice'}>{r.note}</Notice>
        <Facts rows={[['Distance', `${Math.round(r.km).toLocaleString('en-US')} km (${Math.round(r.km * 0.621371).toLocaleString('en-US')} miles)`], ['Time between', r.hours < 1 ? `${Math.round(r.hours * 60)} minutes` : `${r.hours.toFixed(1)} hours`], ['Average speed needed', Number.isFinite(r.kmh) ? `${Math.round(r.kmh)} km/h` : 'instant'], ['Direction of travel', `${r.heading} (${Math.round(r.bearing)}°)`]]} />
      </Card>}
    </div>
  );
}

export function Daylight() {
  const [pl, setPl] = useState(''), [dt, setDt] = useState(nowLocal()), [off, setOff] = useState('0');
  const p = place(pl), t = utcFrom(dt, num(off) || 0);
  const r = p && Number.isFinite(t) ? daylightCheck(t, p.lat, p.lon) : null;
  const day = Number.isFinite(t) ? Math.floor(t / 86400000) * 86400000 : NaN;
  const rise = p && Number.isFinite(day) ? timesForElevation(p.lat, p.lon, day, -0.833) : [];
  const o = num(off) || 0;
  return (
    <div className="tl-stack">
      <Notice>Was it light or dark at that place and time? A photo stamped "3 pm" with a night sky, or a "midnight" post with bright sun behind the poster, means the clock, the timezone or the place is wrong.</Notice>
      <PlaceInput value={pl} onChange={setPl} />
      <Row><Field label="Date and time"><input className="field" type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)} /></Field><OffsetInput value={off} onChange={setOff} /></Row>
      {r && p && <Card title={{ day: 'Daylight', golden: 'Sunrise or sunset', twilight: 'Twilight', night: 'Night' }[r.phase]} sub={r.note}>
        <Facts rows={[['Sun height', `${r.elevation.toFixed(1)}°`], ['Sun direction', `${compass(r.azimuth)} (${Math.round(r.azimuth)}°)`], ['Sunrise', rise.find((x) => x.side === 'morning') ? `${hhmm(rise.find((x) => x.side === 'morning')!.ms, o)} local` : 'none that day'], ['Sunset', rise.find((x) => x.side === 'afternoon') ? `${hhmm(rise.find((x) => x.side === 'afternoon')!.ms, o)} local` : 'none that day'], ['Shadows should point', r.elevation > 0 ? `${compass((r.azimuth + 180) % 360)}, ${r.elevation > 45 ? 'short' : r.elevation > 20 ? 'medium' : 'long'}` : 'nowhere: there is no direct sun']]} />
      </Card>}
    </div>
  );
}

export function Weather() {
  const [pl, setPl] = useState(''), [dt, setDt] = useState(nowLocal()), [off, setOff] = useState('0');
  const p = place(pl), t = utcFrom(dt, num(off) || 0);
  const { busy, err, data, run } = useBusy<{ weather: WeatherAt | null }>();
  const w = data?.weather;
  const go = () => run(() => api.post('/api/tools/weather', { lat: p!.lat, lon: p!.lon, iso: new Date(t).toISOString() }));
  return (
    <div className="tl-stack">
      <Notice>What was the weather at that place and hour? Compare it with the picture: rain on the ground, snow, fog, a clear blue sky. A mismatch means the date or the place is wrong. Uses the free Open-Meteo archive (hourly, back to 1940).</Notice>
      <PlaceInput value={pl} onChange={setPl} />
      <Row><Field label="Date and time"><input className="field" type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)} /></Field><OffsetInput value={off} onChange={setOff} /></Row>
      <div className="tl-actions"><button className="btn primary" disabled={!p || !Number.isFinite(t) || busy} onClick={go}>{busy ? 'Looking up…' : 'Look up the weather'}</button></div>
      {err && <Notice level="warning">{err}</Notice>}
      {data && !w && <Notice level="notice">No weather record for that hour (too recent, or outside the data).</Notice>}
      {w && <Card title={`${w.description[0].toUpperCase()}${w.description.slice(1)}${w.tempC !== undefined ? `, ${w.tempC.toFixed(0)}°C (${(w.tempC * 1.8 + 32).toFixed(0)}°F)` : ''}`} sub={`Hour of ${when(w.iso, false)}`}>
        <Facts rows={[['Rain / snow in that hour', w.precipMm !== undefined ? `${w.precipMm} mm` : ''], ['Cloud cover', w.cloudPct !== undefined ? `${w.cloudPct}%` : ''], ['Wind', w.windKmh !== undefined ? `${w.windKmh} km/h` : ''], ['Visibility', w.visibilityKm !== undefined ? `${w.visibilityKm.toFixed(1)} km` : ''], ['Sun up?', w.isDay === undefined ? '' : w.isDay ? 'Yes' : 'No (night)'], ['Sunrise / sunset (UTC)', w.sunrise && w.sunset ? `${w.sunrise.slice(11)} / ${w.sunset.slice(11)}` : '']]} />
        <p className="tl-p">A picture from then should show <b>{w.consistentWith}</b>.</p>
      </Card>}
    </div>
  );
}
