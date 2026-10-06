export interface DetectionBox {
  toothNumber: number;
  box: { x1: number; y1: number; x2: number; y2: number };
  label: string;
  confidence: number;
}

export interface XrayAnalysisResult {
  cavities: number[];
  missingTeeth: number[];
  boneLossLevel: 'none' | 'mild' | 'moderate' | 'severe';
  confidence: number;
  detections: DetectionBox[];
  imageWidth: number;
  imageHeight: number;
}

export const XRAY_INFERENCE_UNAVAILABLE_MESSAGE =
  'X-ray analysis is unavailable: no technically and clinically validated inference runtime is configured.';

/**
 * The previous implementation returned randomized findings. It has been
 * deliberately frozen until a real, validated inference runtime is integrated.
 */
export class ClinicalProcessor {
  static async analyze(_imageFile: File): Promise<XrayAnalysisResult> {
    throw new Error(XRAY_INFERENCE_UNAVAILABLE_MESSAGE);
  }
}
