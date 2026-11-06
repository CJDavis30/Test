import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Never let a lookup reach into the local machine or a private network. */
const privateV4 = (ip: string) => { const p = ip.split('.').map(Number); return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224; };
export async function hostIsPublic(host: string): Promise<boolean> {
  const h = host.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.local$|\.internal$/i.test(h)) return false;
  try {
    const addrs = isIP(h) ? [{ address: h }] : await lookup(h, { all: true });
    return addrs.length > 0 && addrs.every((a) => (isIP(a.address) === 4 ? !privateV4(a.address) : !/^(::1?$|fe80:|fc|fd|::ffff:(10|127|192\.168|172\.(1[6-9]|2\d|3[01])|169\.254)\.)/i.test(a.address)));
  } catch { return false; }
}
