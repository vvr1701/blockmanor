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
  // Global replace, not `String.replace(string, …)` — that substitutes only
  // the FIRST occurrence, so a key using the same placeholder twice (e.g.
  // §7.10's "Level {{level}} chest, locked — clear level {{level}} to open
  // it") silently shipped a literal `{{level}}` to the player.
  return Object.entries(params).reduce(
    (out, [name, value]) => out.split(`{{${name}}}`).join(String(value)),
    template,
  );
}
