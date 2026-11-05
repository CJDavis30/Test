import { fmtOffset, regionOf, type Circadian } from '@shared/forensics/circadian';
import type { DstResult } from '@shared/forensics/dst';

/**
 * A 24-hour clock of when someone is active (UTC), with the hours that are night at the most likely timezone shaded so you can see
 * for yourself whether the quiet stretch lines up with it. Below it, the timezones in order of likelihood.
 */
export function ActivityClock({ c, size = 232, compact = false, dst, mini = false }: { c: Circadian; size?: number; compact?: boolean; dst?: DstResult | null; mini?: boolean }) {
  const cx = size / 2, cy = size / 2, r0 = size * 0.2, rMax = size * 0.46;
  const max = Math.max(1, ...c.histogram);
  const ang = (h: number) => ((h / 24) * 2 - 0.5 + 0.0) * Math.PI; // 00:00 UTC at the top, clockwise
  const pt = (h: number, r: number) => [cx + r * Math.cos(ang(h)), cy + r * Math.sin(ang(h))] as const;
  const arc = (h0: number, h1: number, r: number) => { const [x0, y0] = pt(h0, r), [x1, y1] = pt(h1, r); const sweep = (h1 - h0 + 24) % 24; return `M${x0},${y0} A${r},${r} 0 ${sweep > 12 ? 1 : 0} 1 ${x1},${y1}`; };
  const sure = c.strength !== 'insufficient';
  // local night (23:00-07:00) expressed in UTC hours, at the most likely offset
  const nightStart = (((23 - c.best.offset) % 24) + 24) % 24, nightEnd = (((7 - c.best.offset) % 24) + 24) % 24;
  const wedge = (h0: number, h1: number, ra: number, rb: number) => { const [a, b] = [pt(h0, rb), pt(h1, rb)], [d, e] = [pt(h1, ra), pt(h0, ra)]; const large = (h1 - h0 + 24) % 24 > 12 ? 1 : 0; return `M${a[0]},${a[1]} A${rb},${rb} 0 ${large} 1 ${b[0]},${b[1]} L${d[0]},${d[1]} A${ra},${ra} 0 ${large} 0 ${e[0]},${e[1]} Z`; };
  return (
    <div className="aclock">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`Activity by hour of day in UTC. ${c.summary}`}>
        <circle cx={cx} cy={cy} r={rMax + 6} className="ac-ring" />
        {sure && <path d={wedge(nightStart, nightEnd, r0 - 2, rMax + 4)} className="ac-night" />}
        {c.histogram.map((v, h) => {
          const [x0, y0] = pt(h + 0.5, r0), [x1, y1] = pt(h + 0.5, r0 + (rMax - r0) * (v / max));
          return <line key={h} x1={x0} y1={y0} x2={x1} y2={y1} className="ac-bar" strokeWidth={Math.max(2, size * 0.017)} strokeLinecap="round" opacity={v ? 1 : 0.18} />;
        })}
        {c.sleepUtc && <path d={arc(c.sleepUtc[0], c.sleepUtc[1] === 0 ? 24 : c.sleepUtc[1], r0 - 7)} className="ac-sleep" />}
        {[0, 6, 12, 18].map((h) => { const [x, y] = pt(h, rMax + 17); return <text key={h} x={x} y={y} className="ac-lab" textAnchor="middle" dominantBaseline="middle">{String(h).padStart(2, '0')}</text>; })}
        <text x={cx} y={cy - 5} className="ac-mid" textAnchor="middle">{sure ? fmtOffset(c.best.offset) : '?'}</text>
        <text x={cx} y={cy + 11} className="ac-sub" textAnchor="middle">{sure ? `${Math.round(c.best.p * 100)}%` : 'too few'}</text>
      </svg>
      {!mini && <div className="ac-side">
        <div className="ac-sum">{c.summary}</div>
        {sure && !compact && (
          <div className="ac-offs" role="list" aria-label="Timezones in order of likelihood">
            {c.offsets.slice(0, 4).map((o) => (
              <div key={o.offset} className="ac-off" role="listitem"><span className="num">{fmtOffset(o.offset)}</span><span className="ac-reg truncate">{regionOf(o.offset)}</span><span className="ac-bar2"><i style={{ width: `${o.p * 100}%` }} /></span><span className="num ac-p">{Math.round(o.p * 100)}%</span></div>
            ))}
          </div>
        )}
        {dst && dst.strength !== 'insufficient' && <div className="ac-dst"><b>Clocks:</b> {dst.summary}</div>}
        <div className="ac-foot">{c.n} timestamps · {c.sessions} separate sittings · hours shown in UTC{sure ? '; shaded = night at the best-fit timezone' : ''}</div>
      </div>}
    </div>
  );
}
