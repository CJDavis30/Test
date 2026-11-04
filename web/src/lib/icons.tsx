import { renderToStaticMarkup } from 'react-dom/server';
import {
  User, Mail, Phone, AtSign, Globe, Server, Link2, Building2, MapPin, Image as ImageIcon, Wallet, ShieldAlert, BadgeCheck, type LucideIcon,
} from 'lucide-react';
import type { EntityType } from '@shared/types';

export const ENTITY_ICON: Record<EntityType, LucideIcon> = {
  person: User, email: Mail, phone: Phone, username: AtSign, domain: Globe, ip: Server, url: Link2,
  org: Building2, location: MapPin, account: BadgeCheck, image: ImageIcon, wallet: Wallet, breach: ShieldAlert,
};

export function EntityGlyph({ type, size = 16, stroke = 1.75, className, style }: { type: EntityType; size?: number; stroke?: number; className?: string; style?: React.CSSProperties }) {
  const I = ENTITY_ICON[type];
  return <I size={size} strokeWidth={stroke} className={className} style={style} aria-hidden />;
}

// --- canvas icon cache (lucide → SVG → Image) ------------------------------------------------------------------
const cache = new Map<string, HTMLImageElement>();
export function canvasIcon(type: EntityType, color: string, onLoad: () => void): HTMLImageElement | null {
  const key = `${type}|${color}`;
  let img = cache.get(key);
  if (!img) {
    const I = ENTITY_ICON[type];
    const svg = renderToStaticMarkup(<I size={48} strokeWidth={1.7} color={color} />);
    img = new Image();
    img.onload = onLoad;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    cache.set(key, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

const thumbs = new Map<string, HTMLImageElement>();
export function thumb(url: string, onLoad: () => void): HTMLImageElement | null {
  let img = thumbs.get(url);
  if (!img) { img = new Image(); img.onload = onLoad; img.src = url; thumbs.set(url, img); }
  return img.complete && img.naturalWidth ? img : null;
}
