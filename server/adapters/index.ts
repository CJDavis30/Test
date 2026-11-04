import { register } from '../registry';
import { demoAdapters } from './demo';
import { derive } from './derive';

let loaded = false;
export async function loadAdapters() {
  if (loaded) return;
  loaded = true;
  register(derive, ...demoAdapters);
  const live = await import('./live/index').catch(() => null);
  live?.registerLive();
}
