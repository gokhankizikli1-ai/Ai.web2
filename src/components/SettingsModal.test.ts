import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SectionCard, SettingRow, Segmented, Divider } from './SettingsModal';

/**
 * Focus-loss regression (Settings → General → Display name).
 *
 * The Display-name input lost focus on every keystroke: the presentational
 * wrappers (SectionCard / SettingRow / Segmented / Divider) were declared INSIDE
 * SettingsModal, so each `setNameDraft()` re-render created a NEW function
 * identity for them. React then saw a different component `type` at that position
 * and REMOUNTED the wrapped subtree — unmounting the <input>, which drops focus.
 *
 * The fix hoists the wrappers to stable module scope, so their component identity
 * (element `type`) is constant across renders → the input's tree stays mounted →
 * focus is naturally preserved (no autoFocus, no manual .focus(), no setTimeout,
 * no DOM hacks, no uncontrolled input).
 *
 * The repo's vitest runs in a pure `node` environment (no jsdom / testing-library,
 * and the task forbids adding dependencies), so we assert the exact invariant that
 * produces the focus symptom — stable wrapper identity / no per-render remount —
 * rather than probing `document.activeElement`. A changed `element.type` between
 * renders is the sole reason React would unmount the input, so pinning identity
 * stability + module scope deterministically guards the regression.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'SettingsModal.tsx'), 'utf8');
const BODY = SRC.slice(SRC.indexOf('export default function SettingsModal'));

describe('SettingsModal — stable wrapper identities (focus-loss regression)', () => {
  it('the wrappers are stable module-scope components (constant element type across renders)', () => {
    for (const C of [SectionCard, SettingRow, Segmented, Divider]) {
      expect(typeof C).toBe('function');
    }
    // React remounts iff element.type changes between renders. Module-scope
    // components yield the SAME type on every render → no remount → focus kept.
    expect(createElement(SectionCard, { title: 'Account', children: null }).type)
      .toBe(createElement(SectionCard, { title: 'Account', children: null }).type);
    expect(createElement(SettingRow, { label: 'Display name', children: null }).type)
      .toBe(createElement(SettingRow, { label: 'Display name', children: null }).type);
  });

  it('an input wrapped by SectionCard > SettingRow stays inside their subtree', () => {
    const html = renderToStaticMarkup(
      createElement(SectionCard, {
        title: 'Account',
        subtitle: 'Your profile',
        children: createElement(SettingRow, {
          label: 'Display name',
          description: 'Shown across the app',
          children: createElement('input', { defaultValue: 'Ada Lovelace', 'aria-label': 'Display name' }),
        }),
      }),
    );
    expect(html).toContain('Account');
    expect(html).toContain('Display name');
    expect(html).toContain('value="Ada Lovelace"');
  });

  it('REGRESSION LOCK: wrappers are declared at module scope, never re-declared inside SettingsModal', () => {
    // Module-scope declarations must exist…
    for (const name of ['Segmented', 'SettingRow', 'SectionCard', 'Divider']) {
      expect(SRC).toMatch(new RegExp(`export function ${name}\\(`));
    }
    // …and must NOT reappear as inner closures in the component body (the bug shape).
    for (const name of ['Segmented', 'SettingRow', 'SectionCard', 'Divider']) {
      expect(BODY).not.toMatch(new RegExp(`const ${name}\\s*=`));
      expect(BODY).not.toMatch(new RegExp(`function ${name}\\s*\\(`));
    }
  });

  it('AUDIT: every editable field lives in a stable subtree (no in-body component wrappers)', () => {
    // The other editable controls (About-you textarea, custom tag input, timezone
    // <select>) are authored as DIRECT JSX inside the render helpers — not wrapped
    // in any component defined inside SettingsModal — so they were never subject to
    // the remount. Guard that no NEW inner component wrapper is introduced around
    // them: the component body must not declare ANY capitalized inline component.
    const innerComponentDecl = /\n\s+const\s+[A-Z][A-Za-z0-9]*\s*=\s*\([^)]*\)\s*=>\s*\(/;
    expect(BODY).not.toMatch(innerComponentDecl);
  });
});
