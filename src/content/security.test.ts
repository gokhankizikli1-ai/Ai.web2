import { describe, it, expect } from 'vitest';
import {
  SECURITY_GROUPS, SECURITY_NON_CLAIMS, SECURITY_REPORTING,
} from '@/content/security';

/**
 * The public Security page is a TRUST page, not an internal audit report.
 *
 * These tests lock in the two properties that make it one:
 *   1. no implementation evidence is published — no repository paths, source
 *      filenames, module/function identifiers or internal document references;
 *   2. no certification or audit is claimed, and the explicit non-claims stay.
 *
 * Both regressed easily by hand (a helpful "Evidence:" row, a `backend/...`
 * pointer added to a claim), which is exactly why they are asserted here.
 */

const ALL_TEXT: { where: string; text: string }[] = [
  ...SECURITY_GROUPS.flatMap((g) => [
    { where: `${g.id}.title`, text: g.title },
    { where: `${g.id}.intro`, text: g.intro },
    ...g.claims.flatMap((c) => [
      { where: `${g.id} · ${c.title}`, text: c.title },
      { where: `${g.id} · ${c.title} (body)`, text: c.body },
    ]),
  ]),
  ...SECURITY_NON_CLAIMS.map((c, i) => ({ where: `nonClaim[${i}]`, text: c })),
  { where: 'reporting.title', text: SECURITY_REPORTING.title },
  { where: 'reporting.body', text: SECURITY_REPORTING.body },
];

/** Patterns that mean "internal implementation detail leaked onto the page". */
const LEAKS: { name: string; re: RegExp }[] = [
  { name: 'repository directory path', re: /\b(backend|frontend|src|app|lib|routes|services|core)\// },
  { name: 'source filename', re: /\b[\w-]+\.(py|ts|tsx|js|jsx|md|sql|yml|yaml)\b/i },
  { name: 'code identifier in backticks', re: /`[^`]+`/ },
  { name: 'snake_case identifier', re: /\b_?[a-z0-9]+(_[a-z0-9]+)+\b/ },
  { name: 'internal section reference', re: /§/ },
  { name: 'evidence framing', re: /\bevidence\b/i },
];

describe('security page content is user-facing', () => {
  for (const { name, re } of LEAKS) {
    it(`publishes no ${name}`, () => {
      const offenders = ALL_TEXT.filter((e) => re.test(e.text)).map((e) => `${e.where}: ${e.text}`);
      expect(offenders).toEqual([]);
    });
  }

  it('carries no per-claim evidence field', () => {
    for (const g of SECURITY_GROUPS) {
      for (const c of g.claims) {
        expect(Object.keys(c).sort()).toEqual(['body', 'title']);
      }
    }
  });

  it('every claim has a real, non-trivial body', () => {
    for (const g of SECURITY_GROUPS) {
      expect(g.claims.length).toBeGreaterThan(0);
      for (const c of g.claims) {
        expect(c.title.trim().length).toBeGreaterThan(8);
        expect(c.body.trim().length).toBeGreaterThan(60);
      }
    }
  });
});

describe('security page honesty', () => {
  it('claims no certification, audit, or SLA anywhere in the affirmative claims', () => {
    const claims = SECURITY_GROUPS.flatMap((g) => [g.intro, ...g.claims.map((c) => `${c.title} ${c.body}`)]);
    const forbidden = /\b(SOC ?2|ISO ?27001|HIPAA|PCI|GDPR-compliant|certified|certification|penetration test|pentest|SLA|24\/7)\b/i;
    expect(claims.filter((c) => forbidden.test(c))).toEqual([]);
  });

  it('keeps the explicit non-claims', () => {
    const joined = SECURITY_NON_CLAIMS.join(' ');
    for (const term of ['SOC 2', 'ISO 27001', 'HIPAA', 'penetration test', 'SLA']) {
      expect(joined).toContain(term);
    }
  });

  it('does not invent a security contact address', () => {
    const joined = [...SECURITY_NON_CLAIMS, SECURITY_REPORTING.body].join(' ');
    expect(joined).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  it('has a unique id per group', () => {
    const ids = SECURITY_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
