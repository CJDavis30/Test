import { register } from '../../registry';
import { networkAdapters } from './network';
import { identityAdapters } from './identity';
import { sweepAdapters } from './sweep';
import { miscAdapters } from './misc';
import { gamingAdapters } from './gaming';

export const liveAdapters = [...networkAdapters, ...identityAdapters, ...sweepAdapters, ...miscAdapters, ...gamingAdapters];
export function registerLive() { register(...liveAdapters); }
