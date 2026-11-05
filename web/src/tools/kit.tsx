import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Copy, Check, Plus } from 'lucide-react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import type { EntityType } from '@shared/types';
import type { Rgba } from '@shared/tools/pixels';

/** Small building blocks shared by every tool panel, so each panel is only its own logic. */

export function Field({ label, hint, children, grow }: { label: string; hint?: string; children: ReactNode; grow?: boolean }) {
  // the control inside gets the label as its accessible name too, so assistive tech and tests never depend on the wrapping
  const named = isValidElement(children) && ['input', 'textarea', 'select'].includes(String((children as ReactElement).type)) && !(children as ReactElement<any>).props['aria-label'] ? cloneElement(children as ReactElement<any>, { 'aria-label': label }) : children;
  return <label className="tl-field" style={grow ? { flex: 1, minWidth: 160 } : undefined}><span className="tl-label">{label}</span>{named}{hint && <span className="tl-hint">{hint}</span>}</label>;
}
export const Row = ({ children }: { children: ReactNode }) => <div className="tl-row">{children}</div>;

export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!shown.length) return null;
  return <dl className="tl-facts">{shown.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export function Notice({ level = 'info', children }: { level?: 'info' | 'notice' | 'warning' | 'good'; children: ReactNode }) {
  return <div className="tl-note" data-level={level}>{children}</div>;
}

export function Card({ title, sub, children, right }: { title?: ReactNode; sub?: ReactNode; children?: ReactNode; right?: ReactNode }) {
  return <section className="tl-card">{(title || right) && <header><div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>{right}</header>}{children}</section>;
}

export function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return <button className="btn sm ghost" onClick={() => { void navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}>{done ? <Check size={13} /> : <Copy size={13} />} {done ? 'Copied' : label}</button>;
}

/** Add something to the current case (starting one if there is none) without running lookups: the person decides what to search. */
export function useAdd() {
  const s = useStore();
  return async (type: EntityType, value: string): Promise<boolean> => {
    try {
      const r = await s.addKnown([{ type, value }], false);
      s.toast(r.added ? `Added ${value.length > 40 ? value.slice(0, 40) + '…' : value} to the case` : 'Already in the case');
      return true;
    } catch (e: any) { s.toast(e?.message ?? 'Could not add that'); return false; }
  };
}
export function AddBtn({ type, value, label = 'Add to case' }: { type: EntityType; value: string; label?: string }) {
  const add = useAdd(); const [done, setDone] = useState(false);
  return <button className="btn sm" disabled={done} onClick={async () => setDone(await add(type, value))}>{done ? <Check size={13} /> : <Plus size={13} />} {done ? 'Added' : label}</button>;
}

export const levelLabel = (c: number) => (c >= 0.85 ? 'very likely' : c >= 0.6 ? 'likely' : c >= 0.35 ? 'possible' : 'long shot');

/** "2019-03-04T10:00:00Z" → "Mar 4, 2019, 10:00 UTC (6 years ago)" */
export function when(iso: string, withAgo = true): string {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return iso;
  const s = d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
  if (!withAgo) return s;
  const days = (Date.now() - d.getTime()) / 86400000, a = Math.abs(days);
  const t = a < 1 ? 'today' : a < 60 ? `${Math.round(a)} days` : a < 730 ? `${Math.round(a / 30.4)} months` : `${(a / 365.25).toFixed(1)} years`;
  return `${s} (${t === 'today' ? t : days >= 0 ? `${t} ago` : `in ${t}`})`;
}

/** A local date-time string from <input type="datetime-local"> plus the UTC offset (in hours) it was written in, as UTC milliseconds. */
export function utcFrom(local: string, offsetHours: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local); if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - offsetHours * 3600000;
}
export const OffsetInput = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <Field label="UTC offset (hours)" hint="e.g. -8 for California in winter, 1 for Paris"><input className="field" inputMode="decimal" style={{ width: 90 }} value={value} onChange={(e) => onChange(e.target.value)} /></Field>
);

export function useBusy<T>() {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [data, setData] = useState<T | null>(null);
  const run = async (fn: () => Promise<T>) => { setBusy(true); setErr(''); try { setData(await fn()); } catch (e: any) { setErr(e?.message ?? String(e)); setData(null); } finally { setBusy(false); } };
  return { busy, err, data, run, setData };
}

// ---------------------------------------------------------------------------------------------------------------- pictures
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That file could not be read as a picture')); i.src = src; });
}
export const fileUrl = (f: Blob) => URL.createObjectURL(f);
export function pixelsOf(img: CanvasImageSource, w: number, h: number): Rgba {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h); return { data: d.data, width: w, height: h };
}
export const canvasBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the picture'))), type, q));

export function DropFile({ accept = 'image/*', label, onFile, multiple = false }: { accept?: string; label: string; onFile: (f: File) => void; multiple?: boolean }) {
  const ref = useRef<HTMLInputElement>(null); const [over, setOver] = useState(false);
  return (
    <div className="tl-drop" data-over={over} onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); [...e.dataTransfer.files].slice(0, multiple ? 20 : 1).forEach(onFile); }}>
      <input ref={ref} type="file" accept={accept} multiple={multiple} hidden onChange={(e) => { [...(e.target.files ?? [])].forEach(onFile); e.target.value = ''; }} />
      <button className="btn" onClick={() => ref.current?.click()}>{label}</button><span className="faint">or drop it here</span>
    </div>
  );
}

/** Paste a picture from the clipboard while a panel is open. */
export function usePasteImage(onFile: (f: File) => void) {
  useEffect(() => {
    const h = (e: ClipboardEvent) => { const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); e.stopPropagation(); onFile(f); } };
    window.addEventListener('paste', h, true); return () => window.removeEventListener('paste', h, true);
  });
}
