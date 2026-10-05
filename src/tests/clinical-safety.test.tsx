// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnestheticCalculator } from '../components/AnestheticCalculator';
import {
  clinicalFeatureFlags,
  CLINICAL_FEATURE_UNAVAILABLE_MESSAGE,
  resolveClinicalFeatureFlags,
} from '../lib/feature-flags';
import {
  ClinicalProcessor,
  XRAY_INFERENCE_UNAVAILABLE_MESSAGE,
} from '../lib/clinical-cv';

describe('clinical feature flags', () => {
  it('disables both experimental clinical modules by default', () => {
    expect(clinicalFeatureFlags.xrayAnalysis).toBe(false);
    expect(clinicalFeatureFlags.anestheticDecisionSupport).toBe(false);
    expect(resolveClinicalFeatureFlags({})).toEqual({
      clinicalEnvironment: null,
      xrayAnalysis: false,
      anestheticDecisionSupport: false,
    });
  });

  it('does not allow flags to enable modules outside development or demo', () => {
    expect(
      resolveClinicalFeatureFlags({
        VITE_CLINICAL_ENV: 'production',
        VITE_ENABLE_XRAY_ANALYSIS: 'true',
        VITE_ENABLE_ANESTHETIC_DECISION_SUPPORT: 'true',
      }),
    ).toMatchObject({
      xrayAnalysis: false,
      anestheticDecisionSupport: false,
    });
  });

  it('requires each module to be explicitly enabled in an allowed environment', () => {
    expect(
      resolveClinicalFeatureFlags({
        VITE_CLINICAL_ENV: 'demo',
        VITE_ENABLE_XRAY_ANALYSIS: 'true',
      }),
    ).toMatchObject({
      xrayAnalysis: true,
      anestheticDecisionSupport: false,
    });
  });
});

describe('X-ray safety freeze', () => {
  it('returns no result and performs no randomized simulation', async () => {
    const randomSpy = vi.spyOn(Math, 'random');
    const image = new File(['not evaluated'], 'scan.png', { type: 'image/png' });

    await expect(ClinicalProcessor.analyze(image)).rejects.toThrow(
      XRAY_INFERENCE_UNAVAILABLE_MESSAGE,
    );
    expect(randomSpy).not.toHaveBeenCalled();

    randomSpy.mockRestore();
  });
});

describe('anesthetic safety freeze', () => {
  it('shows the unavailable notice and exposes no recommendation control by default', () => {
    render(<AnestheticCalculator patientId="patient-1" />);

    expect(screen.getByRole('status').textContent).toContain(
      CLINICAL_FEATURE_UNAVAILABLE_MESSAGE,
    );
    expect(
      screen.queryByRole('button', { name: /generate experimental estimate/i }),
    ).toBeNull();
  });
});
