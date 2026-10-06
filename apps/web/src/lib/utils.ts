import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const TOOTH_COLORS = {
  healthy: '#FFFFFF',
  cavity: '#FCA5A5', // Soft Red
  filling: '#3B82F6', // Blue
  root_canal: '#F59E0B', // Yellow
  extracted: '#EF4444', // Red
  crown: '#9CA3AF', // Gray
  implant: '#8B5CF6', // Purple
};

export const TREATMENT_LABELS = {
  healthy: 'Healthy',
  cavity: 'Cavity',
  filling: 'Filling',
  root_canal: 'Root Canal',
  extracted: 'Extracted',
  crown: 'Crown',
  implant: 'Implant',
};
