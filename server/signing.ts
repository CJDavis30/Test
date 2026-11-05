import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as edSign, verify as edVerify, type KeyObject } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOME } from './config';

/**
 * Signing identity for evidence packages: an Ed25519 key generated on this Mac the first time it is needed and kept in a 0600 file next to the
 * API keys (never in the database, so it cannot leak through a case export or a backup). The public half travels inside each package.
 */
const FILE = join(HOME, 'signing.pem');

function load(): { priv: KeyObject; pub: KeyObject } {
  let priv: KeyObject;
  if (existsSync(FILE)) priv = createPrivateKey(readFileSync(FILE, 'utf8'));
  else {
    const kp = generateKeyPairSync('ed25519');
    writeFileSync(FILE, kp.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, { mode: 0o600 });
    try { chmodSync(FILE, 0o600); } catch { /* best effort */ }
    priv = kp.privateKey;
  }
  return { priv, pub: createPublicKey(priv) };
}

export interface Signer { publicKey: string; fingerprint: string; sign(data: string): string }

/** Raw 32-byte public key, base64, plus a short fingerprint people can read aloud to confirm they hold the right key. */
export function signer(): Signer {
  const { priv, pub } = load();
  const raw = (pub.export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32);
  const fp = createHash('sha256').update(raw).digest('hex');
  return { publicKey: raw.toString('base64'), fingerprint: fp.slice(0, 32).match(/.{4}/g)!.join(' ').toUpperCase(), sign: (d) => edSign(null, Buffer.from(d, 'utf8'), priv).toString('base64') };
}

/** Verification outside the browser: what a recipient can run with only Node. */
export function verifySignature(publicKeyB64: string, data: string, signatureB64: string): boolean {
  try {
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKeyB64, 'base64')]);
    return edVerify(null, Buffer.from(data, 'utf8'), createPublicKey({ key: der, format: 'der', type: 'spki' }), Buffer.from(signatureB64, 'base64'));
  } catch { return false; }
}
