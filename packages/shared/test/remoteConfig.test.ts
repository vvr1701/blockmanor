import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REMOTE_CONFIG_DEFAULTS } from '../src/remoteConfig';

/**
 * Drift guard for CLAUDE.md rule 3 / PRD §13: "every key listed here MUST exist
 * in code". Parses §13 out of the PRD and asserts the registry matches exactly —
 * so adding a [RC] key to the PRD without adding it here (or vice versa) fails CI.
 */
function prdRegistryKeys(): Set<string> {
  const prdPath = fileURLToPath(new URL('../../../docs/PRD.md', import.meta.url));
  const prd = readFileSync(prdPath, 'utf8');
  const section = prd.split(/^## 13\. /m)[1]?.split(/^---$/m)[0];
  if (!section) throw new Error('PRD §13 not found — did the section heading change?');
  // RC keys are the only snake_case identifiers in §13.
  return new Set(section.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? []);
}

describe('Remote Config registry (PRD §13)', () => {
  it('matches the PRD §13 registry exactly', () => {
    const inPrd = prdRegistryKeys();
    const inCode = new Set(Object.keys(REMOTE_CONFIG_DEFAULTS));

    const missingFromCode = [...inPrd].filter((k) => !inCode.has(k)).sort();
    const missingFromPrd = [...inCode].filter((k) => !inPrd.has(k)).sort();

    expect({ missingFromCode, missingFromPrd }).toEqual({
      missingFromCode: [],
      missingFromPrd: [],
    });
  });

  it('defaults every key to a defined primitive', () => {
    for (const [key, value] of Object.entries(REMOTE_CONFIG_DEFAULTS)) {
      expect(value, key).toBeDefined();
      expect(['number', 'boolean', 'string'], key).toContain(typeof value);
    }
  });

  it('defaults later-stage flags off and Stage-1 flags on (PRD §0.5)', () => {
    expect(REMOTE_CONFIG_DEFAULTS.flag_daily_board).toBe(true);
    expect(REMOTE_CONFIG_DEFAULTS.flag_endless).toBe(true);
    expect(REMOTE_CONFIG_DEFAULTS.flag_economy).toBe(false);
    expect(REMOTE_CONFIG_DEFAULTS.flag_ads).toBe(false);
    expect(REMOTE_CONFIG_DEFAULTS.flag_iap).toBe(false);
    expect(REMOTE_CONFIG_DEFAULTS.flag_manor).toBe(false);
    expect(REMOTE_CONFIG_DEFAULTS.flag_events).toBe(false);
  });

  it('keeps the wheel prize table parseable with disclosed odds (P6, §10.1)', () => {
    const table: unknown = JSON.parse(REMOTE_CONFIG_DEFAULTS.wheel_prize_table);
    expect(Array.isArray(table)).toBe(true);
    expect((table as { weight: number }[]).every((row) => row.weight > 0)).toBe(true);
  });
});
