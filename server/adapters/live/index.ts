import { register } from '../../registry';
import { networkAdapters } from './network';
import { identityAdapters } from './identity';
import { sweepAdapters } from './sweep';
import { miscAdapters } from './misc';
import { gamingAdapters } from './gaming';
import { activityAdapters } from './activity';

export const liveAdapters = [...networkAdapters, ...identityAdapters, ...sweepAdapters, ...miscAdapters, ...gamingAdapters, ...activityAdapters];
export function registerLive() { register(...liveAdapters); }
