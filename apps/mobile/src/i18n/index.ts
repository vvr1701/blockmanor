import en from './en.json';

/**
 * Minimal string lookup (PRD §4.2 src/i18n). i18next + hi/te locales land with
 * localization in Stage 3 (§11.4); until then every user-facing string still goes
 * through a key here, so no literals leak into screens (ui-engineer rule).
 */
type StringKey = keyof typeof en;

export function t(key: StringKey, params?: Record<string, string | number>): string {
  const template: string = en[key];
  if (!params) return template;
  return Object.entries(params).reduce(
    (out, [name, value]) => out.replace(`{{${name}}}`, String(value)),
    template,
  );
}
