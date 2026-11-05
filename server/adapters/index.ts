import { register } from '../registry';
import { derive } from './derive';
import { extendHow } from './how';

let loaded = false;
export async function loadAdapters() {
  if (loaded) return;
  loaded = true;
  register(derive);
  const live = await import('./live/index').catch(() => null);
  live?.registerLive();
  // QA only: a fictional world, built separately and never part of the app. Needs both the env var and a file that exists.
  const world = process.env.PLEXUS_TEST_WORLD;
  if (world) {
    try { const m = await import(/* @vite-ignore */ world); register(...m.demoAdapters); if (m.demoHow) extendHow(m.demoHow); } catch (e: any) { console.warn('Test world not loaded:', e?.message ?? e); }
  }
}
