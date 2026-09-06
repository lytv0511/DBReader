export type FormFactor = 'mobile' | 'tablet' | 'desktop';

export const FORM_FACTOR: FormFactor =
  (import.meta.env.VITE_FORM_FACTOR as FormFactor | undefined) ||
  'desktop';

export function detectFormFactor(): FormFactor {
  if (FORM_FACTOR !== 'desktop') return FORM_FACTOR;
  const w = window.innerWidth || document.documentElement.clientWidth || 0;
  if (w < 600) return 'mobile';
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return 'tablet';
  if (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1) return 'tablet';
  return 'desktop';
}

export function isMobile(): boolean {
  return detectFormFactor() !== 'desktop';
}

export function isPhone(): boolean {
  return detectFormFactor() === 'mobile';
}

export function isTablet(): boolean {
  return detectFormFactor() === 'tablet';
}

let appliedFormFactor: FormFactor | null = null;

export function applyFormFactor(): FormFactor {
  const ff = detectFormFactor();
  if (appliedFormFactor !== ff) {
    document.documentElement.setAttribute('data-form-factor', ff);
    appliedFormFactor = ff;
  }
  return ff;
}