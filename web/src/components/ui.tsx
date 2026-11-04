import { useEffect, useRef, type ReactNode } from 'react';
import { LEVEL_LABEL, type Level } from '@shared/types';

export function Dots({ level, label = false }: { level: Level; label?: boolean }) {
  const c = `var(--lvl${level})`;
  return (
    <span className="row" style={{ gap: 7, ['--c' as any]: c }} title={`${LEVEL_LABEL[level]} confidence`}>
      <span className="dots" aria-hidden>{[1, 2, 3, 4].map((i) => <i key={i} className={i <= level ? 'on' : ''} />)}</span>
      {label && <span className="lvl-label" style={{ color: c }}>{LEVEL_LABEL[level]}</span>}
      <span className="sr">{LEVEL_LABEL[level]} confidence</span>
    </span>
  );
}

export function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOut(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onOut(); };
    document.addEventListener('mousedown', h, true);
    document.addEventListener('keydown', k, true);
    return () => { document.removeEventListener('mousedown', h, true); document.removeEventListener('keydown', k, true); };
  }, [ref, onOut, active]);
}

export function Popover({ children, onClose, className = '', style }: { children: ReactNode; onClose: () => void; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose);
  return <div ref={ref} className={`menu ${className}`} style={style}>{children}</div>;
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} className="switch" onClick={() => onChange(!on)} />;
}

export function Check({ on }: { on: boolean }) {
  return <span className={`box ${on ? 'on' : ''}`}><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 5.2 4.2 7.4 8 2.8" /></svg></span>;
}

export function Kbd({ children }: { children: ReactNode }) { return <span className="kbd">{children}</span>; }

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

export function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function download(name: string, text: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
