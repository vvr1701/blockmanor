import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Docs guard, added per the §14 analytics-infra audit: the PRD §0 changelog
 * table has twice now been the source of an audit question (a duplicate
 * version number, and a footer/header version that drifted from the table).
 * A concurrent branch (`chore/engine-fuzz-piecesequence`, PRD v1.16) makes
 * this live today — a merge conflict on the changelog presents as "1.14 vs
 * 1.15, pick one", and nothing currently notices a v1.16 row landing under a
 * v1.15 header. Same read-the-PRD-as-data pattern as `remoteConfig.test.ts`.
 */
function readPrd(): string {
  const prdPath = fileURLToPath(new URL('../../../docs/PRD.md', import.meta.url));
  return readFileSync(prdPath, 'utf8');
}

function headerVersion(prd: string): string {
  const match = prd.match(/^\*\*Version:\*\*\s*(\d+\.\d+)/m);
  if (!match?.[1]) throw new Error('PRD header version line not found — did its format change?');
  return match[1];
}

function footerVersion(prd: string): string {
  const match = prd.match(/End of PRD v(\d+\.\d+)/);
  if (!match?.[1]) throw new Error('PRD footer version line not found — did its format change?');
  return match[1];
}

function changelogRowVersions(prd: string): string[] {
  const section = prd.split('**Changelog**')[1]?.split(/^---$/m)[0];
  if (!section) throw new Error('PRD §0 changelog table not found — did the heading change?');
  const rows = [...section.matchAll(/^\|\s*(\d+\.\d+)\s*\|/gm)];
  if (rows.length === 0) throw new Error('No changelog rows parsed — did the table format change?');
  return rows.map((r) => r[1]!);
}

/** `X.Y` string -> [X, Y] as integers. Plain `parseFloat` compares "1.9" >
 * "1.10" (0.9 vs 0.1) — wrong for a dotted major.minor version number. */
function parseVersion(v: string): [number, number] {
  const [major, minor] = v.split('.').map(Number);
  return [major ?? 0, minor ?? 0];
}

function maxVersion(versions: string[]): string {
  return versions.reduce((best, v) => {
    const [bMajor, bMinor] = parseVersion(best);
    const [vMajor, vMinor] = parseVersion(v);
    return vMajor > bMajor || (vMajor === bMajor && vMinor > bMinor) ? v : best;
  });
}

describe('PRD §0 changelog internal consistency', () => {
  it('has no duplicate version numbers', () => {
    const versions = changelogRowVersions(readPrd());
    const duplicates = versions.filter((v, i) => versions.indexOf(v) !== i);
    expect([...new Set(duplicates)]).toEqual([]);
  });

  it('header version and footer version both equal the max changelog row version', () => {
    const prd = readPrd();
    const rows = changelogRowVersions(prd);
    const max = maxVersion(rows);

    expect(headerVersion(prd)).toBe(max);
    expect(footerVersion(prd)).toBe(max);
  });
});
