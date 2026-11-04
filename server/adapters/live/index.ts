import { register } from '../../registry';
import { networkAdapters } from './network';
import { identityAdapters } from './identity';
import { sweepAdapters } from './sweep';
import { miscAdapters } from './misc';

export const liveAdapters = [...networkAdapters, ...identityAdapters, ...sweepAdapters, ...miscAdapters];
export function registerLive() { register(...liveAdapters); }
