import { register } from '../../registry';
import { networkAdapters } from './network';
import { identityAdapters } from './identity';
import { sweepAdapters } from './sweep';
import { miscAdapters } from './misc';
import { gamingAdapters } from './gaming';
import { activityAdapters } from './activity';
import { profileAdapters } from './more-profiles';
import { networkMore } from './more-network';
import { recordAdapters } from './more-records';
import { wmnSweep } from './wmn';

export const liveAdapters = [...networkAdapters, ...identityAdapters, ...sweepAdapters, ...miscAdapters, ...gamingAdapters, ...activityAdapters, ...profileAdapters, ...networkMore, ...recordAdapters, wmnSweep];
export function registerLive() { register(...liveAdapters); }
