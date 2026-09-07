/**
 * Minimal digit grouping for scores (PRD §15: "tabular numerals for
 * scores/timers"; the mockups render `12,480`, never `12480`).
 *
 * ponytail: en-US grouping only — no locale awareness, no compact notation.
 * Real localized number formatting (grouping separator, digit shaping for the
 * hi/te locales) lands with §11.4 localization, which is when `t()` itself
 * becomes real i18next; this exists so Stage-1 screens can match the mockups
 * without pretending to be localized. Deliberately not `toLocaleString`:
 * Hermes ships a partial Intl and would silently vary by device locale, which
 * is exactly the divergence §11.4 has to own deliberately.
 */
export function formatScore(n: number): string {
  const sign = n < 0 ? '-' : '';
  return (
    sign +
    Math.abs(Math.trunc(n))
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  );
}
