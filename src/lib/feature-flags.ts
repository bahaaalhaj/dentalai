export const CLINICAL_FEATURE_UNAVAILABLE_MESSAGE =
  'This experimental module is unavailable pending technical and clinical validation. Do not use it for patient-care decisions.';

export type ClinicalFeatureEnvironment = 'development' | 'demo';

export interface ClinicalFeatureFlagEnvironment {
  VITE_CLINICAL_ENV?: string;
  VITE_ENABLE_XRAY_ANALYSIS?: string;
  VITE_ENABLE_ANESTHETIC_DECISION_SUPPORT?: string;
}

export interface ClinicalFeatureFlags {
  clinicalEnvironment: ClinicalFeatureEnvironment | null;
  xrayAnalysis: boolean;
  anestheticDecisionSupport: boolean;
}

export function resolveClinicalFeatureFlags(
  env: ClinicalFeatureFlagEnvironment,
): ClinicalFeatureFlags {
  const configuredEnvironment = env.VITE_CLINICAL_ENV?.trim().toLowerCase();
  const clinicalEnvironment =
    configuredEnvironment === 'development' || configuredEnvironment === 'demo'
      ? configuredEnvironment
      : null;

  const explicitlyEnabled = (value: string | undefined) => value?.trim().toLowerCase() === 'true';

  return {
    clinicalEnvironment,
    xrayAnalysis: clinicalEnvironment !== null && explicitlyEnabled(env.VITE_ENABLE_XRAY_ANALYSIS),
    anestheticDecisionSupport:
      clinicalEnvironment !== null &&
      explicitlyEnabled(env.VITE_ENABLE_ANESTHETIC_DECISION_SUPPORT),
  };
}

export const clinicalFeatureFlags = Object.freeze(resolveClinicalFeatureFlags(import.meta.env));
