export type FormFactor = 'mobile' | 'tablet' | 'desktop';

export const FORM_FACTOR: FormFactor =
  (import.meta.env.VITE_FORM_FACTOR as FormFactor | undefined) ||
  'desktop';

export function detectFormFactor(): FormFactor {
  if (FORM_FACTOR !== 'desktop') return FORM_FACTOR;
  if (/Android/i.test(navigator.userAgent || '')) {
    const w = window.innerWidth || document.documentElement.clientWidth || 0;
    return w >= 600 ? 'tablet' : 'mobile';
  }
  return 'desktop';
}

export function isAndroid(): boolean {
  return detectFormFactor() !== 'desktop';
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