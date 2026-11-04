import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';

export const APP_NAME = 'Plexus';
export const HOME = process.env.PLEXUS_HOME ?? join(homedir(), '.plexus');
mkdirSync(HOME, { recursive: true, mode: 0o700 });

export const PORT = Number(process.env.PLEXUS_PORT ?? 4317);
export const HOST = '127.0.0.1';
export const USER_AGENT = `${APP_NAME}/0.1 (local investigation workbench)`;

/**
 * API keys live in a 0600 file outside the database so they never end up in case exports/backups.
 * (When packaged for macOS this module is the single place to swap in the Keychain.)
 */
const SECRETS = join(HOME, 'secrets.json');

export function readSecrets(): Record<string, string> {
  try { return existsSync(SECRETS) ? JSON.parse(readFileSync(SECRETS, 'utf8')) : {}; } catch { return {}; }
}
export function writeSecret(name: string, value: string | null): void {
  const all = readSecrets();
  if (value) all[name] = value; else delete all[name];
  writeFileSync(SECRETS, JSON.stringify(all, null, 2), { mode: 0o600 });
  try { chmodSync(SECRETS, 0o600); } catch { /* best effort on non-posix */ }
}
export const getSecret = (name: string) => readSecrets()[name] ?? process.env[`PLEXUS_KEY_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
