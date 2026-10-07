import { resolveClinicalFeatureFlags } from '@dentalai/domain';

export {
  CLINICAL_FEATURE_UNAVAILABLE_MESSAGE,
  resolveClinicalFeatureFlags,
} from '@dentalai/domain';
export type {
  ClinicalFeatureEnvironment,
  ClinicalFeatureFlagEnvironment,
  ClinicalFeatureFlags,
} from '@dentalai/domain';

export const clinicalFeatureFlags = Object.freeze(resolveClinicalFeatureFlags(import.meta.env));
